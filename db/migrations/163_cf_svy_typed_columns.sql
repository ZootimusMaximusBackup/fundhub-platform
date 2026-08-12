-- 163_cf_svy_typed_columns.sql
-- Additive typed survey columns for client_custom_fields carbon-copy.
-- RUN5 Phase 0: has_business branch + has_negatives routing gate 2.
-- jsonb on clients.custom_fields remains source of truth; these columns are the typed mirror.

ALTER TABLE client_custom_fields
  ADD COLUMN IF NOT EXISTS cf_svy_has_business        text,
  ADD COLUMN IF NOT EXISTS cf_svy_business_revenue    text,
  ADD COLUMN IF NOT EXISTS cf_svy_revenue_verifiable  text,
  ADD COLUMN IF NOT EXISTS cf_svy_available_capital   text,
  ADD COLUMN IF NOT EXISTS cf_svy_has_negatives       text;
