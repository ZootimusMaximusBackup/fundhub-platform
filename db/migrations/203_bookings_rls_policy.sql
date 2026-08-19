-- 203_bookings_rls_policy.sql — unlock `bookings`, and correct the record about 201.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS WRONG, MEASURED ON LIVE 2026-08-19
--
-- public.bookings has Row Level Security switched ON with ZERO policies. As the
-- app role fundhub_app:
--
--   SELECT count(*) FROM bookings          → 0
--   INSERT INTO bookings (...)             → 42501
--                new row violates row-level security policy for table "bookings"
--
-- The SELECT privilege is granted; this is the row policy refusing, not a
-- permission gap.
--
-- THIS IS NOT ONLY A READ PROBLEM, AND THAT IS THE URGENT PART. `bookings` is
-- the table the inbound booking webhook writes to (api/webhooks/[provider].mjs).
-- With the lock on and no key, every booking that arrives is REJECTED at the
-- database. Appointments made right now are not being kept. A read that returns
-- nothing is invisible; a write that is refused is lost.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECTION: 201 IS NOT A STANDING NET. IT RAN ONCE.
--
-- 201_no_bare_rls_sweep.sql describes itself as "the net underneath... it fires
-- on every deploy". That is WRONG, and this table is the proof.
--
-- db/migrate.mjs records every applied file in schema_migrations and skips
-- anything already there (db/migrate.mjs, the `applied` set). 201 was applied at
-- 2026-08-19T03:20:38Z and will never run again. Its sweep found zero locked
-- tables at that moment — correctly, because `bookings` was still fine.
-- `bookings` was locked out of band some time AFTER 03:20, and nothing was ever
-- going to repair it.
--
-- So the sweep pattern (109, 154, 201) has a hole that three repetitions never
-- exposed: it repairs the past, and each copy is a one-shot. Drift that happens
-- after the last sweep is applied sits there silently until a human notices,
-- which is exactly what happened here — within hours of 201 running.
--
-- The real net is therefore NOT another sweep. It is detection that runs on
-- every build against the live database and REFUSES THE DEPLOY:
-- src/security/rls-shape.test.mjs is now part of `npm run guard:db`, which
-- netlify.toml runs after migrations in every context. The next table locked
-- from the dashboard will stop a deploy with the table named, instead of
-- silently dropping whatever writes to it.
--
-- The trade, stated plainly: a locked table now blocks deploys until someone
-- writes a migration like this one. That is deliberate. Silently losing
-- bookings is worse than a blocked deploy, and a blocked deploy is visible in
-- ten seconds.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES
--
-- Two things, in order:
--   1. Declares `bookings` explicitly — ENABLE, FORCE, and a named policy — so
--      a database built from db/ and the live database describe the same shape.
--      Same reasoning as 200_dispute_rls_policies.sql.
--   2. Re-runs the unscoped sweep over `public`, because this migration will not
--      be applied until the next production deploy and more tables may drift
--      between now and then. It repairs whatever is locked AT APPLY TIME, not
--      whatever was locked when this was written.
--
-- The policy is permissive — USING (true) WITH CHECK (true) — matching the 147
-- other tables in this database. It restores access; it does not isolate one
-- org's bookings from another's. Tightening that is audit item T16-05 and is an
-- owner-level decision, deliberately not bundled here.
--
-- Owner of the table is `postgres`, so this needs MIGRATION_DATABASE_URL.
-- Since 2026-08-19 that only happens on the production deploy (netlify.toml).

-- ── 0. bookings itself, because db/ has never defined it ───────────────────
--
-- A second, quieter finding. `bookings` exists on live and is created by NO
-- file in db/. Comparing live against a database built from db/ by the same
-- runner: 176 tables live, 175 from db/, and the single difference is this one.
-- Nothing in db/ is missing from live.
--
-- That matters beyond tidiness. CI builds its database from db/, so `bookings`
-- has never existed in CI. Every guard, every invariant test and every RLS
-- check has been passing over a table that simply was not there — including
-- src/security/rls-shape.test.mjs, which would have caught this lock the moment
-- it was pointed at a database that HAD the table. The drift is why the drift
-- stayed invisible.
--
-- Reproduced below exactly as live defines it, read out of pg_catalog on
-- 2026-08-19, not from memory. IF NOT EXISTS, so on live this is a no-op and
-- nothing about the existing 26-plus ClickFunnels bookings is touched; on a
-- fresh database it finally creates the table the app has been writing to.
CREATE TABLE IF NOT EXISTS public.bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid REFERENCES clients(id) ON DELETE CASCADE,
  source          text NOT NULL,
  provider_uid    text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          text,
  meeting_url     text,
  attendee_email  text,
  attendee_name   text,
  event_type_slug text,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_client_idx      ON public.bookings (client_id);
CREATE INDEX IF NOT EXISTS bookings_org_starts_idx  ON public.bookings (org_id, starts_at);

-- Both partial, both as live has them: one booking per provider id, and a
-- fallback key for rows that arrive without one.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_uid_uq
  ON public.bookings (org_id, provider_uid) WHERE provider_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_event_id_uq
  ON public.bookings (org_id, ((raw ->> '__event_id')))
  WHERE provider_uid IS NULL AND (raw ->> '__event_id') IS NOT NULL;

-- ── 1. bookings, declared ──────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.bookings') IS NULL THEN
    RAISE WARNING '203: public.bookings does not exist — nothing to unlock';
    RETURN;
  END IF;

  ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'bookings'
       AND policyname = 'bookings_app_all'
  ) THEN
    CREATE POLICY bookings_app_all ON public.bookings
      USING (true) WITH CHECK (true);
    RAISE NOTICE '203: unlocked public.bookings — inbound bookings can land again';
  ELSE
    RAISE NOTICE '203: public.bookings already carried its policy';
  END IF;
END $$;

-- ── 2. and anything else that drifted before this deploy ───────────────────
DO $$
DECLARE
  rec   record;
  fixed text[] := '{}';
BEGIN
  FOR rec IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)',
      rec.table_name || '_no_bare_rls', rec.table_name
    );
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rec.table_name);
    fixed := array_append(fixed, rec.table_name);
  END LOOP;

  IF array_length(fixed, 1) > 0 THEN
    RAISE WARNING '203: % table(s) had drifted locked shut since 201 ran: %',
      array_length(fixed, 1), array_to_string(fixed, ', ');
  ELSE
    RAISE NOTICE '203: nothing else locked shut';
  END IF;
END $$;
