-- 364_hiring_rls_policies.sql — unlock three hiring tables that drifted shut.
--
-- WHAT IS WRONG
--
-- On live, these three tables have Row Level Security switched ON and ZERO
-- policies attached:
--
--   candidate_outreach  hiring_role_brief_revisions  hiring_zoho_candidate_links
--
-- In Postgres that combination denies everything to every role except the
-- table owner. The app connects as `fundhub_app`, which is deliberately not an
-- owner and carries NOBYPASSRLS (104_app_role.sql). So the app reads zero rows
-- and cannot write, and neither failure raises an error — it looks exactly
-- like an empty table.
--
-- HOW IT GOT THIS WAY
--
-- Same route as 200: grep 294, 295 and 298 (the migrations that create these
-- tables) for ENABLE ROW LEVEL SECURITY and you get nothing. The switch was
-- thrown out of band, from the Supabase dashboard or its linter, after the
-- tables existed. 201_no_bare_rls_sweep.sql is the standing net for exactly
-- this, but it ran before these tables were created.
--
-- This is the fourth time this class has shipped (109, 154, 200, now this).
--
-- WHY IT MATTERS TODAY
--
-- src/security/rls-shape.test.mjs asserts no table anywhere is RLS-on-with-no-
-- policy. It is wired into `npm run guard:rls`, which netlify.toml runs as part
-- of build.command on the production context. So this drift did not just break
-- hiring — it failed every production build on 2026-09-06 with a bare
-- "exit code 1", which is why nothing merged to main that day ever went live.
--
-- WHAT THIS DOES
--
-- Declares the intended end state out loud so a freshly built CI database and
-- the live database describe the same schema: RLS enabled, FORCE set, and one
-- named permissive policy per table. Tenant scoping for these tables is
-- enforced in the application layer by org_id, matching every other hiring
-- table (hiring_roles_app_all, candidates_app_all, and the rest all read
-- USING (true)). This file deliberately does not tighten that; changing the
-- hiring isolation model is a separate decision and does not belong in a
-- migration whose job is to undo an out-of-band switch.

DO $$
DECLARE
  rec   record;
  fixed text[] := '{}';
BEGIN
  FOR rec IN
    SELECT unnest(ARRAY[
      'candidate_outreach',
      'hiring_role_brief_revisions',
      'hiring_zoho_candidate_links'
    ]) AS table_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = rec.table_name AND c.relkind = 'r'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', rec.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   rec.table_name || '_app_all', rec.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      rec.table_name || '_app_all', rec.table_name
    );
    fixed := array_append(fixed, rec.table_name);
  END LOOP;

  RAISE NOTICE '364: policy attached on % hiring table(s): %',
    COALESCE(array_length(fixed, 1), 0), array_to_string(fixed, ', ');
END $$;
