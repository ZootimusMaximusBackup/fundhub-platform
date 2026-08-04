-- t140_inquiry_ops.sql — Inquiry removal ops + AI bureau config + business tradelines.
--
-- TEMPORARY PREFIX. Renumber at merge if peers land 138+/140+.
-- Source: fundhub-docs ghl-crm-source-of-truth.md ~9780–9882
--
-- CRITICAL: business status (inquiry_log.status: open/cleared/disputed) and
-- phone-work status (call_state) are SEPARATE. Never map phone-work into
-- business status.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_case_status') THEN
    CREATE TYPE inquiry_case_status AS ENUM (
      'Queued',
      'Scheduled',
      'In Progress',
      'Completed',
      'Escalated',
      'Blocked',
      'Canceled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_call_state') THEN
    CREATE TYPE inquiry_call_state AS ENUM (
      'not_started',
      'queued',
      'dialing',
      'navigating_ivr',
      'on_hold',
      'talking_to_rep',
      'transferred_to_human',
      'completed',
      'failed',
      'canceled',
      'retry_scheduled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_voice_provider') THEN
    CREATE TYPE inquiry_voice_provider AS ENUM (
      'bland_ai',
      'retell',
      'manual'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inquiry_prep_state') THEN
    CREATE TYPE inquiry_prep_state AS ENUM (
      'staging',
      'Ready for Cleanup',
      'promoted',
      'discarded'
    );
  END IF;
END $$;

-- AI caller's routing table. THREE rows expected (EX, EQ, TU) — ship EMPTY.
-- Do not invent service numbers or IVR paths. Import / edit from CRM.
CREATE TABLE IF NOT EXISTS ai_bureau_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  bureau_code            text NOT NULL,
  bureau_name            text NOT NULL,
  service_number         text,
  ivr_version            text,
  menu_path              text,
  expected_hold_minutes  numeric(8,2),
  transfer_phrase        text,
  hours_of_operation     text,
  retry_limit            integer NOT NULL DEFAULT 3,
  retry_delay_minutes    integer NOT NULL DEFAULT 30,
  active                 boolean NOT NULL DEFAULT true,
  notes                  text,
  last_verified_at       timestamptz,
  last_verified_by       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bureau_code)
);

CREATE INDEX IF NOT EXISTS ai_bureau_config_org_idx
  ON ai_bureau_config (org_id, active);

DROP TRIGGER IF EXISTS ai_bureau_config_set_updated_at ON ai_bureau_config;
CREATE TRIGGER ai_bureau_config_set_updated_at
  BEFORE UPDATE ON ai_bureau_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE ai_bureau_config IS
  'Bureau IVR routing for AI inquiry removal. Empty until owner/advisor edits or imports. Do not invent phone numbers.';

CREATE TABLE IF NOT EXISTS inquiry_removal_cases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  funding_round_id         uuid REFERENCES funding_rounds(id) ON DELETE SET NULL,
  case_id                  text NOT NULL,
  case_status              inquiry_case_status NOT NULL DEFAULT 'Queued',
  selected_bureaus_raw     text,
  ghl_contact_id           text,
  ai_call_scheduled_for    timestamptz,
  ai_call_status           text,
  request_source           text,
  requested_by             text,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  assigned_remover         text,
  fraud_alert_after        text,
  closed_at                timestamptz,
  remover_notes            text,
  inquiry_remover_user_id  text,
  open_inquiry_count       integer NOT NULL DEFAULT 0,
  master_call_state        text,
  hold_duration_display    text,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, case_id)
);

CREATE INDEX IF NOT EXISTS inquiry_removal_cases_org_status_idx
  ON inquiry_removal_cases (org_id, case_status);
CREATE INDEX IF NOT EXISTS inquiry_removal_cases_client_idx
  ON inquiry_removal_cases (client_id);
CREATE INDEX IF NOT EXISTS inquiry_removal_cases_round_idx
  ON inquiry_removal_cases (funding_round_id);

DROP TRIGGER IF EXISTS inquiry_removal_cases_set_updated_at ON inquiry_removal_cases;
CREATE TRIGGER inquiry_removal_cases_set_updated_at
  BEFORE UPDATE ON inquiry_removal_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE inquiry_removal_cases IS
  'AI inquiry removal cases per client/funding round. Linked to clients + funding_rounds.';

-- Staging before promotion to inquiry_log. "Ready for Cleanup" triggers promotion.
CREATE TABLE IF NOT EXISTS inquiry_prep (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES orgs(id),
  client_id                 uuid REFERENCES clients(id) ON DELETE SET NULL,
  prep_state                inquiry_prep_state NOT NULL DEFAULT 'staging',
  promoted_inquiry_record   uuid REFERENCES inquiry_log(id) ON DELETE SET NULL,
  bureau                    text,
  inquiry_name              text,
  inquiry_date              date,
  lender_table              lender_table,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_prep_org_state_idx
  ON inquiry_prep (org_id, prep_state);
CREATE INDEX IF NOT EXISTS inquiry_prep_client_idx
  ON inquiry_prep (client_id);

DROP TRIGGER IF EXISTS inquiry_prep_set_updated_at ON inquiry_prep;
CREATE TRIGGER inquiry_prep_set_updated_at
  BEFORE UPDATE ON inquiry_prep
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE inquiry_prep IS
  'Staging table before promotion to inquiry_log. prep_state Ready for Cleanup is the trigger.';

-- Extend inquiry_log with call-state machine (phone-work). Business status stays in status.
ALTER TABLE inquiry_log
  ADD COLUMN IF NOT EXISTS call_batch_id           text,
  ADD COLUMN IF NOT EXISTS call_state              inquiry_call_state NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS attempt_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at         timestamptz,
  ADD COLUMN IF NOT EXISTS hold_started_at         timestamptz,
  ADD COLUMN IF NOT EXISTS live_agent_reached_at   timestamptz,
  ADD COLUMN IF NOT EXISTS rep_handoff_at          timestamptz,
  ADD COLUMN IF NOT EXISTS voice_provider          inquiry_voice_provider,
  ADD COLUMN IF NOT EXISTS voice_session_id        text,
  ADD COLUMN IF NOT EXISTS script_version          text,
  ADD COLUMN IF NOT EXISTS ivr_version             text,
  ADD COLUMN IF NOT EXISTS bureau_phone_number     text,
  ADD COLUMN IF NOT EXISTS transfer_target_number  text,
  ADD COLUMN IF NOT EXISTS packet_version          text,
  ADD COLUMN IF NOT EXISTS packet_generated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_reason     text,
  ADD COLUMN IF NOT EXISTS call_outcome_summary    text,
  ADD COLUMN IF NOT EXISTS ivr_last_step           text,
  ADD COLUMN IF NOT EXISTS last_dtmf_path          text,
  ADD COLUMN IF NOT EXISTS waiting_for_rep_slot_since timestamptz,
  ADD COLUMN IF NOT EXISTS inquiry_removal_case_id uuid REFERENCES inquiry_removal_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inquiry_log_call_state_idx
  ON inquiry_log (org_id, call_state);
CREATE INDEX IF NOT EXISTS inquiry_log_case_idx
  ON inquiry_log (inquiry_removal_case_id);

COMMENT ON COLUMN inquiry_log.call_state IS
  'Phone-work state machine. SEPARATE from status (business: open/cleared/disputed). Never map one into the other.';

-- Business credit tradelines from CRS pulls (mirror personal tradelines pattern).
-- Existing `tradelines` table holds personal revolving cards for funding calc.
-- This table holds business-bureau lines (creditor, DBT, utilization).
CREATE TABLE IF NOT EXISTS business_tradelines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_id      uuid REFERENCES snapshots(id) ON DELETE SET NULL,
  creditor_name    text NOT NULL,
  account_type     text,
  balance          numeric(14,2),
  dbt              integer,                 -- days beyond terms
  utilization_pct  numeric(8,4),
  source           text NOT NULL DEFAULT 'crs',
  source_ref       uuid REFERENCES crs_results(id) ON DELETE SET NULL,
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_tradelines_client_idx
  ON business_tradelines (client_id);
CREATE INDEX IF NOT EXISTS business_tradelines_snapshot_idx
  ON business_tradelines (snapshot_id);
CREATE INDEX IF NOT EXISTS business_tradelines_org_idx
  ON business_tradelines (org_id);

DROP TRIGGER IF EXISTS business_tradelines_set_updated_at ON business_tradelines;
CREATE TRIGGER business_tradelines_set_updated_at
  BEFORE UPDATE ON business_tradelines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE business_tradelines IS
  'Business credit tradelines from CRS pulls. Linked to snapshots. Empty until CRS extract writes rows.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_bureau_config TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON inquiry_removal_cases TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON inquiry_prep TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON business_tradelines TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
