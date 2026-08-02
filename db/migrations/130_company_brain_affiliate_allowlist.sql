-- 130_company_brain_affiliate_allowlist.sql — explicit affiliate allowlist.
--
-- Step 7 of docs/COMPANY-BRAIN-BUILD-SPEC.md.
-- Affiliates / white-label partners are EXTERNAL. They are not a tier above
-- or below internal ones — they hit ONLY this allowlist.
--
-- Rules:
--   * No document is affiliate-visible unless a human (owner, H-3) approved it.
--   * Affiliate queries JOIN this table AND require access_tier = 'affiliate'.
--   * No fallback to public/sales/staff/owner under any condition.
--
-- DEPENDS ON: 127_company_brain.sql, 129_company_brain_classification.sql.

CREATE TABLE IF NOT EXISTS brain_affiliate_allowlist (
  org_id       uuid NOT NULL REFERENCES orgs(id),
  file_id      uuid NOT NULL REFERENCES brain_files(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  review_id    uuid REFERENCES brain_classification_reviews(id) ON DELETE SET NULL,
  approved_by  uuid,
  approved_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, file_id)
);

CREATE INDEX IF NOT EXISTS brain_affiliate_allowlist_org_idx
  ON brain_affiliate_allowlist (org_id, approved_at DESC);

COMMENT ON TABLE brain_affiliate_allowlist IS
  'Company Brain step 7: the ONLY documents affiliates/partners may retrieve. Owner-approved.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_affiliate_allowlist TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
