-- 117_client_uploads.sql — a fifth `documents.kind` for files a CLIENT sends
-- US, not files this platform produced.
--
-- WHY THIS IS A REAL GAP. 030_documents.sql's four kinds (authorization,
-- contract, invoice_document, deliverable) are everything the PLATFORM
-- generates. src/documents/PROPOSED-EVENTS.md says so directly: "docs.received
-- — documents coming IN from a client or bank... This registry stores what the
-- platform PRODUCES." Client-uploaded ID photos, bank statements and the like
-- were never given a home here on purpose.
--
-- The client-upload build (docs/UPLOADS-SPEC.md) is told to route through this
-- same registry anyway — same versioning, same signed-download path, one
-- registrar instead of two. That only works if `kind` has a slot for it. Five
-- classes, not four; everything else about the table (append-only versions,
-- delete-blocking triggers, immutability) is unchanged and applies to this
-- kind exactly as it does to the other four.
--
-- subtype for this kind is free text (uploads.mjs), same as every other kind —
-- see kinds.mjs SUBTYPES for the conventional vocabulary
-- (id_document | bank_statement | proof_of_income | tax_return | other).
--
-- The old CHECK is dropped by LOOKING IT UP rather than by a guessed name.
-- 030 declared it inline with no explicit name, so Postgres auto-named it —
-- almost certainly `documents_kind_check`, but a DROP CONSTRAINT IF EXISTS
-- against a guess that turned out wrong would silently leave the OLD
-- constraint in place, and this migration would appear to succeed while every
-- client upload still failed the CHECK. Finding it by its definition avoids
-- betting on Postgres's naming convention holding across versions.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'documents'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%kind%IN%'
  LOOP
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_kind_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_kind_check
      CHECK (kind IN ('authorization', 'contract', 'invoice_document', 'deliverable', 'client_upload'));
  END IF;
END $$;
