-- 142_staff_monitoring_consent.sql — deep monitoring is OFF until a person
-- signs a written notice, and Hubstaff activity is only ever merged for people
-- who have that timestamp on file.
--
-- THE GATE LIVES IN THE INGEST PATH (src/shifts/hubstaff-ingest.mjs).
-- REVOKE CLEARS TO NULL.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS monitoring_consent_at timestamptz;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS hubstaff_user_id text;

COMMENT ON COLUMN staff.monitoring_consent_at IS
  'When a signed monitoring consent form was recorded. NULL (default) means deep monitoring OFF — Hubstaff ingest MUST skip. Revoke sets NULL.';

COMMENT ON COLUMN staff.hubstaff_user_id IS
  'Hubstaff user id for this staff member when mapped. Required with monitoring_consent_at before poll fetches activity.';

CREATE INDEX IF NOT EXISTS idx_staff_monitoring_ready
  ON staff (org_id, hubstaff_user_id)
  WHERE monitoring_consent_at IS NOT NULL
    AND hubstaff_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_events_monitor_external
  ON staff_events (staff_id, kind, ((detail->>'external_id')))
  WHERE kind IN ('monitor_activity', 'monitor_screenshot')
    AND detail ? 'external_id';
