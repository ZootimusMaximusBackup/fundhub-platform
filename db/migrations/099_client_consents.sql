-- 099_client_consents.sql — the record of what a consumer actually agreed to.
--
-- *** NOTHING IN THIS FILE PULLS ANYBODY'S CREDIT, AND NOTHING IN THIS FILE
-- *** SENDS ANYTHING ANYWHERE.
-- Same posture as 077 for the soft-pull ledger and 065/067 for the mail build:
-- this migration creates ONE TABLE. A row here records that a person said yes,
-- in words, at a time, by a method. It does not authorise a transmission,
-- because nothing in this repository transmits.
--
--
-- WHY THIS EXISTS.
--
-- 030_documents.sql opens with the problem, in its own words: "Soft-pull consent
-- is a custom field, not a signed record." That is still true today. The only
-- place this platform records a consumer's permission to pull their credit is
-- two free-text columns copied out of a CRM:
--
--   db/schema/005_client_custom_fields.sql
--     cf_crs_softpull_consent            text
--     cf_crs_softpull_consent_at         date
--     cf_credit_pull_consent_status      text
--
-- A text column that says "Yes" is not a consent record. It cannot say WHAT the
-- person agreed to, HOW they expressed it, whether it has since EXPIRED, or
-- whether they have REVOKED it — and it cannot be shown to anybody as evidence,
-- because the words the consumer was actually shown were never stored.
--
-- 077 closed the same hole one layer over: `crs_results` held the OUTPUT of a
-- pull and nothing recorded that a pull had been REQUESTED, by whom, or why.
-- This table closes the layer beneath that one. 077 answers "who authorised
-- this pull". This answers "and on what basis did the consumer permit it".
--
--
-- ATTRIBUTION IS STRUCTURAL, NOT A CONVENTION.
--
-- 077's header sets the rule and this file follows it exactly: an unattributed
-- record is refused BY THE SCHEMA, not by the module that usually writes. The
-- same three devices appear here.
--
--   * granted_by_kind is NOT NULL and CHECKed to one of two values;
--   * exactly one of the two subject columns must be populated, and it must be
--     the one the kind names (client_consents_granter_ck);
--   * every free-text field that an auditor would read is CHECKed non-blank
--     with `~ '[^[:space:]]'` and NOT with `btrim(x) <> ''`. btrim's default
--     trim set is the SPACE CHARACTER ONLY, so a value of E'\t\n' passes the
--     btrim form and lands looking like an answer. 077's header records that
--     this exact bug shipped once and was caught by a test asserting against
--     the table rather than against the module.
--
-- There is no way to write a row to this table that does not say who consented,
-- to what words, and by what method.
--
--
-- WHAT WAS CONSENTED TO IS STORED AS WORDS, NOT AS A POINTER.
--
-- consent_text holds the VERBATIM text the consumer was shown, copied into the
-- row at capture time. It is not a foreign key to a template, and that is the
-- single most important decision in this file.
--
-- A template is edited. When it is, every consent that pointed at it silently
-- becomes a record of words the consumer never saw — and the change looks like
-- a content tweak, not like the rewriting of thousands of consent records that
-- it actually is. The only defensible answer to "what did this person agree
-- to" is the string that was on their screen, frozen at the moment they agreed.
-- So it is copied, it is NOT NULL, it is non-blank, and it is immutable.
--
-- consent_version is a label for the wording (e.g. 'soft-pull-v1'), kept
-- alongside the words rather than instead of them. It makes "which cohort saw
-- the old paragraph" answerable without making the words themselves derivable.
--
--
-- HOW IT WAS CAPTURED IS A CLOSED SET OF THREE.
--
--   typed      — the consumer typed their full name into a box.
--   checkbox   — the consumer ticked a box.
--   signature  — a signature was captured, on screen or on paper.
--
-- CHECKed, because unlike documents.subtype this is not a vocabulary that
-- should grow without somebody thinking about it: each value is a different
-- evidentiary weight, and a fourth one ('verbal', 'inferred', 'imported')
-- carries a legal argument that belongs in a migration and a review, not in a
-- string a caller invented.
--
-- granted_name — the name the consumer typed or signed. REQUIRED for 'typed'
-- and 'signature' and optional for 'checkbox', enforced by
-- client_consents_method_ck. A typed consent with no typed name is not a typed
-- consent; a ticked box legitimately has no name attached to it.
--
--
-- EXPIRY IS VALIDITY, NEVER A DELETION CLOCK.
--
-- Same reading as documents.expires_at, whose own header spells this out: it
-- means "this stops being a valid basis to act", not "delete this row then".
-- Nothing in src/consent/ prunes anything, and NULL — meaning "does not expire"
-- — is a legitimate and common value.
--
-- The CHECK requires expires_at > granted_at when present. A consent that
-- expired before it was given is a data-entry error that would otherwise sit in
-- the table reading as a valid-looking row that never passes the gate.
--
--
-- REVOCATION IS A ONE-WAY DOOR.
--
-- revoked_at, revoked_reason and the revoker columns move forward exactly once.
-- The immutability trigger below refuses to clear a revocation, and that is
-- deliberate rather than defensive: "un-revoking" is not an operation a
-- consumer-consent system should have. A person who withdrew permission and
-- later granted it again gave a NEW consent, and it gets a NEW row, with its
-- own words and its own timestamp. Editing the old row to say the withdrawal
-- never happened destroys the only evidence that it did.
--
-- revoked_reason is required when revoked, on the same reasoning as
-- closeSoftPull()'s stated reason and 077's `reason` column: "it ended" is not
-- an audit trail.
--
--
-- THERE IS DELIBERATELY NO UNIQUE INDEX ON (client_id, kind).
--
-- It reads like the obvious guard — one live consent per person per thing — and
-- it is the same trap 077's header documents for its own
-- `(client_id) WHERE status='queued'` index. Consent is expected to be given
-- more than once over a client's life: it expires and is renewed, it is revoked
-- and later granted afresh, the wording changes and is re-consented. A unique
-- constraint would make the second, correct, current consent fail to insert
-- because a stale one from two years ago still occupies the slot.
--
-- The rule "the current consent is the newest valid one" belongs in the query,
-- where it is, and where it can be read: src/consent/index.mjs.
--
--
-- THE DELETE POSTURE MATCHES 077, NOT 030.
--
-- No delete guard. The only delete path is the cascade from `clients`, and a
-- record of "this person permitted us to pull their credit" SHOULD go when the
-- person's record goes — a consent that outlives the erasure of the consumer is
-- a liability, not an audit trail. 077 takes this position for the pull ledger
-- itself and the two must agree, or erasing a client would leave orphaned
-- evidence of one half of the transaction.
--
-- DEPENDS ON: 001_init.sql (orgs, clients, staff, accounts),
--             030_documents.sql (documents).

CREATE TABLE IF NOT EXISTS client_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHAT WAS CONSENTED TO, as a classification. The vocabulary mirrors the
  -- authorization subtypes in src/documents/kinds.mjs — 'soft_pull_consent' is
  -- the one that exists there today and the one the gate in
  -- src/finance/soft-pulls.mjs asks about. CHECKed rather than free text: an
  -- unrecognised kind would pass a gate that nobody wrote, by never matching
  -- the query that refuses it.
  kind          text NOT NULL
                CHECK (kind IN ('soft_pull_consent')),

  -- WHAT WAS CONSENTED TO, as the words on the consumer's screen. Verbatim,
  -- frozen, immutable. See the header — this is not a pointer to a template.
  consent_text  text NOT NULL
                CONSTRAINT client_consents_text_ck CHECK (consent_text ~ '[^[:space:]]'),

  -- A label for the wording, so a cohort is answerable. Optional; the words
  -- above are the record, this is the index into it.
  consent_version text
                CONSTRAINT client_consents_version_ck
                CHECK (consent_version IS NULL OR consent_version ~ '[^[:space:]]'),

  -- WHO CONSENTED. Two principal kinds can produce a consent row: the consumer
  -- themself in the portal, and an employee capturing a consent given on a
  -- call or on paper. They live in different tables (accounts / staff) and
  -- collapsing them into one text column would lose the foreign key, which is
  -- the only thing that makes the attribution checkable later. Exactly 077's
  -- shape, for exactly 077's reason.
  --
  -- NOTE ON WHAT 'staff' MEANS HERE: it does NOT mean an employee consented on
  -- the consumer's behalf — nobody can do that. It means an employee RECORDED
  -- a consent the consumer gave elsewhere, and it is that employee who is
  -- accountable for the accuracy of the record. granted_name carries the
  -- consumer's name in that case, which is why the two are separate columns.
  granted_by_kind       text NOT NULL
                        CHECK (granted_by_kind IN ('client', 'staff')),
  granted_by_account_id uuid REFERENCES accounts(id),
  granted_by_staff_id   uuid REFERENCES staff(id),

  -- HOW IT WAS CAPTURED. A closed set of three — see the header.
  capture_method text NOT NULL
                 CHECK (capture_method IN ('typed', 'checkbox', 'signature')),

  -- The name the consumer typed or signed. Required for typed and signature.
  granted_name  text
                CONSTRAINT client_consents_name_ck
                CHECK (granted_name IS NULL OR granted_name ~ '[^[:space:]]'),

  -- WHERE FROM. Evidence for a typed or ticked consent given over the web, and
  -- legitimately NULL for one captured on a phone call or off paper. Nullable
  -- with no default: an unknown origin must not render as a known one.
  captured_ip        inet,
  captured_user_agent text,

  -- THE SIGNED ARTIFACT, when there is one. documents.subtype
  -- 'soft_pull_consent' is the authorization document this points at.
  -- ON DELETE SET NULL rather than CASCADE: losing the artifact must not erase
  -- the record that consent was given, on the same reasoning as
  -- soft_pull_requests.crs_result_id. The consent happened either way.
  document_id   uuid REFERENCES documents(id) ON DELETE SET NULL,

  granted_at    timestamptz NOT NULL DEFAULT now(),

  -- VALIDITY, not a deletion clock. NULL means "does not expire".
  expires_at    timestamptz,

  -- REVOCATION. One way — see the header and the trigger below.
  revoked_at     timestamptz,
  revoked_reason text
                 CONSTRAINT client_consents_revoked_reason_ck
                 CHECK (revoked_reason IS NULL OR revoked_reason ~ '[^[:space:]]'),
  revoked_by_kind       text CHECK (revoked_by_kind IS NULL
                                    OR revoked_by_kind IN ('client', 'staff')),
  revoked_by_account_id uuid REFERENCES accounts(id),
  revoked_by_staff_id   uuid REFERENCES staff(id),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Exactly one granter, and it must be the kind the row claims. This is the
  -- constraint that makes "an unattributed consent is not a consent" true of
  -- the database and not merely of the module that usually writes to it.
  CONSTRAINT client_consents_granter_ck CHECK (
    (granted_by_kind = 'client'
       AND granted_by_account_id IS NOT NULL AND granted_by_staff_id IS NULL)
    OR
    (granted_by_kind = 'staff'
       AND granted_by_staff_id IS NOT NULL AND granted_by_account_id IS NULL)
  ),

  -- A typed or signed consent must carry the name that was typed or signed.
  -- A ticked checkbox need not.
  CONSTRAINT client_consents_method_ck CHECK (
    capture_method = 'checkbox' OR granted_name IS NOT NULL
  ),

  -- An expiry that precedes the grant is a data-entry error, and one that would
  -- sit in the table looking valid while never passing the gate.
  CONSTRAINT client_consents_expiry_ck CHECK (
    expires_at IS NULL OR expires_at > granted_at
  ),

  -- A revocation is all-or-nothing: the time, the reason and the revoker
  -- arrive together or not at all. Without this, a half-written revocation
  -- could leave revoked_at set and nobody named, which is the unattributed
  -- record this whole file exists to make impossible — in the one direction
  -- that matters most, because it is the direction that takes permission away.
  CONSTRAINT client_consents_revocation_ck CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL AND revoked_by_kind IS NULL
       AND revoked_by_account_id IS NULL AND revoked_by_staff_id IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL
       AND (
         (revoked_by_kind = 'client'
            AND revoked_by_account_id IS NOT NULL AND revoked_by_staff_id IS NULL)
         OR
         (revoked_by_kind = 'staff'
            AND revoked_by_staff_id IS NOT NULL AND revoked_by_account_id IS NULL)
       ))
  ),

  -- A consent cannot be revoked before it was given.
  CONSTRAINT client_consents_revoked_after_ck CHECK (
    revoked_at IS NULL OR revoked_at >= granted_at
  )
);

-- THE READ THE GATE PERFORMS, and the reason this index exists. The hot query
-- is "the newest live consent of this kind for this client, in this org" —
-- src/consent/index.mjs hasValidConsent(). org_id leads because org scoping is
-- not optional on this table: the gate fails closed without an org, so every
-- query it issues carries one.
CREATE INDEX IF NOT EXISTS idx_client_consents_lookup
  ON client_consents (org_id, client_id, kind, granted_at DESC);

-- "What is live right now", without walking the revoked and expired history.
-- Partial on revoked_at IS NULL only: expiry is a time comparison and cannot be
-- baked into a partial index without the index going stale the moment it passes.
CREATE INDEX IF NOT EXISTS idx_client_consents_live
  ON client_consents (org_id, client_id, kind, granted_at DESC)
  WHERE revoked_at IS NULL;

-- The compliance read: "show me every consent this person ever gave or took
-- back", newest first, including the revoked ones. That query is the reason
-- revocation is a row-level fact rather than a delete.
CREATE INDEX IF NOT EXISTS idx_client_consents_client_history
  ON client_consents (client_id, granted_at DESC);

COMMENT ON TABLE client_consents IS
  'What a consumer agreed to, in their own screen''s words: who consented, when, how it was captured (typed/checkbox/signature), when it expires, whether it was revoked, and which document evidences it. Replaces the cf_crs_softpull_consent text custom field. Nothing in this table transmits — see the file header of db/migrations/099_client_consents.sql.';
COMMENT ON COLUMN client_consents.consent_text IS
  'VERBATIM words the consumer was shown, copied at capture time and immutable. Deliberately not a foreign key to a template: editing a template would otherwise rewrite what thousands of people are recorded as having agreed to.';
COMMENT ON COLUMN client_consents.expires_at IS
  'Validity, never a deletion clock — same reading as documents.expires_at. NULL means does not expire.';
COMMENT ON COLUMN client_consents.revoked_at IS
  'Set once and never cleared. Re-consenting after a revocation is a NEW row, not an edit to this one.';
COMMENT ON COLUMN client_consents.granted_by_kind IS
  '''client'' — the consumer themself in the portal. ''staff'' — an employee RECORDING a consent the consumer gave on a call or on paper. Never an employee consenting on their behalf.';

/* The consent facts are the evidence, so they are write-once. Only the
   revocation columns move, and only in one direction.

   IS DISTINCT FROM, not <>: a NULL-to-value change is still a rewrite of what
   the record said, and `NULL <> 'x'` is NULL, which a plain comparison would
   treat as "no change". 077's trigger carries the same note for the same
   reason. */
CREATE OR REPLACE FUNCTION client_consents_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id                 IS DISTINCT FROM OLD.org_id
     OR NEW.client_id           IS DISTINCT FROM OLD.client_id
     OR NEW.kind                IS DISTINCT FROM OLD.kind
     OR NEW.consent_text        IS DISTINCT FROM OLD.consent_text
     OR NEW.consent_version     IS DISTINCT FROM OLD.consent_version
     OR NEW.granted_by_kind     IS DISTINCT FROM OLD.granted_by_kind
     OR NEW.granted_by_account_id IS DISTINCT FROM OLD.granted_by_account_id
     OR NEW.granted_by_staff_id   IS DISTINCT FROM OLD.granted_by_staff_id
     OR NEW.capture_method      IS DISTINCT FROM OLD.capture_method
     OR NEW.granted_name        IS DISTINCT FROM OLD.granted_name
     OR NEW.captured_ip         IS DISTINCT FROM OLD.captured_ip
     OR NEW.captured_user_agent IS DISTINCT FROM OLD.captured_user_agent
     OR NEW.granted_at          IS DISTINCT FROM OLD.granted_at
     OR NEW.expires_at          IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION
      'client_consents %: what was consented to, by whom, how it was captured, when, and when it expires are immutable — a consent record is evidence and cannot be rewritten. Re-consenting is a new row.',
      OLD.id;
  END IF;

  /* Revocation is a one-way door. Clearing it would destroy the only evidence
     that a consumer withdrew permission, which is the fact most likely to be
     inconvenient and therefore the one most in need of a guard. */
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
          OR NEW.revoked_by_kind IS DISTINCT FROM OLD.revoked_by_kind
          OR NEW.revoked_by_account_id IS DISTINCT FROM OLD.revoked_by_account_id
          OR NEW.revoked_by_staff_id IS DISTINCT FROM OLD.revoked_by_staff_id)
  THEN
    RAISE EXCEPTION
      'client_consents %: a revocation cannot be edited or undone — granting permission again is a new consent row',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_consents_immutable ON client_consents;
CREATE TRIGGER trg_client_consents_immutable
  BEFORE UPDATE ON client_consents
  FOR EACH ROW EXECUTE FUNCTION client_consents_immutable();

-- updated_at, per the 001_init.sql convention.
DROP TRIGGER IF EXISTS trg_client_consents_updated_at ON client_consents;
CREATE TRIGGER trg_client_consents_updated_at
  BEFORE UPDATE ON client_consents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NOT DONE, AND SETTLED: there is no backfill from clients.cf_crs_softpull_consent.
--
-- *** DECIDED BY CHRIS (owner), 2026-07-31: do not migrate the old CRM values.
-- *** Leave them where they are and capture fresh consent going forward.
--
-- The reasoning on the record: that column holds a CRM dropdown value with no
-- wording, no capture method, no attribution and no evidence. Copying it in
-- would manufacture consent records that look identical to real ones while
-- satisfying none of the standard this table exists to hold — and they would
-- immediately start passing the gate in src/finance/soft-pulls.mjs. An empty
-- table that refuses every pull is the honest starting state; a populated one
-- built out of a text field is a compliance finding waiting to be discovered by
-- somebody else.
--
-- This is not an open question and should not be reopened as one. Anybody
-- writing a backfill later is reversing an owner decision and needs a new one,
-- in writing, before the migration is merged.
--
-- THE PRACTICAL CONSEQUENCE, so nobody is surprised by it: on the day this
-- ships, EVERY client has no consent on file and every soft-pull request is
-- refused with 403 consent_required until somebody captures one through
-- public/app/consent-capture.html. That is the intended behaviour, not an
-- outage.
