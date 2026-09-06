-- 291_recording_and_marketing_consent.sql — two more consent kinds, so a
-- recorded client call and the ad cut from it are each answerable.
--
-- COMPLIANCE REVIEW REQUIRED. Nothing in this file records, publishes, or
-- transmits anything. It opens two DATA slots. Capture lives in src/consent/;
-- the words live in src/consent/disclosures.mjs, append-only, one version key
-- per wording ever shown.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY TWO KINDS AND NOT ONE
--
-- The CSM role (290) runs recorded calls whose answers are meant to feed AI
-- and be cut into paid ads. Those are two different permissions and a client
-- can reasonably grant one and refuse the other:
--
--   call_recording  — you may record this conversation.
--   marketing_use   — you may use my words, voice and likeness in advertising.
--
-- Collapsing them into a single "recording consent" makes the second one
-- unaskable: every recorded call would read as ad-cleared, including the ones
-- where the client only agreed to be recorded so their advisor had notes. The
-- separation is the whole point, and it is why this is two rows in a table
-- rather than a boolean on a call.
--
-- 166_customer_insights.sql flagged exactly this and left it open:
-- "COMPLIANCE REVIEW REQUIRED: consent / marketing reuse of customer quotes."
-- That is the gap this file closes. 292 adds the column that enforces it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- REVOCATION MATTERS MORE HERE THAN ANYWHERE ELSE ON THIS TABLE
--
-- 099 already makes revocation a row-level fact rather than a delete, and the
-- live-consent gate in src/consent/index.mjs hasValidConsent() already refuses
-- a revoked or expired row. That machinery is inherited unchanged, and it is
-- what makes "they asked us to take the ad down" a query rather than a memory:
-- a revoked marketing_use is visible against every insight already captured.
--
-- WHAT THIS FILE DOES NOT DO: it does not pull a live ad. Revoking consent
-- makes the clip ineligible going forward and findable in a report; taking it
-- off a platform is a human action on that platform.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP SHAPE COPIED FROM 167, INCLUDING WHY
--
-- 099 CHECKed kind inline and unnamed; Postgres auto-named it
-- client_consents_kind_check, and 167 then re-added it under that exact name.
-- So the constraint name is knowable today — but the lookup-by-column drop is
-- kept anyway, because a DROP CONSTRAINT IF EXISTS against a wrong guess is a
-- silent no-op that leaves the old two-value CHECK in place and makes every
-- call_recording insert fail at runtime instead of here.
--
-- DEPENDS ON: 099_client_consents.sql, 167_dispute_authorization_consent.sql.

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
      CHECK (kind IN ('soft_pull_consent',
                      'dispute_authorization',
                      'call_recording',
                      'marketing_use'));
  END IF;
END $$;

COMMENT ON CONSTRAINT client_consents_kind_check ON client_consents IS
  'Closed set: soft_pull_consent (credit-report pull), dispute_authorization (prepare letters and complaint drafts), call_recording (record this conversation) and marketing_use (use my words, voice and likeness in advertising). call_recording and marketing_use are deliberately separate — agreeing to be recorded is not agreeing to be advertised. New kinds need a migration.';
