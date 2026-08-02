-- 127_company_brain.sql — Company Brain chunk store (pgvector).
--
-- Owner-set 2026-08-02 (H-1): pgvector in Postgres/Neon, not Cognee.
-- Owner-set 2026-08-02 (H-2): index everything (no folder exclusions — connector side).
--
-- Step 2 of docs/COMPANY-BRAIN-BUILD-SPEC.md: store + owner-only retrieval.
-- Every chunk carries access_tier (fail closed). Classification lands later;
-- until then upserts default to 'owner' so nothing is readable below owner.
--
-- DEPENDS ON: schema/001_init.sql (orgs, set_updated_at), extension vector
-- (available on Neon / modern Postgres). CREATE EXTENSION is a no-op when
-- already installed.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'brain_access_tier') THEN
    CREATE TYPE brain_access_tier AS ENUM (
      'public',
      'sales',
      'staff',
      'owner',
      'affiliate'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS brain_files (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  drive_file_id        text NOT NULL,
  name                 text NOT NULL DEFAULT '',
  mime_type            text NOT NULL DEFAULT '',
  web_view_link        text,
  access_tier          brain_access_tier NOT NULL DEFAULT 'owner',
  client_id            uuid,
  unattached           boolean NOT NULL DEFAULT false,
  needs_transcription  boolean NOT NULL DEFAULT false,
  needs_ocr            boolean NOT NULL DEFAULT false,
  content_sha256       text,
  indexed_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, drive_file_id)
);

CREATE INDEX IF NOT EXISTS brain_files_org_tier_idx
  ON brain_files (org_id, access_tier);

DROP TRIGGER IF EXISTS brain_files_set_updated_at ON brain_files;
CREATE TRIGGER brain_files_set_updated_at
  BEFORE UPDATE ON brain_files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS brain_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  file_id       uuid NOT NULL REFERENCES brain_files(id) ON DELETE CASCADE,
  chunk_index   integer NOT NULL CHECK (chunk_index >= 0),
  content       text NOT NULL,
  -- Denormalized from brain_files so retrieval can filter WITHOUT joining,
  -- and so a tier change can be applied per-chunk in a later migration.
  access_tier   brain_access_tier NOT NULL DEFAULT 'owner',
  embedding     vector(1536),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS brain_chunks_org_tier_idx
  ON brain_chunks (org_id, access_tier);

-- HNSW needs rows to be useful; creating it empty is fine on Neon/pgvector.
-- Cosine distance operator is `<=>`.
CREATE INDEX IF NOT EXISTS brain_chunks_embedding_hnsw_idx
  ON brain_chunks
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE brain_files IS
  'Company Brain: one row per Drive file indexed. access_tier defaults to owner (fail closed).';
COMMENT ON TABLE brain_chunks IS
  'Company Brain: chunked text + embedding. access_tier on EVERY chunk; filter before retrieval.';
COMMENT ON COLUMN brain_chunks.access_tier IS
  'Must match the asker''s clearance. Never return a chunk whose tier the session cannot see.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_files TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_chunks TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
