-- 242_partner_brand_review.sql — the reviewer trail behind "Submit for approval".
--
-- 043_partner_brand.sql already carries the three approval states and the CHECK
-- that couples 'approved' to approved_at. What it never carried is WHO asked and
-- WHEN, so a staff queue had nothing to sort on and a rejection had nowhere to
-- put its reason. That is what this adds. NO STATUS VALUE CHANGES HERE — the
-- allowed set is still exactly ('draft', 'review', 'approved'), and the coupling
-- CHECK from 043 is untouched.
--
-- SUPERSEDES RATHER THAN EDITS. db/migrate.mjs keys schema_migrations by
-- <dir>/<file>, so editing 043 in place would be recorded as already applied and
-- silently do nothing on every database that has it.
--
-- EVERY COLUMN IS NULLABLE ON PURPOSE. Every partner_brand row that exists today
-- was created before any of this, and there is no honest value to backfill:
-- nobody submitted them, so submitted_at is unknown, not now(). NULL means
-- unknown and must survive.
--
-- submitted_by REFERENCES staff(id), which means it records a submission made by
-- an employee on a partner's behalf and is NULL when the PARTNER submits their
-- own brand — a partner signs in through `accounts` (044), not `staff`, and
-- there is no staff row to point at. That gap is recorded here rather than
-- papered over with a wrong id.

ALTER TABLE partner_brand
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text;

COMMENT ON COLUMN partner_brand.submitted_at IS
  'When the brand was last sent for review. NULL = never sent.';
COMMENT ON COLUMN partner_brand.submitted_by IS
  'Staff member who sent it, when an employee did it for the partner. NULL when the partner sent it themselves, or when it was never sent.';
COMMENT ON COLUMN partner_brand.review_note IS
  'Why a reviewer sent it back. Cleared when the partner submits again.';

-- The queue reads "everything waiting, oldest first". One index serves both the
-- filter and the sort, so the list does not degrade into a full scan as partner
-- rows accumulate.
CREATE INDEX IF NOT EXISTS partner_brand_review_queue_idx
  ON partner_brand (approval_status, submitted_at DESC);
