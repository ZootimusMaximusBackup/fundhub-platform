-- 137 — Money-chain writer idempotency + Commas product routing aliases.
--
-- The money-chain handlers (src/handlers/money-chain.mjs) write sales,
-- sale_payments, funding_rounds, funding_round_sales, commission_ledger, and
-- entitlements off live events. Replay must not double-write (Rule 9).
--
-- sales already has (org_id, external_ref) uniqueness.
-- sale_payments already has (org_id, transaction_id) uniqueness.
-- commission_ledger already has (org_id, idempotency_key) uniqueness.
-- funding_round_sales already has (funding_round_id) uniqueness.
--
-- Missing: a durable key on funding_rounds and on sale_payments when there is
-- no transactions row yet. source_event_id closes both.

-- No FK to events(id): handlers must stay callable from tests and from
-- replayers that may not hold a live events row for every dispatch. The
-- value is still the events.id when the bus created one.
ALTER TABLE funding_rounds
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS funding_rounds_org_source_event_uniq
  ON funding_rounds (org_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- One logical round number per client. Replay of round.started with the same
-- round_number must land on the existing row, not mint a second.
CREATE UNIQUE INDEX IF NOT EXISTS funding_rounds_client_round_uniq
  ON funding_rounds (client_id, round_number);

ALTER TABLE sale_payments
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_org_source_event_uniq
  ON sale_payments (org_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- Commas product strings → product records. resolve_product_id matches name
-- then alias; without these, deposit/CRS/DIY webhooks resolve to nothing and
-- the sale writer cannot start. Owner call 2026-08-04: map the live Commas
-- nameIncludes needles from src/adapters/commas.mjs onto the seeded products.
--
-- One row per lower(alias) — the unique index is case-insensitive, so listing
-- both casings in one INSERT would conflict with itself.
INSERT INTO product_aliases (org_id, product_id, alias, source)
SELECT p.org_id, p.id, v.alias, 'commas'
  FROM products p
  JOIN orgs o ON o.id = p.org_id AND o.is_default
  JOIN (VALUES
    ('diagnostic',         'Business Financial Assessment'),
    ('card-stacking-dfy',  'Consulting Services Deposit'),
    ('consulting-package', 'Consulting Services Package'),
    ('card-stacking-dfy',  'Consulting Success Fee')
  ) AS v(code, alias) ON lower(v.code) = lower(p.code)
 WHERE NOT EXISTS (
   SELECT 1 FROM product_aliases a
    WHERE a.org_id = p.org_id AND lower(a.alias) = lower(v.alias)
 );
