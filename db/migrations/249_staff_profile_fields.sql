-- 249_staff_profile_fields.sql — phone and start date on staff rows.
--
-- Staff & Teams edit drawer showed these fields but nothing persisted them.
-- Name and email already lived on staff; this adds the two that were missing.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS start_date date;

COMMENT ON COLUMN staff.phone IS
  'Contact phone for roster display. Not used for login or outbound SMS routing.';
COMMENT ON COLUMN staff.start_date IS
  'Employment start date shown on Staff & Teams. Optional.';
