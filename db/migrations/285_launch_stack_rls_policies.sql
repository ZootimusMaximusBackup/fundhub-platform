-- 285_launch_stack_rls_policies.sql — unlock the seven e-product tables.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS WRONG RIGHT NOW
--
-- On live, these seven tables have Row Level Security switched ON and ZERO
-- policies attached:
--
--   decline_autopsy_rows   decline_autopsy_uploads
--   live_trials            live_trial_events
--   subscription_charges
--   training_modules       training_gates
--
-- In Postgres that combination means DENY EVERYTHING to every role except the
-- table's owner. The owner is `postgres`; the application connects as
-- `fundhub_app`, which is deliberately not an owner and carries NOBYPASSRLS
-- (104_app_role.sql). So the app is refused on all seven, and refused SILENTLY
-- — a SELECT returns zero rows and an INSERT is dropped, neither raising an
-- error. It looks exactly like an empty table.
--
-- This is the Friday launch stack. The Decline Autopsy, the $297 Live Trial,
-- subscription billing and the partner training ladder are all dead in
-- production right now, and nothing has been reporting it.
--
-- Caught by `npm run guard:rls` failing the Netlify build on 2026-08-31, which
-- is the guard working exactly as designed: src/security/rls-shape.test.mjs
-- checks the LIVE catalog, so it fails the deploy rather than letting a locked
-- table reach production a second time.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- HOW IT GOT THIS WAY — THE SAME WAY IT HAPPENED IN AUGUST
--
-- Grep 275_decline_autopsy.sql, 276_subscription_billing.sql,
-- 280_live_trials.sql and 284_training_delivery.sql for ENABLE ROW LEVEL
-- SECURITY or CREATE POLICY and you get nothing. Not one of them mentions RLS
-- as a statement.
--
-- Three of the four say the OPPOSITE in prose, deliberately:
--
--   280: "NO ROW-LEVEL SECURITY ON THESE TABLES, DELIBERATELY ... every read
--        carries an explicit org_id + partner_id predicate written by the
--        endpoint, which resolves partner_id from the SESSION."
--   276: "NO RLS. `subscriptions` carries none, and a child table locked
--        differently from its parent is the drift rls-shape.test.mjs exists
--        to catch."
--   284: training_modules is "the same shape as `products` (010) — no RLS,
--        seeded for the default org, read by everybody."
--
-- So the switch was thrown OUT OF BAND — from the Supabase dashboard or its
-- linter — after the tables existed. Exactly what happened to the six
-- credit-dispute tables, diagnosed in 200_dispute_rls_policies.sql on
-- 2026-08-18. Same cause, same silence, same fix.
--
-- This is the second occurrence. If it happens a third time the answer is not
-- another migration, it is finding what is flipping the switch.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY ENABLE + POLICY RATHER THAN DISABLE
--
-- The migrations' stated intent was RLS off, so DISABLE would also satisfy the
-- guard. 200 chose enable-plus-permissive-policy and this follows it, for the
-- reason 200 gives: declare the state rather than assume it. Live has it ON
-- and a fresh CI database has it OFF; after this file both are identical.
--
-- It is also the more durable half of the choice. If whatever flipped the
-- switch flips it again, a table that already carries its policy keeps working.
-- A table that was merely disabled goes dark all over again, silently.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS POLICY DOES *NOT* DO — READ BEFORE ASSUMING IT ISOLATES
--
-- USING (true) WITH CHECK (true). It restores access. It does NOT stop one
-- tenant's rows being visible to a connection already authenticated as the app.
--
-- That is on purpose and it matches how this database already works: the large
-- majority of public tables carry exactly this shape, including clients,
-- messages, contracts and documents. Isolation lives in the application layer.
-- Only the partner and advertising tables carry a real check, through
-- fundhub_current_partner() / fundhub_is_staff().
--
-- Note which tables are NOT in this file. 284 created four tables and only two
-- are here. partner_training_progress and partner_training_gates carry a NOT
-- NULL partner_id and go through fundhub_apply_partner_rls(), so one partner
-- can never read another's record. They are correctly locked and must stay
-- that way. The two named here — training_modules and training_gates — are
-- catalogue tables with no partner_id, seeded per org and read by everybody.
--
-- Tightening the permissive majority is audit item T16-05. It is an owner-level
-- decision about the product's security model, not a defect fix, and bundling
-- it here would hold the launch stack hostage to it.
--
-- Owner: postgres. Requires MIGRATION_DATABASE_URL (db/migrate.mjs prefers it
-- and falls back to DATABASE_URL). fundhub_app cannot CREATE POLICY and must
-- never be able to.
--
-- SAFETY. Additive and idempotent. Creates no table, drops nothing, revokes
-- nothing, touches no row of data. Re-running it is a no-op.

DO $$
DECLARE
  t          text;
  pol        text;
  targets    text[] := ARRAY[
                'decline_autopsy_rows',
                'decline_autopsy_uploads',
                'live_trials',
                'live_trial_events',
                'subscription_charges',
                'training_modules',
                'training_gates'
              ];
  unlocked   text[] := '{}';
  absent     text[] := '{}';
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- A table named here that does not exist is a fact worth surfacing, not a
    -- reason to abort the other six.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      absent := array_append(absent, t);
      CONTINUE;
    END IF;

    -- Declare the state rather than assume it. Live is already ON, set out of
    -- band; a fresh CI database is OFF. Both end up the same after this.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    pol := t || '_app_all';

    -- Named _app_all, matching 200, so a later audit can tell a policy placed
    -- deliberately here apart from one a blind sweep left behind.
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
    RAISE NOTICE '285: unlocked % e-product table(s): %',
      array_length(unlocked, 1), array_to_string(unlocked, ', ');
  ELSE
    RAISE NOTICE '285: all seven tables already carried their policy';
  END IF;

  IF array_length(absent, 1) > 0 THEN
    RAISE NOTICE '285: not present in this database, skipped: %',
      array_to_string(absent, ', ');
  END IF;
END $$;
