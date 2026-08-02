-- 118_contract_esign.sql — uploaded PDFs, placed fields, and several signers in order.
--
-- WHAT THIS ADDS TO 117. 117 gave contracts a home: copy with {{merge tags}},
-- rendered to text, frozen at send, signed by one person. That is a real
-- product and it stays exactly as it was. What it could NOT do is the thing an
-- actual signing service does:
--
--   * take a PDF somebody already has — a lender's agreement, a landlord's
--     form, anything — rather than only copy typed into this CRM;
--   * put boxes on the pages of it (name here, date there, sign at the bottom),
--     some filled from the client record and some typed by hand;
--   * send it to MORE THAN ONE person, IN AN ORDER, so the second signer cannot
--     sign until the first one has.
--
-- All three are additive. `source_kind` defaults to 'text', every existing row
-- keeps that value, and every code path in src/contracts/ that predates this
-- migration behaves identically. A contract with one signer and no PDF is still
-- a valid contract — this does not force the new shape onto the old flow.
--
-- DEPENDS ON: 117_contracts.sql, 030_documents.sql (the uploaded PDF and the
-- finished signed PDF are both registered as document_versions, so both inherit
-- the immutability trigger that 117's tamper check anchors to), 001_init.sql.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this is signature capture on
-- legally operative documents. Recorded as a marker.

-- ---------------------------------------------------------------------------
-- 1. contract_templates — a template may now BE a PDF.
-- ---------------------------------------------------------------------------

ALTER TABLE contract_templates
  -- 'text' — the 117 shape: a body with {{merge tags}}, rendered to text.
  -- 'pdf'  — an uploaded file with boxes placed on its pages.
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'text',

  -- The uploaded original, registered in `documents` (030) so the bytes are
  -- immutable and re-fetchable, and so a storage vendor swap changes nothing
  -- here. THE STORAGE KEY IS DELIBERATELY NOT COPIED ONTO THIS TABLE: under a
  -- blob store the key IS a permanent bearer credential (see the header of
  -- src/documents/store.mjs), and src/http/read-api.mjs only knows to strip it
  -- from columns actually named storage_key. Resolve through document_id.
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS document_version_id uuid REFERENCES document_versions(id),
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS page_count integer CHECK (page_count IS NULL OR page_count > 0),

  /* page_sizes — [{ "w": 612, "h": 792 }, …] in PDF points, one per page, read
     out of the file at upload. The field editor needs them to lay boxes out at
     the right aspect ratio before it has rendered anything, and the flattener
     needs them to convert a field's fractional position back into points. */
  ADD COLUMN IF NOT EXISTS page_sizes jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* fields — the boxes placed on the pages. An ARRAY of objects:

       { "id": "f1", "page": 0,
         "x": 0.12, "y": 0.44, "w": 0.30, "h": 0.03,   ← FRACTIONS of the page
         "type": "text" | "date" | "checkbox" | "signature" | "initials",
         "signer": 0,                                   ← which signer fills it
         "label": "Full name",
         "source": "contact.full_name" | "today" | "manual",
         "required": true }

     POSITIONS ARE FRACTIONS OF THE PAGE, NEVER PIXELS. A pixel position is only
     meaningful at the zoom level and screen width it was recorded at; the same
     box would land somewhere else on a laptop, on a phone, and in the finished
     PDF. Fractions survive all three, and converting to PDF points is one
     multiplication by the page size stored above. This is the single most
     load-bearing format decision in the feature.

     Validated in src/contracts/fields.mjs, not by a CHECK constraint: a
     constraint strict enough to police the object would make adding a field
     property a migration, which is the same reasoning 117 records for
     manual_fields. */
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* signer_roles — who has to sign, as roles rather than as people:
       [{ "index": 0, "label": "Client", "fill_from_client": true },
        { "index": 1, "label": "Fundhub" }]
     The template says HOW MANY signatures and in what order; the actual names
     and email addresses are per-contract and live in contract_signers below. */
  ADD COLUMN IF NOT EXISTS signer_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_templates_source_kind_ck') THEN
    ALTER TABLE contract_templates
      ADD CONSTRAINT contract_templates_source_kind_ck CHECK (source_kind IN ('text', 'pdf'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_templates_shape_ck') THEN
    /* A PDF template must actually have a PDF behind it, and a text template
       must not pretend to. Without this the editor can be pointed at a template
       that says 'pdf' with nothing to render, which fails at the worst possible
       moment — in front of a client. */
    ALTER TABLE contract_templates
      ADD CONSTRAINT contract_templates_shape_ck CHECK (
        (source_kind = 'text' AND document_id IS NULL)
        OR (source_kind = 'pdf' AND document_id IS NOT NULL AND page_count IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_templates_json_shape_ck') THEN
    ALTER TABLE contract_templates
      ADD CONSTRAINT contract_templates_json_shape_ck CHECK (
        jsonb_typeof(fields) = 'array'
        AND jsonb_typeof(page_sizes) = 'array'
        AND jsonb_typeof(signer_roles) = 'array');
  END IF;
END $$;

/* 117 requires `body` to be non-blank, which is right for typed copy and wrong
   for an uploaded PDF — there is no body, the file is the body. The old CHECK
   is superseded rather than edited (CLAUDE.md §12: editing an applied migration
   is a silent no-op, and the same discipline applies to a constraint that has
   already shipped). Text templates are held to exactly the old rule. */
ALTER TABLE contract_templates DROP CONSTRAINT IF EXISTS contract_templates_body_check;
ALTER TABLE contract_templates ALTER COLUMN body DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_templates_body_ck') THEN
    ALTER TABLE contract_templates
      ADD CONSTRAINT contract_templates_body_ck CHECK (
        source_kind <> 'text' OR (body IS NOT NULL AND body ~ '[^[:space:]]'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_templates_document
  ON contract_templates (document_id) WHERE document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. contracts — a sent contract may be a filled PDF, and may await several
--    signatures.
-- ---------------------------------------------------------------------------

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'text',

  /* fields — the placed boxes AND their filled values, snapshotted at send.
     Snapshotted, not referenced: editing a template's boxes afterwards must not
     move a field on a contract somebody has already been sent, for the same
     reason 117 freezes the rendered text. */
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* The SOURCE PDF as it stood at send, snapshotted onto the contract rather
     than read through the template.

     WHY NOT JUST FOLLOW template.document_id. Because a template can be given a
     new file tomorrow, and every contract already sent from it would silently
     start rendering the new one — the exact "a template is edited and thousands
     of records quietly become a record of words nobody saw" failure that
     099_client_consents.sql spells out in capitals. Content addressing means
     this snapshot costs nothing: identical bytes resolve to the identical
     stored object, so pointing at it twice stores it once. */
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS source_document_version_id uuid REFERENCES document_versions(id),

  -- The FINISHED file: every signer's entries burned into the pages, plus a
  -- signature record page. Written once, when the last signer signs.
  ADD COLUMN IF NOT EXISTS signed_document_id uuid REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS signed_document_version_id uuid REFERENCES document_versions(id),
  ADD COLUMN IF NOT EXISTS signed_body_sha text
    CHECK (signed_body_sha IS NULL OR signed_body_sha ~ '^[a-z0-9-]+:[0-9a-f]+$'),

  /* 'sequential' — signer 2's link does not work until signer 1 has signed.
     'parallel'   — everybody may sign whenever they like.
     Sequential is the default because it is the safer surprise: a countersigner
     who signs before the client is a mistake that is hard to explain, and a
     parallel flow that somebody wanted sequential is merely slower. */
  ADD COLUMN IF NOT EXISTS signing_order text NOT NULL DEFAULT 'sequential',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_source_kind_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_source_kind_ck CHECK (source_kind IN ('text', 'pdf'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_signing_order_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_signing_order_ck
      CHECK (signing_order IN ('sequential', 'parallel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_fields_shape_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_fields_shape_ck CHECK (jsonb_typeof(fields) = 'array');
  END IF;
END $$;

/* 117's contracts_sent_has_body_ck demands `rendered_body` on anything past
   draft, and that rule SURVIVES for both kinds — but what it holds for a PDF
   contract needs explaining, because it is the load-bearing decision of this
   migration.
 *
 * A PDF contract's rendered_body is the AGREEMENT MANIFEST: a plain-text record
 * naming the fingerprint of the file, its page count, and every box on it with
 * the value that was in it at send. It is generated in src/contracts/send.mjs.
 *
 * WHY. 117's tamper refusal works by re-hashing rendered_body at signature time
 * and comparing it against document_versions.checksum in a different table
 * behind a different trigger. That machinery is the most valuable thing in this
 * feature, and it needed nothing changed to cover PDFs — as long as there is
 * ONE string that captures everything agreed. For a PDF, the file alone is not
 * that string: the same file with a different figure typed into a box is a
 * different agreement. The manifest covers both, so hashing it covers both.
 *
 * The file itself is snapshotted separately in source_document_id above, and is
 * what the client actually reads. */
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_sent_has_body_ck;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_sent_has_artifact_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_sent_has_artifact_ck CHECK (
      status = 'draft'
      OR (body_sha IS NOT NULL AND sent_at IS NOT NULL AND rendered_body IS NOT NULL
          AND (source_kind = 'text' OR source_document_id IS NOT NULL)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_signed_document
  ON contracts (signed_document_id) WHERE signed_document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. contract_signers — the people, and the order.
--
-- One row per person who must sign one contract. This is what makes the feature
-- a signing service rather than a form: each signer gets their OWN link, sees
-- only THEIR OWN fields, and — under a sequential order — cannot open the
-- document at all until everybody ahead of them has finished.
--
-- WHY A TABLE AND NOT A jsonb COLUMN ON contracts. Three reasons, and the third
-- is the one that decided it:
--   * a signature is an evidentiary record and belongs in columns an auditor can
--     query, not inside a document nobody can index;
--   * "who has not signed yet" is a queue the CRM reads constantly, and that is
--     a WHERE clause, not a jsonb scan;
--   * a jsonb blob cannot be made append-only per element. A row can, and is,
--     by the trigger at the bottom of this file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_signers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  contract_id       uuid NOT NULL REFERENCES contracts(id),

  -- 0-based, and it IS the signing order under a sequential flow.
  signer_index      integer NOT NULL CHECK (signer_index >= 0),
  role_label        text NOT NULL CHECK (role_label ~ '[^[:space:]]'),

  -- who they are ------------------------------------------------------------
  -- name and email are what the sender typed. client_id is set when this signer
  -- IS the client on file, which is what lets fields auto-fill from the client
  -- record. A counterparty who is not a client in this CRM leaves it NULL.
  name              text NOT NULL CHECK (name ~ '[^[:space:]]'),
  email             text,
  client_id         uuid REFERENCES clients(id),

  -- where they are up to ----------------------------------------------------
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'viewed', 'signed', 'declined')),
  link_expires_at   timestamptz,
  viewed_at         timestamptz,
  view_count        integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),

  -- the signature -----------------------------------------------------------
  signed_at         timestamptz,
  signer_name       text,               -- what they actually typed
  signer_ip         text,
  signer_user_agent text,
  -- Their own entries into the boxes assigned to them, captured at signature.
  field_values      jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(field_values) = 'object'),

  declined_at       timestamptz,
  decline_reason    text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Same pairing rule 117 applies to the contract: a signature is a name AND a
  -- time, never one without the other.
  CONSTRAINT contract_signers_signature_pair_ck CHECK (
    (signed_at IS NULL AND signer_name IS NULL)
    OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND signer_name ~ '[^[:space:]]')),
  CONSTRAINT contract_signers_signed_status_ck CHECK (signed_at IS NULL OR status = 'signed'),
  CONSTRAINT contract_signers_declined_ck CHECK (
    declined_at IS NULL OR (status = 'declined' AND decline_reason IS NOT NULL
                            AND decline_reason ~ '[^[:space:]]')),

  -- The order has no gaps and no ties. Two signers at position 1 is not an
  -- order, and the routing code would have to pick one arbitrarily.
  UNIQUE (contract_id, signer_index)
);

CREATE INDEX IF NOT EXISTS idx_contract_signers_contract
  ON contract_signers (contract_id, signer_index);
CREATE INDEX IF NOT EXISTS idx_contract_signers_org      ON contract_signers (org_id, status);
CREATE INDEX IF NOT EXISTS idx_contract_signers_client
  ON contract_signers (client_id) WHERE client_id IS NOT NULL;
-- "who are we waiting on" — the CRM's most common question about a live contract.
CREATE INDEX IF NOT EXISTS idx_contract_signers_waiting
  ON contract_signers (org_id, contract_id, signer_index)
  WHERE status IN ('pending', 'sent', 'viewed');

-- ---------------------------------------------------------------------------
-- Never delete a signer, and never rewrite a signature.
--
-- Removing a signer from a contract that has been sent rewrites who agreed to
-- what, after the fact, with nothing left to show it happened. Same posture as
-- 117's contracts and 030's document_versions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION contract_signers_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'contract_signers %: a signer is never deleted — void the contract instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contract_signers_no_delete ON contract_signers;
CREATE TRIGGER trg_contract_signers_no_delete
  BEFORE DELETE ON contract_signers
  FOR EACH ROW EXECUTE FUNCTION contract_signers_no_delete();

CREATE OR REPLACE FUNCTION contract_signers_frozen() RETURNS trigger AS $$
BEGIN
  -- Identity and position are fixed for the life of the row. Moving somebody's
  -- position in the order after the fact changes who was allowed to sign when.
  IF NEW.contract_id  IS DISTINCT FROM OLD.contract_id
     OR NEW.org_id       IS DISTINCT FROM OLD.org_id
     OR NEW.signer_index IS DISTINCT FROM OLD.signer_index
  THEN
    RAISE EXCEPTION
      'contract_signers %: a signer''s contract and position in the order cannot be changed', OLD.id;
  END IF;

  IF OLD.signed_at IS NOT NULL THEN
    IF NEW.signed_at        IS DISTINCT FROM OLD.signed_at
       OR NEW.signer_name   IS DISTINCT FROM OLD.signer_name
       OR NEW.signer_ip     IS DISTINCT FROM OLD.signer_ip
       OR NEW.signer_user_agent IS DISTINCT FROM OLD.signer_user_agent
       OR NEW.field_values  IS DISTINCT FROM OLD.field_values
       OR NEW.name          IS DISTINCT FROM OLD.name
       OR NEW.email         IS DISTINCT FROM OLD.email
       OR NEW.status        IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION
        'contract_signers %: this person has signed — their signature and what they entered cannot be changed',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contract_signers_frozen ON contract_signers;
CREATE TRIGGER trg_contract_signers_frozen
  BEFORE UPDATE ON contract_signers
  FOR EACH ROW EXECUTE FUNCTION contract_signers_frozen();

DROP TRIGGER IF EXISTS contract_signers_updated_at ON contract_signers;
CREATE TRIGGER contract_signers_updated_at
  BEFORE UPDATE ON contract_signers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. document_blobs — file bytes in Postgres, as the fallback store.
--
-- THE OWNER'S DECISION IS BLOB STORAGE ("that stuff gets saved in the blob").
-- src/documents/store.mjs already carries a Vercel Blob provider and this
-- migration does not replace it: when BLOB_READ_WRITE_TOKEN is set, that
-- provider is selected and this table is never written to.
--
-- WHY IT EXISTS ANYWAY. The token cannot be set from the build environment
-- (api.netlify.com is blocked by the network policy, CLAUDE.md §11), and a
-- feature that cannot store a file until somebody sets an environment variable
-- is a feature that ships dead — which this repository has done three times and
-- written a routing test to stop doing. So the store falls back to Postgres,
-- the feature works the day it deploys, and it moves to blob storage by itself
-- the moment the token appears. Nothing above the provider interface knows
-- which one it is talking to.
--
-- Contracts are small and low-volume, so bytea is a reasonable home rather than
-- a compromise. It also inherits the database's existing backup and retention
-- story instead of needing its own.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_blobs (
  -- The content-addressed pathname built by src/documents/store.mjs. Content
  -- addressed means identical bytes land on the identical key, so a re-upload
  -- of the same file is free and a put can never clobber different content.
  storage_path text PRIMARY KEY,
  content_type text,
  byte_size    bigint NOT NULL CHECK (byte_size >= 0),
  bytes        bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_blobs IS
  'File bytes, when no blob-storage vendor is configured. Written only by the postgres provider in src/documents/store.mjs; keyed by the content-addressed path, so the key is a hash of the content and never a credential.';

-- ---------------------------------------------------------------------------
-- Grants for the unprivileged application role (104_app_role.sql).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON contract_signers TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON document_blobs TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

COMMENT ON TABLE contract_signers IS
  'One row per person who must sign a contract. signer_index is the signing order; under a sequential contract a signer cannot open the document until everybody ahead of them has signed.';
COMMENT ON COLUMN contract_templates.fields IS
  'Boxes placed on the pages. Positions are FRACTIONS of the page, never pixels — see the column note in db/migrations/118_contract_esign.sql.';

-- ---------------------------------------------------------------------------
-- 5. `fields` joins the frozen set.
--
-- 117's trg_contracts_frozen lists the columns that cannot change once a
-- contract is sent. `fields` did not exist then and has to join that list, for
-- exactly the reason the list exists: the finished PDF is drawn FROM these
-- boxes and their values, so a contract whose fields could be edited after
-- sending is a contract whose final document can be altered — while the
-- manifest that the tamper check hashes stays untouched and keeps saying
-- everything is fine. That would be a hole straight through the middle of the
-- guarantee this feature is built on.
--
-- WHERE A SIGNER'S OWN ENTRIES GO INSTEAD: contract_signers.field_values, one
-- row per person, frozen by that table's own trigger the moment they sign. The
-- finished document is composed from the frozen contract fields with each
-- signer's frozen entries laid over the top. Nothing that has been agreed is
-- ever writable again.
--
-- The function is REPLACED rather than the 117 file being edited — editing an
-- applied migration is a silent no-op (CLAUDE.md §12).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION contracts_frozen_after_send() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.rendered_body       IS DISTINCT FROM OLD.rendered_body
       OR NEW.body_sha         IS DISTINCT FROM OLD.body_sha
       OR NEW.document_id      IS DISTINCT FROM OLD.document_id
       OR NEW.document_version_id IS DISTINCT FROM OLD.document_version_id
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
       OR NEW.source_document_version_id IS DISTINCT FROM OLD.source_document_version_id
       OR NEW.fields           IS DISTINCT FROM OLD.fields
       OR NEW.source_kind      IS DISTINCT FROM OLD.source_kind
       OR NEW.signing_order    IS DISTINCT FROM OLD.signing_order
       OR NEW.template_id      IS DISTINCT FROM OLD.template_id
       OR NEW.client_id        IS DISTINCT FROM OLD.client_id
       OR NEW.org_id           IS DISTINCT FROM OLD.org_id
       OR NEW.merge_values     IS DISTINCT FROM OLD.merge_values
       OR NEW.signature_statement IS DISTINCT FROM OLD.signature_statement
       OR NEW.sent_at          IS DISTINCT FROM OLD.sent_at
    THEN
      RAISE EXCEPTION
        'contracts %: this contract has been sent — its wording is frozen and cannot be changed',
        OLD.id;
    END IF;
  END IF;

  IF OLD.signed_at IS NOT NULL THEN
    IF NEW.signed_at         IS DISTINCT FROM OLD.signed_at
       OR NEW.signer_name    IS DISTINCT FROM OLD.signer_name
       OR NEW.signer_ip      IS DISTINCT FROM OLD.signer_ip
       OR NEW.signer_user_agent IS DISTINCT FROM OLD.signer_user_agent
       OR NEW.status         IS DISTINCT FROM OLD.status
       -- The finished file is written in the same statement that records the
       -- last signature, so it is already set by the time this branch can fire.
       OR NEW.signed_document_id IS DISTINCT FROM OLD.signed_document_id
       OR NEW.signed_body_sha    IS DISTINCT FROM OLD.signed_body_sha
    THEN
      RAISE EXCEPTION
        'contracts %: this contract is signed — the signature and its status cannot be changed',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
