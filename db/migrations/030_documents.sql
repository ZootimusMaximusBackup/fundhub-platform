-- 030_documents.sql — the documents registry.
--
-- WHY: every generated artifact in the platform today is produced, delivered,
-- and then lost. DS-02 POSTs a letter pack to underwrite-iq-lite and keeps a
-- boolean in clients.custom_fields.diy_delivered_event_id. The UnderwriteIQ
-- deliverables are emailed. Soft-pull consent is a custom field, not a signed
-- record. Funding agreements live in someone's inbox. A client cannot re-access
-- anything they paid for, and there is no audit trail behind any of it.
--
-- This migration gives artifacts a home:
--   documents          — the registry row: one per logical document, carrying a
--                        denormalized snapshot of its CURRENT version.
--   document_versions  — immutable history: every generation of that document.
--
-- Regeneration APPENDS a version. It never overwrites. A client keeps access to
-- the exact bytes they were actually sent, which is the whole point of an audit
-- trail — enforced below by triggers, not by convention.
--
-- Convention (001_init.sql): org_id, created_at, updated_at on every table,
-- updated_at maintained by the shared set_updated_at() trigger. Rule 7 (org_id
-- everywhere) and Rule 9 (idempotent, replay-safe) both apply.
--
-- DEPENDS ON: 001_init.sql (orgs, clients, set_updated_at()), 017_invoices.sql
-- (invoices — nullable link from an invoice_document back to the money owed).
--
-- ── ASSUMPTION FLAG (Chris/Darwin: correct me) ──────────────────────────────
-- The brief points at fundhub-docs /sources/fundhub-platform-vision.md §3 for
-- the document taxonomy. That repo is not reachable from this session, so the
-- four `kind` classes are taken verbatim from the brief; `kind` is a hard CHECK.
-- The `subtype` vocabulary below was confirmed by Chris directly (the five
-- UnderwriteIQ deliverable names and the three contract subtypes), but subtype
-- stays deliberately free text so extending it never needs a migration.
--
-- ── RETENTION FLAG (not implemented, deliberately) ──────────────────────────
-- The credit-adjacent documents in here — soft-pull authorizations above all,
-- plus dispute letter packs and any deliverable derived from a credit pull —
-- almost certainly carry a STATUTORY MINIMUM RETENTION (FCRA/ECOA-adjacent, and
-- state rules on top). That is a legal determination, not an engineering one,
-- so no policy is coded here and nothing in src/documents/ expires or prunes
-- anything. Two consequences worth being explicit about:
--   * `expires_at` below is DOCUMENT VALIDITY (a soft-pull authorization stops
--     being a valid basis to pull), NOT a deletion clock. Nothing reads it as
--     one. Most documents leave it null — that is the intended state.
--   * Deletes are blocked at the table level. If a retention policy ever does
--     require destruction, it needs its own migration that drops those guards
--     deliberately, with counsel's sign-off on the record.
-- Needs: Chris + counsel. Blocking nothing today.

-- ---------------------------------------------------------------------------
-- documents — the registry row.
--
-- One row per LOGICAL document (`document_key`), not per generation. The
-- version-shaped columns (storage_key … checksum, delivery, signature) are a
-- snapshot of the current version, maintained by src/documents/register.mjs in
-- the same transaction that appends the version. document_versions is the
-- source of truth for history; this table is the fast path for "give me the
-- latest", which is the overwhelmingly common read.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  client_id           uuid NOT NULL REFERENCES clients(id),

  -- identity ---------------------------------------------------------------
  -- document_key is the logical identity that makes versioning work: a
  -- regeneration resolves to the SAME document_key and therefore appends to the
  -- same document instead of minting a second one. Built by register.mjs as
  -- `<kind>|<subtype>|<client_id>` unless the caller supplies its own.
  document_key        text NOT NULL,
  kind                text NOT NULL
    CHECK (kind IN ('authorization', 'contract', 'invoice_document', 'deliverable')),
  -- subtype — conventional values, NOT constrained. The canonical list lives in
  -- src/documents/kinds.mjs (SUBTYPES); this block is the human-readable copy.
  --
  --   authorization      soft_pull_consent    — the C-00 soft-pull consent gate
  --
  --   contract           funding_agreement
  --                      repair_engagement_letter
  --                      partner_license      — the affiliate portal gates payouts on this one
  --
  --   invoice_document   deposit_invoice | success_fee_invoice | platform_fee_invoice
  --                      (mirrors invoices.invoice_type, 017_invoices.sql)
  --
  --   deliverable        the five UnderwriteIQ deliverables:
  --                        credit_analysis_report        — Credit Analysis Report
  --                        metro2_dispute_letter_pack    — Metro 2 Dispute Letter Pack
  --                        credit_optimization_roadmap   — Credit Optimization Roadmap
  --                        funding_snapshot              — Funding Snapshot
  --                        bank_lender_match_list        — Bank and Lender Match List
  subtype             text,
  title               text NOT NULL,

  -- optional link to the money record behind an invoice_document -----------
  invoice_id          uuid REFERENCES invoices(id),

  -- current version pointer (FK added after document_versions exists) -------
  current_version     integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  current_version_id  uuid,

  -- current version snapshot: the object ------------------------------------
  storage_key         text NOT NULL,        -- provider-agnostic object path. NEVER served to a client.
  mime_type           text NOT NULL,
  byte_size           bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum            text                  -- 'sha256:<hex>' — algorithm-prefixed
    CHECK (checksum IS NULL OR checksum ~ '^[a-z0-9-]+:[0-9a-f]+$'),

  -- current version snapshot: provenance ------------------------------------
  generated_by        text,                 -- workflow key ('ds-02-diy-letters') or agent name
  generated_at        timestamptz NOT NULL DEFAULT now(),

  -- current version snapshot: delivery --------------------------------------
  delivered_at        timestamptz,
  delivery_channel    text
    CHECK (delivery_channel IS NULL OR
           delivery_channel IN ('email', 'sms', 'portal', 'api', 'manual', 'print')),
  delivery_status     text NOT NULL DEFAULT 'not_delivered'
    CHECK (delivery_status IN
           ('not_delivered', 'pending', 'sent', 'delivered', 'failed', 'bounced')),
  -- if it went out, we know how it went out
  CHECK (delivered_at IS NULL OR delivery_channel IS NOT NULL),

  -- signature ---------------------------------------------------------------
  -- signature_required is document POLICY (does this class need signing at all),
  -- so it lives here; the signature itself is against a specific version and is
  -- mirrored down from it.
  signature_required  boolean NOT NULL DEFAULT false,
  signed_at           timestamptz,
  signer_name         text,
  signature_ref       text,                 -- external e-sign envelope/ref, if any

  -- validity ----------------------------------------------------------------
  -- Nullable and USUALLY NULL. Most documents never expire — that is the point.
  -- Read as validity, never as a deletion clock (see RETENTION FLAG).
  expires_at          timestamptz,

  -- idempotency (Rule 9) ----------------------------------------------------
  -- The event that CREATED this document. NOT unique, deliberately: one
  -- `analysis.completed` generates all five UnderwriteIQ deliverables, so a
  -- single event legitimately creates several documents. Uniqueness of the
  -- document itself is document_key's job; per-generation idempotency is
  -- document_versions' (see its index below).
  source_event_id     text,

  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The logical identity. This is what makes a regeneration find its predecessor.
CREATE UNIQUE INDEX documents_org_key_uniq
  ON documents (org_id, document_key);

-- Audit lookup: "what did this event produce?". Not unique — see the column note.
CREATE INDEX idx_documents_source_event
  ON documents (org_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX idx_documents_org          ON documents (org_id);
-- the retrieve.mjs primary read: newest document of a kind for a client
CREATE INDEX idx_documents_client_kind  ON documents (org_id, client_id, kind, generated_at DESC);
CREATE INDEX idx_documents_invoice      ON documents (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_documents_delivery     ON documents (org_id, delivery_status);
CREATE INDEX idx_documents_expiring     ON documents (org_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_documents_unsigned     ON documents (org_id, client_id)
  WHERE signature_required AND signed_at IS NULL;

-- ---------------------------------------------------------------------------
-- document_versions — immutable history. Append-only.
--
-- Every generation lands here. The stored artifact (storage_key, checksum,
-- byte_size, mime_type) is immutable per the trigger below; only the mutable
-- lifecycle facts about that specific version (was it delivered, was it signed)
-- may be updated after insert.
-- ---------------------------------------------------------------------------
CREATE TABLE document_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  document_id         uuid NOT NULL REFERENCES documents(id),
  version             integer NOT NULL CHECK (version >= 1),

  -- the object --------------------------------------------------------------
  -- Not UNIQUE on purpose: storage keys are content-addressed (sha256 of the
  -- bytes), so a regeneration that produces byte-identical output legitimately
  -- reuses the object. Content addressing is also why a put can never clobber
  -- different bytes at an existing key.
  storage_key         text NOT NULL,
  mime_type           text NOT NULL,
  byte_size           bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum            text
    CHECK (checksum IS NULL OR checksum ~ '^[a-z0-9-]+:[0-9a-f]+$'),

  -- provenance --------------------------------------------------------------
  generated_by        text,
  generated_at        timestamptz NOT NULL DEFAULT now(),

  -- delivery — per version, because the client was sent THIS one -------------
  delivered_at        timestamptz,
  delivery_channel    text
    CHECK (delivery_channel IS NULL OR
           delivery_channel IN ('email', 'sms', 'portal', 'api', 'manual', 'print')),
  delivery_status     text NOT NULL DEFAULT 'not_delivered'
    CHECK (delivery_status IN
           ('not_delivered', 'pending', 'sent', 'delivered', 'failed', 'bounced')),
  CHECK (delivered_at IS NULL OR delivery_channel IS NOT NULL),

  -- signature — a signature is always against a specific version ------------
  signed_at           timestamptz,
  signer_name         text,
  signature_ref       text,

  -- idempotency (Rule 9): same generation event twice = one version ---------
  -- Scoped to the document (see the index below), so one event may generate a
  -- version for each of several documents, but never two for the same one.
  source_event_id     text,

  -- why this version exists: 'initial' | 'regenerated' | 'corrected' | 'imported'
  reason              text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, version)
);

-- THE idempotency guarantee (Rule 9): a replayed generation event cannot append
-- a second version to the same document. Scoped by document_id so one event can
-- still produce the five UnderwriteIQ deliverables in a single pass.
CREATE UNIQUE INDEX document_versions_doc_source_event_uniq
  ON document_versions (org_id, document_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX idx_docvers_document ON document_versions (document_id, version DESC);
CREATE INDEX idx_docvers_org      ON document_versions (org_id);
CREATE INDEX idx_docvers_storage  ON document_versions (storage_key);  -- reverse lookup during audits

-- current version pointer, added now that the target table exists
ALTER TABLE documents ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);

-- ---------------------------------------------------------------------------
-- Never delete. Supersede with a new version.
--
-- Same posture as 016_ledger_no_delete.sql: the guarantee is worth nothing if a
-- stray DELETE can quietly undo it. Blocking deletes also frees the
-- source_event_id idempotency keys' meaning — a deleted row would let the same
-- generation event register a second time on replay.
--
-- Note the FKs to clients(id) are RESTRICT (no ON DELETE CASCADE, matching
-- 017_invoices), so a client delete fails rather than taking the audit trail
-- with it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION documents_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'documents %: documents are never deleted — register a superseding version instead',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_no_delete
  BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_no_delete();

CREATE OR REPLACE FUNCTION document_versions_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'document_versions %: version history is append-only and cannot be deleted',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_versions_no_delete
  BEFORE DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION document_versions_no_delete();

-- ---------------------------------------------------------------------------
-- A stored artifact is immutable. Regenerating writes a NEW version.
--
-- Without this, "never overwrites" is a comment in an application file. The
-- mutable lifecycle columns (delivery_*, signed_*, metadata, reason) are left
-- writable — a version legitimately goes pending → sent → delivered, and gets
-- signed, after it is stored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION document_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.document_id     IS DISTINCT FROM OLD.document_id
     OR NEW.org_id       IS DISTINCT FROM OLD.org_id
     OR NEW.version      IS DISTINCT FROM OLD.version
     OR NEW.storage_key  IS DISTINCT FROM OLD.storage_key
     OR NEW.mime_type    IS DISTINCT FROM OLD.mime_type
     OR NEW.byte_size    IS DISTINCT FROM OLD.byte_size
     OR NEW.checksum     IS DISTINCT FROM OLD.checksum
     OR NEW.generated_at IS DISTINCT FROM OLD.generated_at
     OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
  THEN
    RAISE EXCEPTION
      'document_versions %: the stored artifact is immutable — register a new version instead',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_versions_immutable
  BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION document_versions_immutable();

-- ---------------------------------------------------------------------------
-- updated_at (001_init.sql convention)
-- ---------------------------------------------------------------------------
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER document_versions_updated_at
  BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
