-- fundhub-platform — v1 database schema (Postgres)
-- Source of truth: fundhub-docs /raw/master-rebuild-spec.md § 3 (APPROVED, Chris 2026-07-22).
-- B1 deliverable (Section 16): schema merges first; every builder builds against these types.
--
-- Ground rules baked in:
--   Rule 7  — org_id on EVERY table (default org = fundhub). White-label play later.
--   Rule 8  — outcome labels on every client record from day 1 (model training data).
--   Rule 9  — idempotent events with integer version + safe replay.
--   Rule 6  — pointers only: no credit reports stored here; URLs + state flags.
--   Rule 2  — the 252 GHL custom fields keep EXACT names; ported as typed columns
--             generated from the CRM Source of Truth field export (see clients.custom_fields
--             jsonb as the interim holder + the generation note below).
--
-- Convention: every table has org_id, created_at, updated_at. updated_at maintained by trigger.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at trigger (attached to every table below)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Multi-tenant root (Rule 7). Default org = fundhub.
-- ---------------------------------------------------------------------------
CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,          -- 'fundhub'
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO orgs (slug, name, is_default) VALUES ('fundhub', 'Fundhub', true);

-- =====================  IDENTITY + CRM  =====================================

-- clients: the master CRM record. Carbon copy of all 252 GHL custom fields as
-- TYPED columns (generated from the CRM Source of Truth export in a follow-up
-- migration 002_clients_custom_fields.sql). Until that generation lands, ported
-- cf_* values live in custom_fields (jsonb) so nothing is lost during parallel run.
CREATE TABLE clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  ghl_contact_id    text,                    -- legacy key: migration + parallel-run resolve
  client_master_key text UNIQUE,
  -- identity
  first_name        text,
  last_name         text,
  email             text,
  phone             text,
  -- 252 GHL custom fields (typed columns generated in 002; interim holder here)
  custom_fields     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- outcome labels (Rule 8 — present from client one)
  funded            boolean NOT NULL DEFAULT false,
  funded_amount     numeric(14,2),
  days_to_fund      integer,
  outcome_tier      text,   -- FRAUD_HOLD|MANUAL_REVIEW|REPAIR_ONLY|FUNDING_PLUS_REPAIR|FULL_FUNDING|PREMIUM_STACK
  channel_source    text,
  -- pipeline membership + tags
  pipeline_ids      uuid[] NOT NULL DEFAULT '{}',
  tags              text[] NOT NULL DEFAULT '{}',
  -- consent / DND per channel (Section 7)
  dnd_sms           boolean NOT NULL DEFAULT false,
  dnd_email         boolean NOT NULL DEFAULT false,
  dnd_voice         boolean NOT NULL DEFAULT false,
  consent_sms       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_org   ON clients(org_id);
CREATE INDEX idx_clients_email ON clients(org_id, lower(email));
CREATE INDEX idx_clients_phone ON clients(org_id, phone);
CREATE INDEX idx_clients_ghl   ON clients(ghl_contact_id);

-- pii_identity: SSN full, DOB, addresses. Encrypted at rest, access-logged,
-- surfaced only per the Item 2 visibility spec.
CREATE TABLE pii_identity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ssn_enc      bytea,          -- encrypted at rest (app-layer or pgcrypto)
  dob          date,
  addresses    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pii_client ON pii_identity(client_id);

-- pii_access_log: every read of pii_identity (Item 2 access-logging).
CREATE TABLE pii_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  accessed_by  text NOT NULL,
  field        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- businesses: ports the BUSINESSES table.
CREATE TABLE businesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         text,
  age_months   integer,
  entity_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_businesses_client ON businesses(client_id);

-- =====================  MONEY + FUNDING  ====================================

-- funding_rounds: ports FUNDING_ROUNDS. run_* action flags become API actions.
CREATE TABLE funding_rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  round_number     integer NOT NULL,
  status           text NOT NULL,
  product          text,
  submitted_amount numeric(14,2),
  approved_amount  numeric(14,2),
  funded_amount    numeric(14,2),
  hold_reason      text,
  conditions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rounds_client ON funding_rounds(client_id);

-- applications: per-bank/per-lender rows within a round. Counteroffer = Action Required.
CREATE TABLE applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  funding_round_id  uuid NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
  bank              text,
  status            text,
  approved_amount   numeric(14,2),
  conditions        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_apps_round ON applications(funding_round_id);

-- transactions: ports COMMERCE_TRANSACTIONS. Every Commas payment lands here.
-- Routing is on product NAME only, never amount (existing law).
CREATE TABLE transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid REFERENCES clients(id),
  product_name  text NOT NULL,
  amount_paid   numeric(14,2),
  status        text,
  provider      text NOT NULL DEFAULT 'commas',
  provider_ref  text,
  raw_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_client  ON transactions(client_id);
CREATE INDEX idx_tx_product ON transactions(org_id, lower(product_name));

-- inquiry_log: ports INQUIRY_LOG.
CREATE TABLE inquiry_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bureau        text,
  inquiry       text,
  status        text,
  call_attempts integer NOT NULL DEFAULT 0,
  outcome       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inqlog_client ON inquiry_log(client_id);

-- =====================  PIPELINES + WORK  ===================================

CREATE TABLE pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  key         text NOT NULL,   -- sales | funding_card_stacking | funding_altfin | optimization | inquiry_removal | ar_collections | affiliates_hiring
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE pipeline_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  pipeline_id  uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  key          text NOT NULL,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, key)
);

-- cards: a client's position in a pipeline (opportunities become cards).
CREATE TABLE cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pipeline_id  uuid NOT NULL REFERENCES pipelines(id),
  stage_id     uuid NOT NULL REFERENCES pipeline_stages(id),
  owner        text,
  entered_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cards_client   ON cards(client_id);
CREATE INDEX idx_cards_pipeline ON cards(pipeline_id, stage_id);

-- tasks: ports GHL task-notifications.
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid REFERENCES clients(id),
  assignee        text,
  title           text NOT NULL,
  body            text,
  due_at          timestamptz,
  source_workflow text,
  done            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_open ON tasks(org_id, done) WHERE done = false;

-- =====================  MESSAGING  ==========================================

-- message_templates: 18 SMS (compliant rewrites) + 158 emails + workflow-inline,
-- keyed by existing IDs (SMS-F03-01-ROUND-SUBMITTED etc.).
CREATE TABLE message_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  template_key      text NOT NULL,   -- SMS-F03-01-ROUND-SUBMITTED, etc.
  channel           text NOT NULL,   -- sms | email
  subject           text,            -- email only
  body              text NOT NULL,
  compliance_passed boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, template_key)
);

-- messages: every outbound/inbound across SMS/email/voice.
CREATE TABLE messages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  client_id              uuid REFERENCES clients(id),
  conversation_id        uuid,
  direction              text NOT NULL,   -- outbound | inbound
  channel                text NOT NULL,   -- sms | email | voice
  template_key           text,
  rendered_body          text,
  provider               text,
  provider_ref           text,
  status                 text,
  compliance_check_passed boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_client ON messages(client_id);
CREATE INDEX idx_messages_convo  ON messages(conversation_id);

-- conversations: threaded per client per channel (feeds agents + Context Fetcher).
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  summary     text,
  sentiment   text,   -- Hot | Warm | Cold
  last_pulse_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_convo_client ON conversations(client_id, channel);
ALTER TABLE messages ADD CONSTRAINT fk_messages_convo
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- =====================  ENRICHMENT + DATA  ==================================

-- snapshots: analyzer + CRS snapshots with primary flag (Primary Snapshot rule).
CREATE TABLE snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source      text NOT NULL,   -- analyzer | crs
  is_primary  boolean NOT NULL DEFAULT false,
  bureau      text,
  score       integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_snap_client ON snapshots(client_id);
CREATE UNIQUE INDEX idx_snap_one_primary ON snapshots(client_id) WHERE is_primary;

-- crs_results: full engine output per pull (history, not latest-only).
CREATE TABLE crs_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  result      jsonb NOT NULL,          -- ports latest_crs_result_full
  outcome_tier text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crs_client ON crs_results(client_id, created_at DESC);

-- behavior_scores: nightly scoring output.
CREATE TABLE behavior_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  responsiveness numeric,
  friction       numeric,
  motivation     text,
  scored_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_behavior_client ON behavior_scores(client_id, scored_at DESC);

-- bank_inbox: ports the Mailgun inbox classification rows (F-11 router).
CREATE TABLE bank_inbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid REFERENCES clients(id),
  classification text,
  subject       text,
  body_preview  text,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- mail_universe: Deluxe records (Section 13). Scaffold now, activate after gate.
CREATE TABLE mail_universe (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  campaign_id  text,
  record_slug  text UNIQUE,     -- per-record PURL/QR slug
  fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
  suppressed   boolean NOT NULL DEFAULT false,
  suppression_reason text,
  responded_at timestamptz,
  outcome_tier text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mail_campaign ON mail_universe(campaign_id);

-- events: append-only event log (Rule 9). Every adapter writes here first. Replayable.
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  name            text NOT NULL,        -- entry.captured, deposit.paid, round.funded, ...
  version         integer NOT NULL DEFAULT 1,
  idempotency_key text,
  client_id       uuid REFERENCES clients(id),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  replayed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_events_idem ON events(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_events_name ON events(org_id, name, created_at);

-- =====================  TEAM  ===============================================

CREATE TABLE staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  name        text NOT NULL,
  role        text,   -- owner | admin | funding_advisor | closer | inquiry_specialist | setter
                      -- | partner (external, see 036_partner_role.sql). Catalog: staff_roles.
  comp        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  staff_id     uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_shifts_open ON shifts(staff_id) WHERE ended_at IS NULL;

CREATE TABLE staff_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  staff_id     uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_id     uuid REFERENCES shifts(id) ON DELETE SET NULL,
  kind         text NOT NULL,   -- file_touched | pull_run | letter_issued | text_sent | call_made | ...
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staffev_staff ON staff_events(staff_id, created_at);

CREATE TABLE affiliates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  name        text NOT NULL,
  status      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  client_id    uuid REFERENCES clients(id),
  kind         text NOT NULL,   -- lead | status_change | payout
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Attach updated_at trigger to every table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'orgs','clients','pii_identity','pii_access_log','businesses',
        'funding_rounds','applications','transactions','inquiry_log',
        'pipelines','pipeline_stages','cards','tasks',
        'message_templates','messages','conversations',
        'snapshots','crs_results','behavior_scores','bank_inbox','mail_universe','events',
        'staff','shifts','staff_events','affiliates','affiliate_events'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
