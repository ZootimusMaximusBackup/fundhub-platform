-- 031 — INVOICES: money OWED. The AR model.
--
-- `transactions` (001_init.sql) and `sale_payments` (011) record money RECEIVED.
-- Until this migration there was no record of money OWED with a lifecycle on it,
-- and four things were stuck against that gap:
--
--   AR-01..AR-04  — the whole AR ladder is gated on "Balance Due > 0" and there
--                   was no balance to gate on (workflow-migration-table.md).
--   DS-02         — its invoice step is a staff-task stub.
--   F-07          — cannot enforce a fee lock: nothing holds the invoiced figure,
--                   so nothing can stop it being restated after the client sees it.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS AN ALTER AND NOT A CREATE
-- ---------------------------------------------------------------------------
-- 017_invoices.sql already shipped a first-cut `invoices` table (invoice_type /
-- amount / draft|sent|paid|overdue|void, no line items, no payments, no balance).
-- 017 is not edited — the applied-migration history on any database that already
-- ran it stays clean, exactly as 016 did for 014. This migration grows that stub
-- into the model AR needs:
--
--   * renames    amount -> amount_due, provider_ref -> external_ref,
--                issued_at -> sent_at   (the names 011/AR actually use)
--   * adds       source, source_event_id, escalated_at, reminded_at,
--                reminder_count, written_off_at, write_off_reason
--   * widens     status to the eight AR states
--   * retires    invoice_type to a compatibility projection of source
--   * adds       invoice_line_items, invoice_payments
--   * adds       v_invoice_balance, v_invoice_aging, v_client_ar_balance
--   * locks      the invoiced figure once the invoice leaves draft (F-07)
--
-- Every statement is guarded. The file is re-runnable end to end.
--
-- ---------------------------------------------------------------------------
-- THE ONE NUMBER THIS MIGRATION REFUSES TO PRODUCE
-- ---------------------------------------------------------------------------
-- amount_due is an INPUT. Nothing here derives the funding success fee.
--
-- GHL's F-07 copies total_approved_amount straight into Commission Owed and then
-- into Balance Due, with no fee-percent multiplication, despite gating the step
-- on a fee percent existing. Whether approved_amount already IS the fee amount is
-- unresolved (workflow-migration-table.md decision #4). A wrong formula here puts
-- a wrong dollar figure in front of a real client, so the formula is not written.
-- See src/invoices/invoice-model-open-questions.md — Q1.
--
-- What IS derived, always, and never stored:
--   amount_paid  = sum of invoice_payments (payments minus refunds/chargebacks)
--   balance_due  = amount_due - amount_paid
--
-- Both live in v_invoice_balance. Neither is a column. A stored balance is a
-- balance that drifts the first time a payment lands outside the one code path
-- that maintains it. (amount_paid is listed as a column in the AR proposal; it is
-- deliberately a view column instead, for the same reason as balance_due — it is
-- a sum of another table. `SELECT amount_due, amount_paid, balance_due FROM
-- v_invoice_balance` reads exactly as the proposal does.)

-- ===========================================================================
-- 1. invoices — grow 017's table
-- ===========================================================================

-- --- 1a. renames --------------------------------------------------------------
-- Column renames are guarded on both directions so a re-run is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'amount')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'amount_due') THEN
    ALTER TABLE invoices RENAME COLUMN amount TO amount_due;
  END IF;

  -- 011 names this column external_ref on sales. Same thing, same name.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'provider_ref')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'external_ref') THEN
    ALTER TABLE invoices RENAME COLUMN provider_ref TO external_ref;
  END IF;

  -- 017 set issued_at from markSent(). It was always the sent timestamp.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'issued_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'sent_at') THEN
    ALTER TABLE invoices RENAME COLUMN issued_at TO sent_at;
  END IF;

  -- The CHECK travelled with the rename; give it a name that still reads true.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass
                                           AND conname  = 'invoices_amount_check')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass
                                                   AND conname  = 'invoices_amount_due_check') THEN
    ALTER TABLE invoices RENAME CONSTRAINT invoices_amount_check TO invoices_amount_due_check;
  END IF;
END $$;

-- --- 1b. new columns ----------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source           text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_event_id  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminded_at      timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_count   integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS escalated_at     timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS written_off_at   timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS write_off_reason text;

-- source: which side of the business this invoice came from. Backfilled from
-- 017's invoice_type. That mapping is lossy in one direction only — 'deposit'
-- and 'platform_fee' rows cannot say whether they were DIY letters, a repair
-- bundle or something else, so they land on 'other' rather than being guessed at.
UPDATE invoices
   SET source = CASE invoice_type
                  WHEN 'success_fee' THEN 'funding_success_fee'
                  ELSE 'other'
                END
 WHERE source IS NULL;

ALTER TABLE invoices ALTER COLUMN source SET NOT NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
ALTER TABLE invoices ADD  CONSTRAINT invoices_source_check CHECK (
  source IN ('funding_success_fee', 'diy_letters', 'repair_bundle', 'backend_selling', 'other')
);

-- --- 1c. status: the eight AR states -----------------------------------------
-- 'overdue' is gone on purpose. Overdue is not a state somebody sets; it is
-- due_at < now() with a balance outstanding, and it is computed in
-- v_invoice_aging. Storing it guarantees a row that is overdue in fact and
-- 'sent' in the database, or the reverse. No writer ever set it, so this UPDATE
-- is defensive only.
UPDATE invoices SET status = 'sent' WHERE status = 'overdue';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD  CONSTRAINT invoices_status_check CHECK (
  status IN ('draft', 'sent', 'reminded', 'escalated',
             'paid', 'partially_paid', 'written_off', 'void')
);

-- status is the DUNNING state — where this invoice sits on the AR ladder. The
-- settlement truth (unpaid / partially_paid / settled) is derived from payments
-- in v_invoice_balance. Where the two disagree, the view is right and the row is
-- stale; v_invoice_aging surfaces that as status_reconciled = false rather than
-- hiding it.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_written_off_reason;
ALTER TABLE invoices ADD  CONSTRAINT invoices_written_off_reason CHECK (
  status <> 'written_off' OR write_off_reason IS NOT NULL
);

-- --- 1d. invoice_type: retired to a projection of source ----------------------
-- Nothing outside src/invoices/ ever read this column, but it is left in place
-- and kept truthful rather than dropped, so a database that ran 017 keeps its
-- history readable and any writer still passing the old vocabulary keeps working.
-- The trigger below makes drift impossible in either direction.
ALTER TABLE invoices ALTER COLUMN invoice_type DROP NOT NULL;

COMMENT ON COLUMN invoices.invoice_type IS
  'DEPRECATED (031). Legacy 017 vocabulary, maintained as a projection of source '
  'by trg_invoices_sync_legacy_type. Read source instead. Drop once nothing reads it.';

CREATE OR REPLACE FUNCTION invoices_sync_legacy_type() RETURNS trigger AS $$
BEGIN
  -- Legacy writer passed invoice_type only: derive source. Lossy on 'deposit'
  -- and 'platform_fee', which is why source is the canonical column.
  IF NEW.source IS NULL AND NEW.invoice_type IS NOT NULL THEN
    NEW.source := CASE NEW.invoice_type
                    WHEN 'success_fee' THEN 'funding_success_fee'
                    ELSE 'other'
                  END;
  END IF;

  -- Canonical writer passed source: project it onto the legacy column so the two
  -- can never contradict each other on any row this table has ever held.
  IF NEW.source IS NOT NULL THEN
    NEW.invoice_type := CASE NEW.source
                          WHEN 'funding_success_fee' THEN 'success_fee'
                          WHEN 'diy_letters'         THEN 'deposit'
                          WHEN 'repair_bundle'       THEN 'deposit'
                          WHEN 'backend_selling'     THEN 'platform_fee'
                          ELSE 'platform_fee'
                        END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_sync_legacy_type ON invoices;
CREATE TRIGGER trg_invoices_sync_legacy_type
  BEFORE INSERT OR UPDATE OF source, invoice_type ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_sync_legacy_type();

-- --- 1e. indexes --------------------------------------------------------------
-- Tenant integrity for the child tables: a line item or a payment cannot belong
-- to one org and hang off another org's invoice. Enforced by composite FK, which
-- needs this unique index to reference.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_id_org_uniq ON invoices (id, org_id);

-- Two idempotency dimensions, both real, both absorbed by ON CONFLICT DO NOTHING:
--   idempotency_key  — derived deterministically by the producer
--                      (invoice|funding_success_fee|<sale>|<round>). Survives a
--                      replay that arrives under a brand new event id.
--   source_event_id  — the events.id that caused this invoice (Rule 9). Survives
--                      a producer that changes how it builds its key.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_event_uniq
  ON invoices (org_id, source_event_id) WHERE source_event_id IS NOT NULL;

-- One invoice per provider reference. Mirrors sales_org_external_ref_uniq (011).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_external_ref_uniq
  ON invoices (org_id, provider, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_source_idx ON invoices (org_id, source, status);

-- The AR worklist: everything chaseable, oldest due first. This is the index
-- AR-01..AR-04 read.
CREATE INDEX IF NOT EXISTS invoices_ar_open_idx
  ON invoices (org_id, due_at)
  WHERE status IN ('sent', 'reminded', 'escalated', 'partially_paid');

-- ===========================================================================
-- 2. invoice_line_items — an invoice can cover more than one thing
-- ===========================================================================
-- The invoice's own amount_due stays authoritative: it is what was agreed and
-- what the client owes. Line items are the breakdown, and v_invoice_balance
-- reports whether they add up (line_items_reconciled) rather than a constraint
-- forcing them to. Forcing it would make the common case — write the invoice,
-- then write its lines — impossible in a single transaction.
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  invoice_id  uuid NOT NULL,

  -- Stable position within the invoice. Also the idempotency key: replaying the
  -- event that built this invoice writes line 1..n again and the unique index
  -- absorbs it, instead of doubling the breakdown (Rule 9).
  line_no     integer NOT NULL CHECK (line_no > 0),

  description text NOT NULL,

  -- Nullable: a line can be a fee, an adjustment or a manual charge with no
  -- product record behind it. When it does have one it points at the RECORD
  -- (010), never a copied name, so a rename cannot rewrite an old invoice.
  product_id  uuid REFERENCES products(id),

  -- The product name AS IT WAS when the invoice was raised. Same reasoning as
  -- commission_ledger.product_name_at_earning (014): an invoice PDF reissued in
  -- December must still say what the client agreed to in July.
  product_name_at_invoicing text,

  -- Signed on purpose. A discount or credit line is negative. The sum is what
  -- must reconcile to amount_due, not each row.
  amount      numeric(14,2) NOT NULL,

  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_line_items_invoice_fk
    FOREIGN KEY (invoice_id, org_id) REFERENCES invoices (id, org_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_line_items_line_uniq
  ON invoice_line_items (invoice_id, line_no);
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_line_items_product_idx ON invoice_line_items (product_id);

-- ===========================================================================
-- 3. invoice_payments — partial payments are normal
-- ===========================================================================
-- One payment closing one invoice is the easy case, not the model. A client pays
-- half the success fee in October and the rest in December; AR chases the
-- remainder in between. That is three facts, and each one is a row here.
--
-- Money that comes BACK is a row too — never an edit, never a delete. Same law
-- as commission_ledger (014/016): the record of what happened does not get
-- rewritten when it turns out to be inconvenient.
CREATE TABLE IF NOT EXISTS invoice_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  invoice_id     uuid NOT NULL,

  -- The Commas/provider payment this settles, when there is one. Nullable: a
  -- wire, a cheque, or Chris taking it on the phone has no transactions row.
  transaction_id uuid REFERENCES transactions(id),

  -- The sale_payments row (011) recording the SAME money on the sale side, when
  -- the invoice traces to a sale. Kept as a link rather than a duplicate so
  -- v_sale_balance and v_invoice_balance can be reconciled against each other
  -- instead of quietly double-counting one payment across two models.
  sale_payment_id uuid REFERENCES sale_payments(id),

  -- payment     — money in
  -- refund      — money returned to the client
  -- chargeback  — money pulled back by the provider
  -- correction  — a mis-entered payment cancelled out; the wrong row stays
  -- Stored POSITIVE in every case, exactly like sale_payments (011). The views
  -- subtract the three that are not 'payment'.
  kind           text NOT NULL DEFAULT 'payment'
    CHECK (kind IN ('payment', 'refund', 'chargeback', 'correction')),

  amount         numeric(14,2) NOT NULL CHECK (amount > 0),

  -- No currency column: a payment is in its invoice's currency. A second copy is
  -- a second thing that can disagree.
  method         text,          -- card | ach | wire | check | manual | ... (free text on purpose)
  external_ref   text,          -- the provider's payment id
  source_event_id text,         -- the events.id that produced this row (Rule 9)

  paid_at        timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_payments_invoice_fk
    FOREIGN KEY (invoice_id, org_id) REFERENCES invoices (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (invoice_id, paid_at);
CREATE INDEX IF NOT EXISTS invoice_payments_org_idx     ON invoice_payments (org_id, paid_at DESC);

-- Three independent replay guards. A bare ON CONFLICT DO NOTHING covers all of
-- them at once, so whichever key the producer happens to carry, a re-delivered
-- webhook lands on an index instead of crediting the client twice.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_txn_uniq
  ON invoice_payments (org_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_event_uniq
  ON invoice_payments (org_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_sale_payment_uniq
  ON invoice_payments (org_id, sale_payment_id) WHERE sale_payment_id IS NOT NULL;

-- ===========================================================================
-- 4. The fee lock (F-07) — and immutability
-- ===========================================================================
-- F-07's whole problem is that nothing held the invoiced figure still. Once an
-- invoice leaves draft the client has been told a number, so the number stops
-- being editable at the database level — not by the UI, not by a script, not by
-- a replayed event handler with a newly-computed fee. The way to change what a
-- client owes after that is to void and reissue, which leaves both facts on the
-- record.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.amount_due       IS DISTINCT FROM OLD.amount_due
    OR NEW.currency         IS DISTINCT FROM OLD.currency
    OR NEW.source           IS DISTINCT FROM OLD.source
    OR NEW.client_id        IS DISTINCT FROM OLD.client_id
    OR NEW.org_id           IS DISTINCT FROM OLD.org_id
    OR NEW.sale_id          IS DISTINCT FROM OLD.sale_id
    OR NEW.funding_round_id IS DISTINCT FROM OLD.funding_round_id THEN
      RAISE EXCEPTION
        'invoices %: the invoiced figure is locked once status is % — void and reissue instead',
        OLD.id, OLD.status;
    END IF;
  END IF;

  -- void is terminal. A voided invoice never comes back; a replacement is a new
  -- invoice, so the void and the reissue are both visible.
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'invoices %: void is terminal — raise a new invoice instead', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_guard ON invoices;
CREATE TRIGGER trg_invoices_guard
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();

-- The same lock at the line level: the breakdown behind a number the client has
-- seen cannot be rewritten either, or the total and its explanation drift apart.
CREATE OR REPLACE FUNCTION invoice_line_items_guard() RETURNS trigger AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_status     text;
BEGIN
  SELECT status INTO v_status FROM invoices WHERE id = v_invoice_id;

  -- No row: the parent is being cascade-deleted, or does not exist yet in this
  -- transaction. Nothing to protect either way.
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'invoice_line_items: invoice % is % — its breakdown is locked; void and reissue instead',
    v_invoice_id, v_status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_line_items_guard ON invoice_line_items;
CREATE TRIGGER trg_invoice_line_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION invoice_line_items_guard();

-- Deleting an invoice or a payment frees its idempotency key, and the next
-- replay of the event that produced it invoices or credits the client a second
-- time. Same gap 016 closed on commission_ledger, same fix.
CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'invoices %: invoices are not deleted — void or write off instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_no_delete ON invoices;
CREATE TRIGGER trg_invoices_no_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_no_delete();

CREATE OR REPLACE FUNCTION invoice_payments_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'invoice_payments %: payments are immutable — post a correction row instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_payments_no_delete ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_no_delete
  BEFORE DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION invoice_payments_no_delete();

-- updated_at, per the 001_init.sql convention.
DROP TRIGGER IF EXISTS trg_invoice_line_items_updated ON invoice_line_items;
CREATE TRIGGER trg_invoice_line_items_updated BEFORE UPDATE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_invoice_payments_updated ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_updated BEFORE UPDATE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 5. v_invoice_balance — amount_paid and balance_due, computed, every time
-- ===========================================================================
-- Dropped in dependency order rather than CREATE OR REPLACE'd: replacing a view
-- in place forbids reordering or renaming its columns, which would make every
-- later change to this model a fight with Postgres. Nothing outside this file
-- depends on these three; if something ever does, this DROP fails loudly instead
-- of quietly leaving a stale definition behind.
DROP VIEW IF EXISTS v_client_ar_balance;
DROP VIEW IF EXISTS v_invoice_aging;
DROP VIEW IF EXISTS v_invoice_balance;

CREATE VIEW v_invoice_balance AS
WITH pay AS (
  SELECT p.invoice_id,
         SUM(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END) AS amount_paid,
         SUM(CASE WHEN p.kind = 'payment' THEN p.amount ELSE 0 END)         AS gross_paid,
         SUM(CASE WHEN p.kind = 'refund'  THEN p.amount ELSE 0 END)         AS refunded,
         SUM(CASE WHEN p.kind IN ('chargeback', 'correction') THEN p.amount ELSE 0 END) AS reversed,
         COUNT(*)                                                           AS payment_count,
         MAX(p.paid_at)                                                     AS last_payment_at
    FROM invoice_payments p
   GROUP BY p.invoice_id
),
lines AS (
  SELECT l.invoice_id,
         SUM(l.amount) AS line_items_total,
         COUNT(*)      AS line_item_count
    FROM invoice_line_items l
   GROUP BY l.invoice_id
)
SELECT
  i.id                                   AS invoice_id,
  i.org_id,
  i.client_id,
  c.client_code,
  i.source,
  i.status,
  i.sale_id,
  i.funding_round_id,
  i.currency,
  i.amount_due,
  COALESCE(pay.amount_paid, 0)                        AS amount_paid,
  i.amount_due - COALESCE(pay.amount_paid, 0)         AS balance_due,
  COALESCE(pay.gross_paid, 0)                         AS gross_paid,
  COALESCE(pay.refunded, 0)                           AS refunded,
  COALESCE(pay.reversed, 0)                           AS reversed,
  COALESCE(pay.payment_count, 0)                      AS payment_count,
  pay.last_payment_at,
  COALESCE(lines.line_items_total, 0)                 AS line_items_total,
  COALESCE(lines.line_item_count, 0)                  AS line_item_count,
  -- Reported, not enforced. An invoice with no breakdown is fine; an invoice
  -- whose breakdown does not add up to what was billed is a thing somebody
  -- should see.
  (lines.line_item_count IS NULL
     OR COALESCE(lines.line_items_total, 0) = i.amount_due)  AS line_items_reconciled,

  -- What the payments actually say, independent of the dunning state.
  CASE
    WHEN i.status = 'void'         THEN 'void'
    WHEN i.status = 'written_off'  THEN 'written_off'
    WHEN COALESCE(pay.amount_paid, 0) >= i.amount_due THEN 'settled'
    WHEN COALESCE(pay.amount_paid, 0) > 0             THEN 'partially_paid'
    ELSE 'unpaid'
  END                                                  AS settlement_state,

  -- What AR is owed. void and written_off contribute nothing.
  CASE
    WHEN i.status IN ('void', 'written_off') THEN 0
    ELSE GREATEST(i.amount_due - COALESCE(pay.amount_paid, 0), 0)
  END                                                  AS open_balance,

  -- Carried through so a handler can correlate a balance back to the event that
  -- raised the invoice without a second query.
  i.idempotency_key,
  i.source_event_id,
  i.external_ref,
  i.provider,
  i.due_at,
  i.sent_at,
  i.reminded_at,
  i.reminder_count,
  i.escalated_at,
  i.paid_at,
  i.written_off_at,
  i.voided_at,
  i.created_at
FROM invoices i
LEFT JOIN clients c ON c.id = i.client_id
LEFT JOIN pay        ON pay.invoice_id   = i.id
LEFT JOIN lines      ON lines.invoice_id = i.id;

-- ===========================================================================
-- 6. v_invoice_aging — the "Balance Due > 0" gate AR-01..AR-04 were missing
-- ===========================================================================
-- Bucket boundaries are stated once here and mirrored by agingBucket() in
-- src/invoices/aging.mjs. If one changes, change both.
--   current : not yet due, or due today
--   1_30 / 31_60 / 61_90 / 90_plus : days past due_at
--   no_due_date : due_at is null — see open question Q2, there is no due-date
--                 policy yet and this migration does not invent one
CREATE VIEW v_invoice_aging AS
SELECT
  b.*,
  CASE WHEN b.due_at IS NULL THEN NULL
       ELSE GREATEST(0, (now()::date - b.due_at::date))
  END                                                              AS days_overdue,
  (b.due_at IS NOT NULL AND b.due_at < now() AND b.open_balance > 0) AS is_overdue,
  CASE
    WHEN b.due_at IS NULL                       THEN 'no_due_date'
    WHEN now()::date - b.due_at::date <= 0      THEN 'current'
    WHEN now()::date - b.due_at::date <= 30     THEN '1_30'
    WHEN now()::date - b.due_at::date <= 60     THEN '31_60'
    WHEN now()::date - b.due_at::date <= 90     THEN '61_90'
    ELSE '90_plus'
  END                                                              AS aging_bucket,
  -- The dunning state and the payment truth agreeing. False means the ladder is
  -- chasing money that has arrived, or calling settled something that has not.
  (   (b.status = 'paid'           AND b.settlement_state = 'settled')
   OR (b.status = 'partially_paid' AND b.settlement_state = 'partially_paid')
   OR (b.status NOT IN ('paid', 'partially_paid'))
  )                                                                AS status_reconciled
FROM v_invoice_balance b;

-- ===========================================================================
-- 7. v_client_ar_balance — one row per client, for the AR pipeline + dashboards
-- ===========================================================================
CREATE VIEW v_client_ar_balance AS
SELECT
  a.org_id,
  a.client_id,
  a.client_code,
  COUNT(*) FILTER (WHERE a.open_balance > 0)                    AS open_invoices,
  COUNT(*) FILTER (WHERE a.is_overdue)                          AS overdue_invoices,
  COALESCE(SUM(a.open_balance), 0)                              AS balance_due,
  COALESCE(SUM(a.open_balance) FILTER (WHERE a.is_overdue), 0)  AS overdue_balance,
  MAX(a.days_overdue) FILTER (WHERE a.open_balance > 0)         AS max_days_overdue,
  MIN(a.due_at)       FILTER (WHERE a.open_balance > 0)         AS oldest_due_at
FROM v_invoice_aging a
WHERE a.status NOT IN ('void', 'written_off')
GROUP BY a.org_id, a.client_id, a.client_code;
