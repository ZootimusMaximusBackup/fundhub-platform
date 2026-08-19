-- 202_client_fk_indexes.sql — index every child column that points at a client.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM THIS SOLVES
--
-- Postgres does not create an index for you on the CHILD side of a foreign
-- key. It indexes the parent's primary key and nothing else. That is fine
-- until something deletes a parent row: to answer "is any child still
-- pointing at this client?", the server must check every child table, and
-- with no index on the child's client_id column that check is a full table
-- scan. One `DELETE FROM clients` therefore scans, today, twenty-three
-- separate tables end to end.
--
-- That is a large part of why tearing down a demo client was timing out.
-- Netlify runs this function on the default 10-second synchronous limit
-- (netlify.toml sets no `timeout` for it), while src/db.mjs allows a single
-- statement 15 seconds — so one statement is permitted to outlive the whole
-- function, and the caller sees a 504 with no JSON at all.
--
-- Measured live on 2026-08-18: 67 foreign keys point at `clients`. Twenty-
-- three of their child columns had no index:
--
--   refuses the delete (NO ACTION), unindexed — 13
--     affiliate_events, bank_inbox, call_compliance_flags, contracts,
--     documents, events, failed_events, mail_responses, owner_notifications,
--     partner_payout_lines, partner_revenue, payment_links,
--     repair_decision_log
--
--   detaches the row (SET NULL) or removes it (CASCADE), unindexed — 10
--     account_magic_links, client_cards, customer_insights, dispute_cases,
--     dispute_items, dispute_letters, dispute_responses, entitlements,
--     investment_holdings, subscriptions
--
-- CASCADE needs the index just as much as NO ACTION does: cascading a delete
-- means finding the child rows, and finding them without an index is the same
-- scan.
--
-- These indexes are not only for deletes. Every screen that asks "show me
-- this client's documents / contracts / events" reads the same columns, and
-- `events` is the busiest table in the database at 790 rows and climbing.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY IT IS WRITTEN AS A LOOP AND NOT AS TWENTY-THREE CREATE INDEX LINES
--
-- The same reason src/demo/simulate-client.mjs now reads its delete list from
-- the catalog: a list typed out by hand goes stale the moment someone adds a
-- table, and nobody notices until a delete hangs. This asks the database which
-- columns are unindexed and indexes those. Re-running it after a new table
-- appears covers the new table too.
--
-- CREATE INDEX CONCURRENTLY is deliberately NOT used, and cannot be:
-- db/migrate.mjs wraps every migration file in BEGIN/COMMIT, and CONCURRENTLY
-- is illegal inside a transaction. db/migrations/093_recurring_bills_org_index.sql
-- already records this. The plain form takes a brief exclusive lock on each
-- table while it builds; on tables this size (the largest client-linked table
-- is `events` at 790 rows) that is milliseconds.

DO $$
DECLARE
  rec     record;
  idx     text;
  created text[] := '{}';
BEGIN
  FOR rec IN
    SELECT DISTINCT
           cl.relname AS table_name,
           a.attname  AS column_name
      FROM pg_constraint con
      JOIN pg_class cl    ON cl.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.clients'::regclass
       AND n.nspname = 'public'
       AND array_length(con.conkey, 1) = 1
       -- only where no index already leads with that column
       AND NOT EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = con.conrelid
            AND i.indkey[0] = a.attnum
       )
     ORDER BY cl.relname, a.attname
  LOOP
    idx := 'idx_' || rec.table_name || '_' || rec.column_name;
    -- Index names are database-wide in Postgres; the table name is already in
    -- it, so a collision here would mean a genuine duplicate.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
      idx, rec.table_name, rec.column_name
    );
    created := array_append(created, rec.table_name || '.' || rec.column_name);
  END LOOP;

  IF array_length(created, 1) > 0 THEN
    RAISE NOTICE '202: indexed % client foreign key column(s): %',
      array_length(created, 1), array_to_string(created, ', ');
  ELSE
    RAISE NOTICE '202: every client foreign key column was already indexed';
  END IF;
END $$;
