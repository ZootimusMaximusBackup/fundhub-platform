-- 137_inquiry_removal_cases.sql — bridge table for the Inquiry Removal AI system.
--
-- The live IRA runtime (inquiry-removal-ai on Bland + Airtable) owns call
-- scheduling and bureau dialing. This table is the platform mirror of Airtable
-- "Inquiry Removal Cases" so the CRM Inquiry Remover desk and Client Control
-- Panel can show real call state without reading Airtable.
--
-- Field names follow fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md
-- (spec-inquiry-remover-dashboard.md expectations). Formula/rollup fields from
-- the Airtable interface (open_inquiry_count, master_call_state,
-- hold_duration_display) are either stored when the webhook sends them or
-- derived at read time — never invented when absent.
--
-- External ids (external_case_id) hold the Airtable record id so redelivered
-- webhooks upsert rather than duplicate.

CREATE TABLE IF NOT EXISTS inquiry_removal_cases (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES orgs(id),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_case_id        text,
  case_status             text NOT NULL DEFAULT 'Open'
    CHECK (case_status IN (
      'Open', 'Scheduled', 'Calling', 'Awaiting Remover',
      'Call Failed', 'Cleared', 'Closed', 'Completed'
    )),
  requested_by            text,
  requested_at            timestamptz,
  selected_bureaus_raw    text,
  call_batch_id           text,
  voice_provider          text DEFAULT 'bland',
  attempt_count           integer NOT NULL DEFAULT 0,
  hold_started_at         timestamptz,
  live_agent_reached_at   timestamptz,
  rep_handoff_at          timestamptz,
  last_dtmf_path          text,
  call_outcome_summary    text,
  master_call_state       text
    CHECK (master_call_state IS NULL OR master_call_state IN (
      'queued', 'dialing', 'ivr', 'holding',
      'live_agent_reached', 'transferred_to_rep',
      'completed', 'failed', 'idle'
    )),
  open_inquiry_count      integer NOT NULL DEFAULT 0,
  remover_notes           text,
  cleared_at              timestamptz,
  completed_at            timestamptz,
  closed_at               timestamptz,
  closed_reason           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inquiry_removal_cases_external_uq
  ON inquiry_removal_cases (org_id, external_case_id)
  WHERE external_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inquiry_removal_cases_org_status_idx
  ON inquiry_removal_cases (org_id, case_status, requested_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS inquiry_removal_cases_client_idx
  ON inquiry_removal_cases (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS inquiry_removal_cases_active_idx
  ON inquiry_removal_cases (org_id, client_id)
  WHERE case_status NOT IN ('Cleared', 'Closed', 'Completed');

COMMENT ON TABLE inquiry_removal_cases IS
  'Platform mirror of Airtable Inquiry Removal Cases. Written by the signed inquiry-removal webhook from the IRA runtime; read by the Inquiry Remover desk and Client Control Panel.';
