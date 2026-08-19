-- 200_dispute_rls_policies.sql — unlock the six Metro 2 credit-dispute tables.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS WRONG RIGHT NOW
--
-- On live, these six tables have Row Level Security switched ON and ZERO
-- policies attached:
--
--   dispute_cases  dispute_items  dispute_letters  dispute_responses
--   furnisher_mail_addresses  repair_decision_log
--
-- In Postgres that combination means DENY EVERYTHING to every role except the
-- table's owner. The owner here is `postgres`; the application connects as
-- `fundhub_app`, which is deliberately not an owner and deliberately carries
-- NOBYPASSRLS (see 104_app_role.sql). So the app is refused on all six.
--
-- Measured on live 2026-08-18 as fundhub_app:
--
--   table                      SELECT priv   rows returned
--   dispute_cases              true          0
--   dispute_items              true          0
--   dispute_letters            true          0
--   dispute_responses          true          0
--   furnisher_mail_addresses   true          0
--   repair_decision_log        true          0
--
-- Note the first column. The GRANTs are all present — 104's
-- ALTER DEFAULT PRIVILEGES saw to that when 160/161 created the tables. This
-- is not a missing-permission problem and adding GRANTs would not touch it.
-- Every one of those zeroes is the row policy refusing, and that is why the
-- whole credit-dispute feature reads and writes nothing.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- HOW IT GOT THIS WAY, AND WHY NO TEST CAUGHT IT
--
-- Grep 160_metro2_dispute_engine.sql and 161_optimization_repair_pipeline.sql
-- for ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY or CREATE POLICY and
-- you get nothing. Neither file says one word about RLS. The switch was
-- therefore thrown OUT OF BAND — from the Supabase dashboard or its linter —
-- after the tables existed.
--
-- That is the whole reason the guard stayed green. src/compliance/
-- rls-bypass.pg.test.mjs asks exactly the right question, but it asks it of
-- whatever DATABASE_URL points at, and CI points at a throwaway container
-- built from db/migrations. Because 160/161 declare no RLS, the six tables
-- come up in CI with RLS OFF, the assertion passes, and CI is structurally
-- incapable of ever seeing the drift — the drift does not live in the files
-- CI reads.
--
-- Nor did the standing sweeps catch it. 109_no_bare_rls.sql and
-- 154_no_bare_rls_again.sql are unscoped loops that would have fixed this,
-- but both ran BEFORE these tables existed. The only sweep since,
-- 162_commas_inbox_no_bare_rls.sql, was deliberately narrowed to one table —
-- its own comment reads "Scoped to this one table so we do not pull in pending
-- 160/161" — and scripts/tmp-apply-162.mjs confirms 160/161 were still pending
-- at that moment and were applied separately afterwards.
--
-- This is the THIRD time this class of bug has shipped (109, then 154, now
-- 160/161).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE DECLARES THE STATE INSTEAD OF JUST PATCHING IT
--
-- The one-line fix is "add the missing policies". That would unlock the
-- feature and leave the guard exactly as blind as it is today, because CI
-- would still build these tables with RLS off while live has it on.
--
-- So this file states the intended end state OUT LOUD, in a migration file,
-- for both halves: RLS enabled, FORCE set, and a named policy. After this
-- runs, a freshly built CI database and the live database describe the SAME
-- schema for the first time, and src/security/rls-shape.test.mjs (added with
-- this change) can assert an invariant that actually means something:
-- no table anywhere is RLS-on-with-no-policy.
--
-- 201_no_bare_rls_sweep.sql is the net underneath, for the next table that
-- drifts this way before anyone writes it down.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS POLICY DOES *NOT* DO — READ THIS BEFORE ASSUMING IT ISOLATES
--
-- The policy below is permissive: USING (true) WITH CHECK (true). It restores
-- access. It does NOT stop one client's dispute rows being visible to a
-- connection that is already authenticated as the app.
--
-- That is on purpose, and it matches how this database already works: 147 of
-- its 175 public tables carry exactly this shape, including clients, messages,
-- contracts, documents and crs_results. Isolation is enforced in the
-- application layer, not by row policies. Only 21 partner/advertising tables
-- have a real check (partner_isolation, via fundhub_current_partner() /
-- fundhub_is_staff()).
--
-- Tightening those 147 is audit item T16-05. It is a real finding and it is
-- deliberately NOT bundled here, for two reasons. First, it is an owner-level
-- decision about the product's security model, not a defect fix. Second,
-- locking down six tables while clients, documents and credit results stay
-- open buys nothing at all — an attacker who reached this connection already
-- has the credit file.
--
-- These six tables would hold credit-dispute data if the feature ran. They
-- hold none today.
--
-- Owner: postgres. This migration therefore requires MIGRATION_DATABASE_URL
-- (db/migrate.mjs:36 prefers it and falls back to DATABASE_URL). fundhub_app
-- cannot CREATE POLICY and must never be able to.

DO $$
DECLARE
  t          text;
  pol        text;
  targets    text[] := ARRAY[
                'dispute_cases',
                'dispute_items',
                'dispute_letters',
                'dispute_responses',
                'furnisher_mail_addresses',
                'repair_decision_log'
              ];
  unlocked   text[] := '{}';
  absent     text[] := '{}';
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- A table named here that does not exist is a fact worth surfacing, not a
    -- reason to abort the other five.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      absent := array_append(absent, t);
      CONTINUE;
    END IF;

    -- Declare the state rather than assume it. On live these are already ON
    -- (set out of band); in CI they are OFF. Both end up the same after this.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    pol := t || '_app_all';

    -- Named _app_all, not _no_bare_rls, so a later audit can tell a policy
    -- placed deliberately here apart from one a blind sweep left behind.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = pol
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)',
        pol, t
      );
      unlocked := array_append(unlocked, t);
    END IF;
  END LOOP;

  IF array_length(unlocked, 1) > 0 THEN
    RAISE NOTICE '200: unlocked % dispute table(s): %',
      array_length(unlocked, 1), array_to_string(unlocked, ', ');
  ELSE
    RAISE NOTICE '200: all dispute tables already carried their policy';
  END IF;

  IF array_length(absent, 1) > 0 THEN
    RAISE WARNING '200: table(s) named but not present: % — 160/161 may not have applied',
      array_to_string(absent, ', ');
  END IF;
END $$;
