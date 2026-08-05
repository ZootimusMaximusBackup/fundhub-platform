-- 143_inquiry_removal_bridge.sql — IRA webhook bridge columns on top of 140.
--
-- CALL (merge 2026-08-04): 140_inquiry_ops.sql already created
-- inquiry_removal_cases + phone-work columns on inquiry_log (Airtable port).
-- feat/inquiry-removal-bridge shipped a second CREATE for the same table with
-- different status values and call fields on the case row. Keep 140 as the
-- canonical table; add only the Airtable/IRA mirror columns the webhook and
-- Inquiry Remover desk need that 140 does not already have.

-- Airtable record id (distinct from case_id business key in 140).
ALTER TABLE inquiry_removal_cases
  ADD COLUMN IF NOT EXISTS external_case_id text;

CREATE UNIQUE INDEX IF NOT EXISTS inquiry_removal_cases_external_uq
  ON inquiry_removal_cases (org_id, external_case_id)
  WHERE external_case_id IS NOT NULL;

-- Call progress fields the IRA webhook writes onto the case itself.
-- (140 keeps the detailed phone-work machine on inquiry_log; these are the
-- case-level rollups / live fields the desk and webhook also touch.)
ALTER TABLE inquiry_removal_cases
  ADD COLUMN IF NOT EXISTS call_batch_id text,
  ADD COLUMN IF NOT EXISTS voice_provider text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_agent_reached_at timestamptz,
  ADD COLUMN IF NOT EXISTS rep_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_dtmf_path text,
  ADD COLUMN IF NOT EXISTS call_outcome_summary text,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

-- inquiry_log: IRA mirror fields. 140 already has inquiry_removal_case_id +
-- enum call_state. Add Airtable id, display name, and open rollup flag.
ALTER TABLE inquiry_log
  ADD COLUMN IF NOT EXISTS external_inquiry_id text,
  ADD COLUMN IF NOT EXISTS inquiry_name text,
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

-- Bridge code historically used inquiry_log.case_id; 140 named the FK
-- inquiry_removal_case_id. Expose case_id as a synonym when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'inquiry_log' AND column_name = 'case_id'
  ) THEN
    ALTER TABLE inquiry_log
      ADD COLUMN case_id uuid REFERENCES inquiry_removal_cases(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Keep case_id and inquiry_removal_case_id aligned when either is set.
CREATE OR REPLACE FUNCTION inquiry_log_sync_case_fk() RETURNS trigger AS $$
BEGIN
  IF NEW.case_id IS NULL AND NEW.inquiry_removal_case_id IS NOT NULL THEN
    NEW.case_id := NEW.inquiry_removal_case_id;
  ELSIF NEW.inquiry_removal_case_id IS NULL AND NEW.case_id IS NOT NULL THEN
    NEW.inquiry_removal_case_id := NEW.case_id;
  ELSIF NEW.case_id IS NOT NULL AND NEW.inquiry_removal_case_id IS NOT NULL
        AND NEW.case_id IS DISTINCT FROM NEW.inquiry_removal_case_id THEN
    -- Prefer the explicitly provided case_id from the bridge path.
    NEW.inquiry_removal_case_id := NEW.case_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_log_sync_case_fk ON inquiry_log;
CREATE TRIGGER inquiry_log_sync_case_fk
  BEFORE INSERT OR UPDATE ON inquiry_log
  FOR EACH ROW EXECUTE FUNCTION inquiry_log_sync_case_fk();

UPDATE inquiry_log
   SET inquiry_name = inquiry
 WHERE inquiry_name IS NULL AND inquiry IS NOT NULL;

UPDATE inquiry_log
   SET is_open = false,
       cleared_at = COALESCE(cleared_at, confirmed_at, updated_at)
 WHERE is_open = true
   AND (
     confirmed_at IS NOT NULL
     OR status ~* '^(removed|cleared|confirmed|deleted)$'
   );

CREATE UNIQUE INDEX IF NOT EXISTS inquiry_log_external_uq
  ON inquiry_log (org_id, external_inquiry_id)
  WHERE external_inquiry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inquiry_log_bridge_case_idx
  ON inquiry_log (case_id)
  WHERE case_id IS NOT NULL;

COMMENT ON COLUMN inquiry_removal_cases.external_case_id IS
  'Airtable Inquiry Removal Cases record id. Upsert key for the IRA webhook.';
COMMENT ON COLUMN inquiry_log.is_open IS
  'Rollup source for inquiry_removal_cases.open_inquiry_count. False once Cleared/Removed.';
COMMENT ON COLUMN inquiry_log.case_id IS
  'Synonym of inquiry_removal_case_id for the IRA bridge path. Kept in sync by trigger.';
