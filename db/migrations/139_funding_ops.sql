-- 139_funding_ops.sql — Application decisions + funding closeout (success fee).
--
-- Source: fundhub-docs ghl-crm-source-of-truth.md ~9822–9844
--   APPLICATION_DECISIONS, FUNDING_CLOSEOUT, FUNDING_CLOSEOUT_ITEMS

CREATE TABLE IF NOT EXISTS application_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  application_id   uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  status           text,
  lender_table     lender_table,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_decisions_app_idx
  ON application_decisions (application_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS application_decisions_org_idx
  ON application_decisions (org_id, decided_at DESC);

COMMENT ON TABLE application_decisions IS
  'Audit trail of every applications.status change. No silent status writes.';

-- Success-fee closeout when a funding round is finalized.
CREATE TABLE IF NOT EXISTS funding_closeout (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  funding_round_id       uuid NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
  total_approved_amount  numeric(14,2) NOT NULL DEFAULT 0,
  total_fee              numeric(14,2) NOT NULL DEFAULT 0,  -- 10% of approved
  balance_due            numeric(14,2) NOT NULL DEFAULT 0,
  fee_percent            numeric(6,4) NOT NULL DEFAULT 0.10,
  status                 text NOT NULL DEFAULT 'open',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funding_round_id)
);

CREATE INDEX IF NOT EXISTS funding_closeout_org_idx
  ON funding_closeout (org_id, created_at DESC);

DROP TRIGGER IF EXISTS funding_closeout_set_updated_at ON funding_closeout;
CREATE TRIGGER funding_closeout_set_updated_at
  BEFORE UPDATE ON funding_closeout
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE funding_closeout IS
  'Closing record when a funding round is finalized. total_fee defaults to 10% of approved.';

CREATE TABLE IF NOT EXISTS funding_closeout_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  funding_closeout_id  uuid NOT NULL REFERENCES funding_closeout(id) ON DELETE CASCADE,
  application_id       uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  approved_amount      numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount           numeric(14,2) NOT NULL DEFAULT 0,
  lender_name          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funding_closeout_id, application_id)
);

CREATE INDEX IF NOT EXISTS funding_closeout_items_closeout_idx
  ON funding_closeout_items (funding_closeout_id);
CREATE INDEX IF NOT EXISTS funding_closeout_items_app_idx
  ON funding_closeout_items (application_id);

COMMENT ON TABLE funding_closeout_items IS
  'One row per Approved application included in a funding closeout.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON application_decisions TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON funding_closeout TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON funding_closeout_items TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
