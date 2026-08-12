-- 162_commas_inbox_no_bare_rls.sql — commas_inbox got RLS with zero policies
-- (same class of bug as 109 / 154). App role inserts fail; webhooks cannot land.
-- Scoped to this one table so we do not pull in pending 160/161.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'commas_inbox'
       AND c.relkind = 'r'
       AND c.relrowsecurity = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'commas_inbox'
       )
  ) THEN
    CREATE POLICY commas_inbox_no_bare_rls ON commas_inbox
      USING (true) WITH CHECK (true);
    ALTER TABLE commas_inbox FORCE ROW LEVEL SECURITY;
    RAISE NOTICE '162: permissive policy on commas_inbox';
  ELSE
    RAISE NOTICE '162: commas_inbox not bare-RLS (skip)';
  END IF;
END $$;
