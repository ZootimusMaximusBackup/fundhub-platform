-- 003 — indexes that make the handler layer's writes idempotent (replay-safe).
-- Master Rebuild Spec Rule 9: events replay safely → the side effects they drive
-- must be idempotent too. These give the client-lifecycle handlers a clean
-- find-or-create (by email) and a dedup key for payments (by provider ref).

-- One client per (org, email). Partial: only rows that actually have an email.
CREATE UNIQUE INDEX IF NOT EXISTS clients_org_email_uniq
  ON clients (org_id, lower(email))
  WHERE email IS NOT NULL;

-- A payment provider ref (e.g. the Commas transaction id) is unique per org, so a
-- re-delivered / replayed payment event can ON CONFLICT DO NOTHING instead of
-- inserting a duplicate transaction row.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_org_providerref_uniq
  ON transactions (org_id, provider_ref)
  WHERE provider_ref IS NOT NULL;
