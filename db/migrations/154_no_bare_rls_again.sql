-- Same fix as 109_no_bare_rls.sql, re-run for tables created after 109 that
-- got RLS enabled (Supabase / dashboard) with zero policies. Deny-all for
-- fundhub_app — Demo Mode seed died on funding_closeout with:
--   new row violates row-level security policy for table "funding_closeout"

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
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.table_name);
    fixed := array_append(fixed, rec.table_name);
  END LOOP;

  IF array_length(fixed, 1) > 0 THEN
    RAISE NOTICE '154: permissive policy on % bare-RLS table(s): %',
      array_length(fixed, 1), array_to_string(fixed, ', ');
  ELSE
    RAISE NOTICE '154: no bare-RLS tables found';
  END IF;
END $$;
