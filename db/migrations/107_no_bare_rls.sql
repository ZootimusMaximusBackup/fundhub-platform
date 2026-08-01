-- 107_no_bare_rls.sql — closes the bug that actually took login down.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT ACTUALLY HAPPENED (confirmed by the owner, not reasoned from the code)
--
-- One or more tables had Row Level Security ENABLED with ZERO POLICIES
-- attached. In Postgres, that combination is not "no restriction" — it is
-- DENY EVERYTHING to every role except the table owner. No SELECT, no INSERT,
-- nothing, for any ordinary connection.
--
-- This repository's own migrations never do that. fundhub_apply_partner_rls()
-- (045_creative_factory.sql) enables RLS and installs a policy in the same
-- function call, on exactly nineteen tables (045/046/047/049/050). No other
-- migration in db/schema or db/migrations enables RLS on anything — grepping
-- for "ENABLE ROW LEVEL SECURITY" across both directories finds exactly one
-- hit, inside that function. So the bare-RLS tables were switched on directly
-- against the live database — outside any migration, unrecorded anywhere in
-- this repository — most likely by hand or by a dashboard's own security
-- prompt, independently of anything this codebase asked for.
--
-- WHY IT ONLY BROKE NOW. While DATABASE_URL carried a superuser, this was
-- invisible: a superuser bypasses RLS entirely regardless of the policy count
-- (the exact property 104_app_role.sql exists to close — see that file's own
-- header). The moment 104 switched the app to fundhub_app, an ordinary role,
-- Postgres's real default took over on whatever tables were already sitting in
-- this state, and every query against one of them returned zero rows — which
-- read from the login form as "Wrong email or password" no matter how correct
-- the credential was.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHY IT IS WRITTEN GENERICALLY RATHER THAN AGAINST A TABLE LIST
--
-- The owner already unblocked login by hand in Supabase — permissive
-- policies, not disabling RLS. This migration is what makes that survive a
-- schema rebuild instead of living only in one dashboard's current state.
--
-- No hand-fix was recorded anywhere with the exact table names it touched, and
-- a hardcoded list here risks being wrong or incomplete — the same class of
-- mistake this whole incident already came from. So instead of naming tables,
-- this asks Postgres the same question src/compliance/rls-bypass.pg.test.mjs
-- now asks in the test suite: which tables have relrowsecurity = true and no
-- row in pg_policies for them. Whatever it finds, it patches.
--
-- THE POLICY INSTALLED IS PERMISSIVE ON PURPOSE: USING (true) WITH CHECK
-- (true). It adds no isolation — it removes the accidental deny-all. That is
-- correct specifically because none of these tables were ever DESIGNED to be
-- partner-isolated by RLS. The nineteen tables that ARE partner-isolated
-- already carry a real policy from 045/046/047/049/050 and can never match
-- "zero policies" — this statement cannot touch them. Every other table's
-- access control in this codebase is GRANTs (104_app_role.sql,
-- 105_login_path_grants.sql) plus application-level scoping
-- (src/partners/scope.mjs, src/http/middleware/requireRole.mjs). RLS was never
-- part of their design, so a permissive policy here restores exactly the
-- access those GRANTs already describe — it does not widen anything beyond
-- what fundhub_app already holds.
--
-- IDEMPOTENT. A table this migration already patched carries a policy, so a
-- second run finds nothing left to do and reports that plainly rather than
-- erroring on a duplicate.

DO $$
DECLARE
  rec record;
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
      'CREATE POLICY %I ON %I USING (true) WITH CHECK (true)',
      rec.table_name || '_no_bare_rls', rec.table_name
    );
    -- FORCE too, not just the policy. A table found here already had RLS
    -- ENABLED — that part of the mistake is not this migration's to fix — but
    -- ENABLE without FORCE only binds non-owner roles; the owner (the identity
    -- migrations themselves run as) is exempt by default. The policy above is
    -- permissive so FORCE costs the owner nothing today, and it is what keeps
    -- this table honest if the policy is ever tightened later without anyone
    -- remembering to add FORCE at the same time — exactly the trap 045's own
    -- header names for the partner-isolation tables.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.table_name);
    fixed := array_append(fixed, rec.table_name);
  END LOOP;

  IF array_length(fixed, 1) > 0 THEN
    RAISE NOTICE 'installed a permissive policy on % table(s) that had RLS enabled with zero policies (was denying everything): %',
      array_length(fixed, 1), array_to_string(fixed, ', ');
  ELSE
    RAISE NOTICE 'no bare-RLS tables found — nothing to patch. Either already fixed, or this was never affected.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT STOPS THIS FROM COMING BACK SILENTLY
--
-- src/compliance/rls-bypass.pg.test.mjs now runs the identical query as a test
-- and fails, by table name, if it is ever non-empty again — whether from a
-- future migration or another out-of-band change in Supabase. Both places ask
-- the same question of pg_class/pg_policies on purpose: a migration and a test
-- that quietly drifted apart on the definition of "bare RLS" would be worse
-- than having neither.
