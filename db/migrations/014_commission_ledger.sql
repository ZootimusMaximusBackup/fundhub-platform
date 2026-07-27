-- 014 — COMMISSION LEDGER. Commission earned is a record, not a calculation.
--
-- Nothing reads this table and recomputes. The amount was decided once, at the
-- moment of earning, using the rule version in effect then, and it is stored
-- with a frozen copy of that rule. A payout report from March still reads the
-- same in December after four rate changes and two product renames.
--
-- States: earned -> approved -> paid, plus void. Forward only.
-- Money that has to come back is a NEGATIVE row pointing at the original, never
-- an edit and never a delete (CHRIS PROVISIONAL #7).

CREATE TABLE IF NOT EXISTS commission_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- WHO. Snapshotted codes so a payout report is readable standalone and stays
  -- correct even if a code is ever reissued or a name changes.
  staff_id      uuid NOT NULL REFERENCES staff(id),
  employee_code text,
  client_id     uuid REFERENCES clients(id),
  client_code   text,

  -- WHERE IT CAME FROM.
  sale_id          uuid REFERENCES sales(id),
  funding_round_id uuid REFERENCES funding_rounds(id),
  product_id       uuid REFERENCES products(id),

  -- The product name AS IT WAS when this was earned. products.name is editable;
  -- this column is why a rename cannot rewrite an old payout report. The live
  -- name is always one join away via product_id when you want it instead.
  product_name_at_earning text,

  basis         text NOT NULL CHECK (basis IN ('front_end', 'back_end')),
  role          text,

  -- WHICH RULE, AND WHAT IT SAID AT THE TIME.
  -- rule_id is a pointer for traceability. rule_snapshot is the answer to
  -- "why is this number what it is" and does not depend on the rule row
  -- surviving unedited.
  rule_id       uuid REFERENCES commission_rules(id),
  rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  stacking      text NOT NULL DEFAULT 'base' CHECK (stacking IN ('base', 'bonus')),

  -- THE MATH, kept auditable.
  base_amount   numeric(14,2),          -- what the rate applied to
  split_percent numeric(7,4) NOT NULL DEFAULT 100,
  amount        numeric(14,2) NOT NULL, -- negative on a reversal
  currency      text NOT NULL DEFAULT 'USD',

  status        text NOT NULL DEFAULT 'earned'
    CHECK (status IN ('earned', 'approved', 'paid', 'void')),

  -- earned_at is the BUSINESS time of the triggering event (the deposit landing,
  -- the round funding), not when the row happened to be written.
  earned_at     timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  approved_by   text,
  paid_at       timestamptz,
  paid_by       text,
  payout_ref    text,                   -- cheque number, batch id, however it went out
  void_reason   text,

  -- Clawback: a negative row referencing the row it reverses. Defaults to a full
  -- reversal; the mechanism accepts a partial amount because prorating is a
  -- case-by-case call a human makes.
  reverses_ledger_id uuid REFERENCES commission_ledger(id),

  source_event  text,   -- deposit.paid | sale.closed | round.funded | manual | reversal

  -- Replay safety (Rule 9). The calculator derives this deterministically, so a
  -- re-delivered round.funded produces the same key and lands on the unique
  -- index instead of paying somebody twice.
  idempotency_key text,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commission_ledger_split_range CHECK (split_percent > 0 AND split_percent <= 100),
  CONSTRAINT commission_ledger_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_idem_uniq
  ON commission_ledger (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS commission_ledger_staff_idx
  ON commission_ledger (org_id, staff_id, status, earned_at DESC);
CREATE INDEX IF NOT EXISTS commission_ledger_client_idx ON commission_ledger (client_id);
CREATE INDEX IF NOT EXISTS commission_ledger_sale_idx   ON commission_ledger (sale_id);
CREATE INDEX IF NOT EXISTS commission_ledger_round_idx  ON commission_ledger (funding_round_id);
CREATE INDEX IF NOT EXISTS commission_ledger_payable_idx
  ON commission_ledger (org_id, staff_id) WHERE status = 'approved';

-- ---------------------------------------------------------------------------
-- History cannot be rewritten. Not by the UI, not by a script, not by accident.
--
-- Once a row is approved or paid, the numbers are frozen at the database level.
-- The only way to change what somebody is owed after approval is a reversing
-- row, which leaves both facts on the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commission_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('approved', 'paid') THEN
    IF NEW.amount        IS DISTINCT FROM OLD.amount
    OR NEW.base_amount   IS DISTINCT FROM OLD.base_amount
    OR NEW.split_percent IS DISTINCT FROM OLD.split_percent
    OR NEW.rule_snapshot IS DISTINCT FROM OLD.rule_snapshot
    OR NEW.rule_id       IS DISTINCT FROM OLD.rule_id
    OR NEW.earned_at     IS DISTINCT FROM OLD.earned_at
    OR NEW.staff_id      IS DISTINCT FROM OLD.staff_id THEN
      RAISE EXCEPTION
        'commission_ledger %: amounts are frozen once status is % — post a reversing row instead',
        OLD.id, OLD.status;
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'earned'   AND NEW.status IN ('approved', 'void')) OR
      (OLD.status = 'approved' AND NEW.status IN ('paid', 'void')) OR
      (OLD.status = 'paid'     AND NEW.status = 'paid')
    ) THEN
      RAISE EXCEPTION
        'commission_ledger %: cannot move status from % to % (earned -> approved -> paid, or void)',
        OLD.id, OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commission_ledger_guard ON commission_ledger;
CREATE TRIGGER trg_commission_ledger_guard
  BEFORE UPDATE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION commission_ledger_guard();

DROP TRIGGER IF EXISTS trg_commission_ledger_updated ON commission_ledger;
CREATE TRIGGER trg_commission_ledger_updated BEFORE UPDATE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- v_commission_statement — what a payout report reads.
--
-- Live product and staff names for the screen, snapshot name alongside so a
-- rename is visible rather than silent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_commission_statement AS
SELECT
  l.id,
  l.org_id,
  l.staff_id,
  l.employee_code,
  s.name                        AS staff_name,
  l.role,
  l.basis,
  l.stacking,
  l.client_id,
  l.client_code,
  trim(both ' ' from coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) AS client_name,
  l.sale_id,
  l.funding_round_id,
  l.product_id,
  p.name                        AS product_name_now,
  l.product_name_at_earning,
  l.base_amount,
  l.split_percent,
  l.amount,
  l.currency,
  l.status,
  l.earned_at,
  l.approved_at,
  l.paid_at,
  l.payout_ref,
  l.reverses_ledger_id,
  l.source_event,
  date_trunc('month', l.earned_at) AS earned_month
FROM commission_ledger l
LEFT JOIN staff    s ON s.id = l.staff_id
LEFT JOIN clients  c ON c.id = l.client_id
LEFT JOIN products p ON p.id = l.product_id;

-- ---------------------------------------------------------------------------
-- v_sale_balance — what AR needs.
--
-- agreed price + success fee earned on funded rounds - money received.
-- Success fee is computed from the percent frozen on the SALE against the
-- funded amount of the rounds linked to that sale. Refunds subtract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sale_balance AS
WITH fee AS (
  SELECT frs.sale_id,
         SUM(COALESCE(fr.funded_amount, 0)) AS funded_total
    FROM funding_round_sales frs
    JOIN funding_rounds fr ON fr.id = frs.funding_round_id
   GROUP BY frs.sale_id
),
paid AS (
  SELECT sp.sale_id,
         SUM(CASE WHEN sp.kind = 'refund' THEN -sp.amount ELSE sp.amount END) AS received,
         SUM(CASE WHEN sp.kind = 'deposit' THEN sp.amount ELSE 0 END)         AS deposits,
         SUM(CASE WHEN sp.kind = 'refund'  THEN sp.amount ELSE 0 END)         AS refunds
    FROM sale_payments sp
   GROUP BY sp.sale_id
)
SELECT
  sa.id            AS sale_id,
  sa.org_id,
  sa.client_id,
  c.client_code,
  sa.product_id,
  p.name           AS product_name,
  sa.status        AS sale_status,
  sa.sold_at,
  sa.agreed_price,
  sa.agreed_success_fee_percent,
  COALESCE(fee.funded_total, 0)                                                        AS funded_total,
  ROUND(COALESCE(fee.funded_total, 0) * COALESCE(sa.agreed_success_fee_percent, 0) / 100, 2)
                                                                                       AS success_fee_due,
  COALESCE(paid.deposits, 0)                                                           AS deposits_collected,
  COALESCE(paid.refunds, 0)                                                            AS refunded,
  COALESCE(paid.received, 0)                                                           AS amount_received,
  sa.agreed_price
    + ROUND(COALESCE(fee.funded_total, 0) * COALESCE(sa.agreed_success_fee_percent, 0) / 100, 2)
    - COALESCE(paid.received, 0)                                                       AS balance_due
FROM sales sa
LEFT JOIN clients  c   ON c.id = sa.client_id
LEFT JOIN products p   ON p.id = sa.product_id
LEFT JOIN fee          ON fee.sale_id  = sa.id
LEFT JOIN paid         ON paid.sale_id = sa.id;
