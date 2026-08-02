-- 129_contract_template_write_repair.sql — make saving a contract wording work.
--
-- WHY. Creating a text template from the CRM was answering HTTP 500 write_failed
-- every time. 124 and 125 create the tables and columns; both use
-- DROP TRIGGER IF EXISTS, which prints "trigger … does not exist, skipping" on
-- first apply. Those notices are normal. What is NOT normal is an INSERT that
-- still fails after the files are marked applied.
--
-- Two production-shaped failures reproduce that 500 exactly:
--
--   1. fundhub_app has no INSERT on contract_templates. 124 grants it, but only
--      when the role already exists in that transaction. A database that got
--      the tables from a path that skipped the grant (or that created
--      fundhub_app later) leaves the app able to SELECT the library and unable
--      to write a row — permission denied → write_failed.
--
--   2. The esign columns from 125 (source_kind, fields, page_sizes,
--      signer_roles) are NOT NULL. createTemplate relied on column DEFAULTs and
--      did not name them in the INSERT. If a DEFAULT is missing — ADD COLUMN
--      IF NOT EXISTS skips the whole clause when the column already exists
--      without a default — the INSERT writes NULL into a NOT NULL column and
--      Postgres refuses it → write_failed.
--
-- This file re-asserts both. It does not reshape the tables. Idempotent.
--
-- DEPENDS ON: 104_app_role.sql, 124_contracts.sql, 125_contract_esign.sql.

-- ---------------------------------------------------------------------------
-- Defaults the text-template INSERT needs when it does not name these columns.
-- ---------------------------------------------------------------------------
ALTER TABLE contract_templates
  ALTER COLUMN source_kind SET DEFAULT 'text',
  ALTER COLUMN page_sizes SET DEFAULT '[]'::jsonb,
  ALTER COLUMN fields SET DEFAULT '[]'::jsonb,
  ALTER COLUMN signer_roles SET DEFAULT '[]'::jsonb;

-- Existing rows that somehow landed with NULL (should be none; belt and braces).
UPDATE contract_templates SET source_kind = 'text' WHERE source_kind IS NULL;
UPDATE contract_templates SET page_sizes = '[]'::jsonb WHERE page_sizes IS NULL;
UPDATE contract_templates SET fields = '[]'::jsonb WHERE fields IS NULL;
UPDATE contract_templates SET signer_roles = '[]'::jsonb WHERE signer_roles IS NULL;

ALTER TABLE contract_templates
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN page_sizes SET NOT NULL,
  ALTER COLUMN fields SET NOT NULL,
  ALTER COLUMN signer_roles SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Grants for the unprivileged app role. Same guarded shape as 124/125.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON contract_templates TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON contract_signers TO fundhub_app;
    RAISE NOTICE '128: granted contract tables to fundhub_app';
  ELSE
    RAISE NOTICE '128: skipped grants — role fundhub_app does not exist';
  END IF;
END $$;
