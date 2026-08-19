-- 237 — the index the affiliate REFERRED count needs
--
-- WHY THIS EXISTS
--
-- /api/read/affiliates counts a referral from two places: the structured
-- affiliate_referrals row, and the code the live capture leaves behind on
-- clients.custom_fields.affiliate_tier1_owner. The second one is matched with
--
--     upper(btrim(custom_fields->>'affiliate_tier1_owner')) = upper(tracking_id)
--
-- and no index in this database covers that expression. An expression is not
-- covered by an index on the column it reads, so Postgres had one option: read
-- every client row and test each one. That lookup sits inside a LATERAL join,
-- so it runs ONCE PER AFFILIATE ROW RETURNED. An affiliate reading their own
-- screen returns one row and is fine. The owner and finance roster returns up
-- to 200, which meant up to 200 full passes over clients in a single request —
-- fine on today's table, and the kind of thing that quietly turns into a
-- thirty-second page as the client list grows.
--
-- WHAT THIS DOES
--
-- Indexes exactly the expression the query matches on, in the same order the
-- query filters: org first, then the normalised code. Partial, because the
-- overwhelming majority of clients carry no affiliate code at all and there is
-- no reason to index absence.
--
-- It changes no data and no behaviour. Every number the screen shows is
-- identical with or without it; only the time taken to produce it moves.
--
-- CONCURRENTLY is deliberately NOT used: db/migrate.mjs runs each file inside a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run in one. This table is
-- small enough that the brief write lock is not a concern.

CREATE INDEX IF NOT EXISTS clients_affiliate_tier1_owner_idx
  ON clients (org_id, upper(btrim(custom_fields->>'affiliate_tier1_owner')))
  WHERE custom_fields->>'affiliate_tier1_owner' IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'clients_affiliate_tier1_owner_idx') THEN
    RAISE NOTICE '237: clients_affiliate_tier1_owner_idx present';
  ELSE
    RAISE EXCEPTION '237: clients_affiliate_tier1_owner_idx was not created';
  END IF;
END $$;
