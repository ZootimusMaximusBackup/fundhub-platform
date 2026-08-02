-- 132_company_brain_classification.sql — classification review queue.
--
-- Step 4 of docs/COMPANY-BRAIN-BUILD-SPEC.md.
-- Owner-set 2026-08-02 (H-3): ONLY the owner role may approve or reject
-- proposed `owner` and `affiliate` tiers. public/sales/staff may auto-assign.
-- Fail closed: live access_tier stays `owner` until auto-assigned or approved.
--
-- DEPENDS ON: 130_company_brain.sql.

ALTER TABLE brain_files
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'pending'
    CHECK (classification_status IN ('pending', 'auto', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS proposed_tier brain_access_tier,
  ADD COLUMN IF NOT EXISTS classification_rationale text;

CREATE TABLE IF NOT EXISTS brain_classification_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  file_id          uuid NOT NULL REFERENCES brain_files(id) ON DELETE CASCADE,
  drive_file_id    text NOT NULL,
  proposed_tier    brain_access_tier NOT NULL
                     CHECK (proposed_tier IN ('owner', 'affiliate')),
  rationale        text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- At most one open review per file.
CREATE UNIQUE INDEX IF NOT EXISTS brain_classification_reviews_one_pending
  ON brain_classification_reviews (file_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS brain_classification_reviews_org_pending_idx
  ON brain_classification_reviews (org_id, status, created_at DESC);

DROP TRIGGER IF EXISTS brain_classification_reviews_set_updated_at ON brain_classification_reviews;
CREATE TRIGGER brain_classification_reviews_set_updated_at
  BEFORE UPDATE ON brain_classification_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE brain_classification_reviews IS
  'Company Brain: owner-only review queue for proposed owner/affiliate tiers (H-3).';
COMMENT ON COLUMN brain_classification_reviews.proposed_tier IS
  'Never auto-applied. Live access_tier stays owner until the owner approves.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_classification_reviews TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
