-- 011 — SALES + SALE PAYMENTS. The agreed price lives here, not on the product.
--
-- A sale is: this client agreed to buy this product at THIS price on THIS date.
-- Three separate things, exactly as scoped:
--   products.id       — what was sold (identity, survives renames)
--   sales             — the agreement
--   sales.agreed_price— the price THIS client agreed to, frozen at sale time
--
-- Chris can reprice the product tomorrow. Every sale already written keeps the
-- number it was written with. That is not a convention anybody has to remember;
-- there is simply nowhere for a later edit to reach.

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The product RECORD. Never a copied name string. Rename-proof by construction.
  product_id    uuid NOT NULL REFERENCES products(id),

  -- The authoritative price for this one deal. Variable per client (§12: the
  -- Commas custom-amount checkout pattern). Prefilled from products.default_price
  -- on the sale screen, then owned by this row.
  agreed_price  numeric(14,2) NOT NULL CHECK (agreed_price >= 0),

  -- The client-facing success fee agreed at sale (e.g. 10.0000 for the card
  -- stacking DFY back end). Frozen here so a later change to the product default
  -- cannot restate what this client owes. NULL = no success fee on this deal.
  agreed_success_fee_percent numeric(7,4)
    CHECK (agreed_success_fee_percent IS NULL
           OR (agreed_success_fee_percent >= 0 AND agreed_success_fee_percent <= 100)),

  currency      text NOT NULL DEFAULT 'USD',

  -- sold_at is a real business date, not a row timestamp. It is what the
  -- commission calculator can be pointed at for rule versioning, and what a
  -- backdated sale entered on Monday for last Friday must carry.
  sold_at       timestamptz NOT NULL DEFAULT now(),

  -- active     — live deal, commissions accrue
  -- cancelled  — never happened, no money moved
  -- refunded   — money moved and came back; commissions are reversed with a
  --              negative ledger row (014), never deleted
  status        text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'refunded')),

  external_ref  text,      -- Commas order id, contract id, whatever the closer has
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_client_idx  ON sales (client_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS sales_org_idx     ON sales (org_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS sales_product_idx ON sales (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_org_external_ref_uniq
  ON sales (org_id, external_ref) WHERE external_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sale_payments — money actually in the door, per sale.
--
-- This exists because the closer's front end earns on deposit COLLECTED, not on
-- the agreed price at signature (CHRIS PROVISIONAL #4). Without this table there
-- is no way to answer "how much did this client actually pay" and therefore no
-- way to compute what the closer is owed.
--
-- It also gives AR the balance due, via v_sale_balance in 014.
--
-- transactions (001_init.sql) is NOT altered. This links to it instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  sale_id        uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

  -- Nullable: a payment can be recorded by hand (wire, check, Chris took it on
  -- the phone) with no transactions row behind it.
  transaction_id uuid REFERENCES transactions(id),

  -- deposit      — the front-end money the closer earns on
  -- installment  — later payments against the same agreed price
  -- success_fee  — the back-end fee invoiced on round.funded
  -- refund       — money returned. Stored POSITIVE; subtracted in the views.
  kind           text NOT NULL
    CHECK (kind IN ('deposit', 'installment', 'success_fee', 'refund')),

  amount         numeric(14,2) NOT NULL CHECK (amount >= 0),
  paid_at        timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON sale_payments (sale_id, paid_at);

-- Replay safety (Rule 9): a re-delivered Commas webhook maps to the same
-- transaction row, so it cannot be counted twice against the same sale.
CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_org_transaction_uniq
  ON sale_payments (org_id, transaction_id) WHERE transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- funding_round_sales — the months-later link.
--
-- A round funds weeks or months after the sale. To pay the right people we must
-- know which SALE the round belongs to, and that association has to be frozen,
-- not re-derived at funding time from whoever happens to own the client in
-- October.
--
-- Written once, when the round starts. From then on the chain is fixed:
--     round -> sale -> sale_attributions -> the people
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funding_round_sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  funding_round_id uuid NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
  sale_id          uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  -- how the link was made: 'explicit' (a human chose) | 'resolved' (matched the
  -- client's most recent funding-category sale at round start)
  link_method      text NOT NULL DEFAULT 'resolved',
  linked_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- One sale per round. A round cannot belong to two deals.
CREATE UNIQUE INDEX IF NOT EXISTS funding_round_sales_round_uniq
  ON funding_round_sales (funding_round_id);
CREATE INDEX IF NOT EXISTS funding_round_sales_sale_idx ON funding_round_sales (sale_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sales_updated ON sales;
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sale_payments_updated ON sale_payments;
CREATE TRIGGER trg_sale_payments_updated BEFORE UPDATE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_funding_round_sales_updated ON funding_round_sales;
CREATE TRIGGER trg_funding_round_sales_updated BEFORE UPDATE ON funding_round_sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
