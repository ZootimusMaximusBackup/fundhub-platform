-- 017_invoices.sql
--
-- Canonical invoices table. Records money OWED (distinct from sale_payments /
-- transactions which record money RECEIVED).
--
-- Three workstreams converged on the same gap:
--   DS-02      — Commas checkout invoice (stubbed as a task, now wired here)
--   F-07       — success-fee invoice on round.funded (AX20/AX21 closeout)
--   AR-series  — unpaid invoice → AR pipeline → sequences → AR voice agent
--
-- The invoice.raised vocabulary proposed in src/commissions/PROPOSED-EVENTS.md
-- and the vocabulary implied by the DS-02 + commission open-questions sessions
-- are identical: invoice.raised / invoice.paid. This migration supports those
-- events plus the fuller lifecycle (invoice.created → .sent → .paid → .voided).
--
-- FLAG for Darwin/Chris:
--   due_at policy — neither session specified a due-date rule (net 30? on demand?).
--   Stored as nullable; producers must pass it explicitly or leave null until AR
--   sets a policy. Do NOT invent a default.
--
--   refund path — not modelled here. A voided invoice is the closest analogue;
--   actual money movement goes through sale_payments (kind='refund'). If a
--   partial-credit invoice is ever needed, add a credit_note table then.

CREATE TABLE invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  client_id           uuid NOT NULL REFERENCES clients(id),
  -- optional links to the originating records
  sale_id             uuid REFERENCES sales(id),
  funding_round_id    uuid REFERENCES funding_rounds(id),
  -- type + status
  invoice_type        text NOT NULL
    CHECK (invoice_type IN ('deposit', 'success_fee', 'platform_fee')),
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  -- money
  amount              numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency            text NOT NULL DEFAULT 'USD',
  -- dates
  issued_at           timestamptz,
  due_at              timestamptz,          -- nullable; policy TBD (FLAG above)
  paid_at             timestamptz,
  voided_at           timestamptz,
  -- external provider linkage (Commas / manual)
  provider            text,                 -- 'commas' | 'manual' | null
  provider_ref        text,                 -- Commas invoice id or equivalent
  -- idempotency (same pattern as commission_ledger)
  idempotency_key     text,
  -- audit
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX invoices_idempotency
  ON invoices(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_invoices_org        ON invoices(org_id);
CREATE INDEX idx_invoices_client     ON invoices(client_id);
CREATE INDEX idx_invoices_sale       ON invoices(sale_id)         WHERE sale_id IS NOT NULL;
CREATE INDEX idx_invoices_round      ON invoices(funding_round_id) WHERE funding_round_id IS NOT NULL;
CREATE INDEX idx_invoices_status     ON invoices(org_id, status);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
