-- 131_company_brain_sync.sql — stored Drive changes.list page token.
--
-- Step 3 of docs/COMPANY-BRAIN-BUILD-SPEC.md: incremental pickup so new and
-- modified files appear without a full rebuild.
--
-- One row per org. page_token is Google's opaque changes cursor
-- (newStartPageToken from the last successful changes.list page).
-- NULL page_token means "never synced" — caller should full-walk first,
-- then seed startPageToken.
--
-- DEPENDS ON: 130_company_brain.sql (brain tables), schema/001_init.sql (orgs).

CREATE TABLE IF NOT EXISTS brain_drive_sync (
  org_id       uuid PRIMARY KEY REFERENCES orgs(id),
  page_token   text,
  last_sync_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS brain_drive_sync_set_updated_at ON brain_drive_sync;
CREATE TRIGGER brain_drive_sync_set_updated_at
  BEFORE UPDATE ON brain_drive_sync
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE brain_drive_sync IS
  'Company Brain: per-org Google Drive changes.list page token for incremental pickup.';
COMMENT ON COLUMN brain_drive_sync.page_token IS
  'Opaque Google changes cursor. NULL = never bootstrapped; run a full walk then seed.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_drive_sync TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
