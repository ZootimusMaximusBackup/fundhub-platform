-- 174_company_brain_uploads.sql — staff-uploaded documents in Company Brain.
--
-- Board: docs/workflows/company-brain-chat-2026-08-17.md §3.7 (W3).
--
-- Until now every brain_files row came from the Drive connector. A staff member
-- can now upload a file straight from the Company Brain screen, and an uploaded
-- file is NOT answerable until the owner approves it (§3.6). Two new columns
-- carry that:
--
--   source           where the row came from — 'drive' (connector) or 'upload'
--   approval_status  'pending' until an owner approves; only 'approved' rows
--                    may ever reach retrieval
--
-- FAIL CLOSED, WITHOUT BREAKING WHAT WORKS TODAY. Both columns carry a default
-- that describes every row that already exists: source 'drive', approval_status
-- 'approved'. Drive behaviour does not change in this batch — only uploads are
-- gated, and an upload is written with approval_status 'pending' explicitly by
-- src/company-brain/upload.mjs.
--
-- An uploaded file has no Drive id, but brain_files.drive_file_id is NOT NULL
-- and UNIQUE (org_id, drive_file_id). Uploads therefore carry a synthetic id of
-- the form `upload:<uuid>`, which cannot collide with a real Drive file id.
--
-- DEPENDS ON: 130_company_brain.sql (brain_files), 132_company_brain_classification.sql.

ALTER TABLE brain_files
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'drive'
    CHECK (source IN ('drive', 'upload')),
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS original_name text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid;

-- Backfill. The DEFAULT on ADD COLUMN already gives every pre-existing row
-- 'drive' / 'approved'; this restates it so a database where the column was
-- hand-added without a default lands in the same place. Idempotent.
UPDATE brain_files
   SET source = COALESCE(source, 'drive'),
       approval_status = COALESCE(approval_status, 'approved')
 WHERE source IS NULL OR approval_status IS NULL;

-- Retrieval filters on approval_status, and the uploads list filters on source.
CREATE INDEX IF NOT EXISTS brain_files_org_source_approval_idx
  ON brain_files (org_id, source, approval_status);

COMMENT ON COLUMN brain_files.source IS
  'drive = Drive connector, upload = staff upload from the Company Brain screen.';
COMMENT ON COLUMN brain_files.approval_status IS
  'Uploads start pending. Retrieval must return chunks only from approved files.';
COMMENT ON COLUMN brain_files.original_name IS
  'Filename exactly as the browser sent it. name is the display form.';
COMMENT ON COLUMN brain_files.size_bytes IS
  'Size of the uploaded bytes. NULL for Drive-synced rows — unknown, not zero.';
COMMENT ON COLUMN brain_files.uploaded_by IS
  'staff.id of whoever uploaded it. NULL for Drive-synced rows.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_files TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
