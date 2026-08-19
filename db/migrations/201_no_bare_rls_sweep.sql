-- 201_no_bare_rls_sweep.sql — the standing sweep, re-run.
--
-- WHY THIS FILE EXISTS FOR THE THIRD TIME.
-- 109_no_bare_rls.sql, then 154_no_bare_rls_again.sql, now this. Each time the
-- same thing happened: a table got Row Level Security switched ON outside the
-- migration files (Supabase dashboard / linter), with no policy attached. In
-- Postgres, RLS-on-with-zero-policies means DENY EVERYTHING to every role
-- except the table's owner. The app role fundhub_app is not an owner, so the
-- app silently reads zero rows and writes fail.
--
-- 154 ran BEFORE db/migrations/160_metro2_dispute_engine.sql and
-- db/migrations/161_optimization_repair_pipeline.sql created their tables, so
-- it could not cover them. 162_commas_inbox_no_bare_rls.sql was deliberately
-- scoped to a single table (its own comment says "so we do not pull in pending
-- 160/161"). Nothing unscoped has run since. Six tables have been locked shut
-- on live ever since — see 200_dispute_rls_policies.sql, which names them and
-- declares their state explicitly so CI and live finally agree.
--
-- 200 fixes the six tables we know about. THIS file is the net underneath: it
-- fires on every deploy and closes any table that has drifted the same way
-- since the last one, including tables that do not exist yet.
--
-- WHAT IT DOES NOT DO.
-- The policy it writes is permissive — USING (true) WITH CHECK (true). It
-- restores access; it does not isolate one client's rows from another's. That
-- matches how 147 of this database's tables already work: isolation is done in
-- the application layer, not by row policies. Tightening those 147 is a
-- separate, owner-level decision (audit item T16-05) and is deliberately NOT
-- bundled here. The purpose of this file is narrow: no table should ever be
-- shut to the app by accident.

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
    RAISE NOTICE '201: permissive policy on % bare-RLS table(s): %',
      array_length(fixed, 1), array_to_string(fixed, ', ');
  ELSE
    RAISE NOTICE '201: no bare-RLS tables found (200 already covered the known six)';
  END IF;
END $$;
