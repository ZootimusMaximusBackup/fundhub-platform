-- 257_invoice_payment_allocation.sql
--
-- COMPLIANCE REVIEW REQUIRED — payment rails.
--
-- 5B.2 (2026-08-23). A payment must land on one invoice. invoice_payments
-- already records the applied amount (031). This file only adds the two
-- missing links:
--   1. payment_links.invoice_id — the checkout we send for an invoice, so the
--      webhook can find that invoice again.
--   2. a unique index on invoice_payments.external_ref — the Commas payment
--      id, so a replayed webhook cannot credit the same payment twice.
--
-- Does not edit 017 or 031. Those files are already applied.

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id);

CREATE INDEX IF NOT EXISTS payment_links_invoice_idx
  ON payment_links (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- One provider payment settles at most one invoice_payments row.
-- Manual / cheque rows have no external_ref and stay nullable.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_external_ref_uniq
  ON invoice_payments (org_id, external_ref)
  WHERE external_ref IS NOT NULL;

COMMENT ON COLUMN payment_links.invoice_id IS
  'Invoice this checkout was minted for. Round-trips through Commas metadata and link_ref so payment.received can allocate to this invoice, not another open one.';
