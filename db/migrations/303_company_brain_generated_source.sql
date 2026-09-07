-- 303_company_brain_generated_source.sql — a third source for brain_files:
-- 'generated', for a document this app writes itself rather than a real
-- Drive file (source='drive') or a staff upload (source='upload').
--
-- WHY. Chris asked (2026-09-07) for Company Brain — "the AI agent that
-- manages the company" — to be able to see the new marketing-analytics data
-- and produce weekly briefs. That content has no Drive file and no human
-- uploader behind it; it is written by src/company-brain/ingest-generated.mjs
-- from this app's own tables. 174_company_brain_uploads.sql already
-- established the pattern this follows: a synthetic drive_file_id
-- (`upload:<uuid>` there, `generated:<type>:<key>` here — see
-- ingest-generated.mjs's driveFileIdFor()), and a `source` column that says
-- honestly where a row came from, rather than mislabeling it as an upload.
--
-- approval_status is left at its existing default, 'approved' — a
-- system-generated brief does not need an owner to manually approve it
-- before it is askable, the same way a synced Drive file does not. If that
-- ever needs to change (e.g. an owner wants to review a brief before Company
-- Brain can answer questions about it), that is a value judgment for Chris,
-- not something to decide by default here.

ALTER TABLE brain_files DROP CONSTRAINT IF EXISTS brain_files_source_check;
ALTER TABLE brain_files ADD CONSTRAINT brain_files_source_check
  CHECK (source IN ('drive', 'upload', 'generated'));

COMMENT ON COLUMN brain_files.source IS
  'drive = synced from Google Drive. upload = a staff member uploaded it, pending owner approval. generated = written by this app itself (src/company-brain/ingest-generated.mjs), e.g. a weekly ops brief or an ad-performance summary.';
