-- 167_dispute_authorization_consent.sql — a second consent kind so a client
-- can authorize Fundhub to PREPARE dispute letters and complaint drafts.
--
-- COMPLIANCE REVIEW REQUIRED. Nothing in this file mails, files, or promises
-- a deletion, a score change, funding, or a legal outcome. Capture lives in
-- src/consent/; the words live in src/consent/disclosures.mjs (dispute-auth-v1).
-- The live mail gate is W3d — this migration only opens the DATA slot.
--
-- 099 CHECKed kind to 'soft_pull_consent' only, inline, unnamed. Postgres
-- auto-named it client_consents_kind_check. Confirmed live 2026-08-15:
--   CHECK ((kind = 'soft_pull_consent'::text))
-- Drop by looking the CHECK up on the kind column — same reason as 118:
-- DROP CONSTRAINT IF EXISTS against a wrong guess would leave the old CHECK
-- in place and every dispute_authorization insert would still fail.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
     WHERE rel.relname = 'client_consents'
       AND con.contype = 'c'
       AND att.attname = 'kind'
       AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE client_consents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_consents_kind_check'
  ) THEN
    ALTER TABLE client_consents
      ADD CONSTRAINT client_consents_kind_check
      CHECK (kind IN ('soft_pull_consent', 'dispute_authorization'));
  END IF;
END $$;

COMMENT ON CONSTRAINT client_consents_kind_check ON client_consents IS
  'Closed set: soft_pull_consent (credit-report pull) and dispute_authorization (prepare letters and complaint drafts for client review). New kinds need a migration.';
