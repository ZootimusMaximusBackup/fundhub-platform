-- 138_inquiry_log_bridge.sql — extend inquiry_log for IRA bridge fields.

ALTER TABLE inquiry_log
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES inquiry_removal_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_inquiry_id text,
  ADD COLUMN IF NOT EXISTS inquiry_name text,
  ADD COLUMN IF NOT EXISTS call_state text
    CHECK (call_state IS NULL OR call_state IN (
      'queued', 'dialing', 'ivr', 'holding',
      'live_agent_reached', 'transferred_to_rep'
    )),
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

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

CREATE INDEX IF NOT EXISTS inquiry_log_case_idx
  ON inquiry_log (case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inquiry_log_call_state_idx
  ON inquiry_log (org_id, call_state)
  WHERE call_state IS NOT NULL AND is_open = true;

COMMENT ON COLUMN inquiry_log.call_state IS
  'Live bureau-call progress from the IRA runtime: queued|dialing|ivr|holding|live_agent_reached|transferred_to_rep.';
COMMENT ON COLUMN inquiry_log.is_open IS
  'Rollup source for inquiry_removal_cases.open_inquiry_count. False once Cleared/Removed.';
