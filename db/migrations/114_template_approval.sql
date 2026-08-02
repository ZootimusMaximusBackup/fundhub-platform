-- 114_template_approval.sql — an audit trail for message_templates.compliance_passed.
--
-- WHAT WAS WRONG. `compliance_passed` is the whole send gate: sendTemplated
-- (src/workflows/messaging.mjs) will not render a template whose flag is false.
-- But the flag is a stored boolean, not a check of the words — nothing anywhere
-- reads a body and judges it. So the flag only means something if you can tell
-- WHO set it and AGAINST WHICH COPY. Before this migration you could tell
-- neither: the row recorded that copy was approved, never that a person approved
-- it, and an edit to the body left the flag standing over wording nobody had
-- read.
--
-- The template editor (public/app/template-editor.html) closes that: saving copy
-- clears the flag, and only an owner or admin can set it back, with the exact
-- body they approved on screen. These three columns are what make that provable
-- after the fact.
--
--   approved_by        which staff member set the flag true
--   approved_at        when
--   approved_body_sha  SHA-256 of the exact subject+body they approved
--
-- approved_body_sha is the load-bearing one. It is what lets anyone ask, later,
-- "is the copy in this row still the copy that was signed off?" — compare the
-- hash of the current subject+body against it. A mismatch means the row was
-- changed by some path that did not go through the editor (the bulk seeder, a
-- direct SQL edit), which is exactly the case a boolean alone cannot report.
--
-- Nullable and defaulting to NULL on purpose: every existing row was approved by
-- the bulk seeder carrying a value out of a source document, with no person
-- attached. NULL is the honest record of that — "true, but nobody here signed
-- it" — and backfilling a name would manufacture an audit trail that does not
-- exist. Rows stay sendable; they simply have no approver until someone reviews
-- them through the editor.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS approved_body_sha text;

COMMENT ON COLUMN message_templates.approved_by IS
  'Staff member who last set compliance_passed true via the template editor. NULL means the flag came from the bulk seeder, not a person.';
COMMENT ON COLUMN message_templates.approved_at IS
  'When compliance_passed was last set true by a person.';
COMMENT ON COLUMN message_templates.approved_body_sha IS
  'SHA-256 of the subject+body that was on screen at approval. Compare against the current copy to prove the row has not changed since sign-off.';

-- Finding the unapproved copy is the query a compliance review actually runs,
-- and it is the one the editor's list runs on every open.
CREATE INDEX IF NOT EXISTS idx_msgtpl_unapproved
  ON message_templates(org_id, channel)
  WHERE compliance_passed = false;
