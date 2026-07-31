-- 077_soft_pull_requests.sql — an auditable record that a credit pull was asked
-- for, by whom, on what basis, and what came back.
--
-- *** COMPLIANCE REVIEW REQUIRED — CREDIT-PULL TYPE AND PERMISSIBLE PURPOSE. ***
-- Read the `reason` column note below before this table is used for anything.
--
-- WHY THIS EXISTS. Today a soft pull request leaves no record that it happened.
-- src/workflows/c-00-crs-soft-pull-request.mjs marks it by writing four
-- custom_fields on the client — crs_status='Requested', crs_pull_scope,
-- analyzer_path, round_hold_reason. Custom fields are last-write-wins strings on
-- the client row: the second pull overwrites the first, and there is no
-- timestamp, no basis, no actor and no link to the result. `crs_results` (001,
-- line 310) records what came BACK, and nothing at all records what was ASKED.
--
-- For a regulated consumer-finance product that is the wrong way round. The
-- question a regulator, a dispute, or a client asks is "why did you pull my
-- credit, and who authorised it" — and that question is currently unanswerable
-- from this database. This table makes it answerable.
--
--
-- THE `reason` COLUMN IS FREE TEXT AND THAT IS A DELIBERATE, FLAGGED, TEMPORARY
-- DECISION.
--
-- The FCRA does not accept a free-text explanation. It enumerates permissible
-- purposes, and a compliant system stores a coded one — plus the consumer
-- authorization it rests on — not a sentence somebody typed. This column is
-- text because:
--
--   * There is no permissible-purpose vocabulary anywhere in this repository,
--     this schema, or the vendor material. Inventing the enum here would be
--     inventing the compliance model, in a migration, unreviewed. That is worse
--     than free text, because a CHECK constraint reads as a decision somebody
--     made.
--   * A text column can be read and re-coded later. A wrong enum has to be
--     migrated out of, after it has already been used to classify real pulls.
--
-- WHAT MUST HAPPEN BEFORE THIS IS RELIED ON: counsel names the permissible
-- purposes this product actually operates under, and they become a CHECK plus a
-- backfill of whatever text is in here by then. Until that happens, `reason` is
-- an operational note, NOT a compliance artifact, and nothing should present it
-- as one.
--
-- `consent_document_id` is the part that is already real: it points at the
-- signed soft-pull authorization in `documents` (kind='authorization',
-- subtype='soft_pull_consent' — src/documents/kinds.mjs:23). It is NULLABLE
-- because the existing C-00 path does not capture one, and a NOT NULL here
-- would make this table unwritable by the only code that would write it. A NULL
-- consent is a gap that is now VISIBLE rather than absent — which is the point.
--
--
-- `requested_by` IS NULLABLE, AND THAT IS THE SAME FINDING W1 REPORTED.
-- A pull is requested by an Inngest workflow reacting to diagnostic.paid — the
-- CLIENT pays, no employee runs anything. There is no staff id to record. A NOT
-- NULL column would have to be filled with an invented actor, which is exactly
-- the failure the repo's headline rule exists to prevent. NULL here means "no
-- employee initiated this", which is true and useful, and a staff-initiated
-- pull path can fill it in later without a migration.
--
-- NOTHING HERE PULLS ANYTHING. No adapter call, no outbound fetch. This records
-- a request that src/adapters/crs.mjs and the C-00 workflow are the authority
-- on, the same way crs_results records what they returned.

CREATE TABLE IF NOT EXISTS soft_pull_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  --   soft — a pull that does NOT affect the consumer's score.
  --   hard — a pull that DOES.
  -- The column exists, and defaults to 'soft', because this distinction is the
  -- single most consequential fact about a credit inquiry and a table named
  -- soft_pull_requests that silently held hard pulls would be a trap. A hard
  -- pull recorded as soft is a misrepresentation to a consumer.
  pull_type    text NOT NULL DEFAULT 'soft'
               CHECK (pull_type IN ('soft', 'hard')),

  -- Matches the vocabulary c-00-crs-soft-pull-request.mjs already writes into
  -- custom_fields.crs_pull_scope, so the two do not drift into two spellings of
  -- the same idea.
  scope        text NOT NULL DEFAULT 'consumer_only'
               CHECK (scope IN ('consumer_only', 'consumer_plus_ex_business')),

  --   requested — asked for; nothing back yet
  --   completed — a result landed (see result_id)
  --   failed    — the provider refused or errored (see failure_reason)
  --   canceled  — withdrawn before a result
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'completed', 'failed', 'canceled')),

  -- SEE THE HEADER. Free text, operational note, NOT a compliance artifact.
  reason       text,

  -- The signed authorization this pull rests on. NULL = none captured, which is
  -- a visible gap and not a passing grade.
  consent_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,

  -- NULL = no employee initiated this; a workflow did. See the header.
  requested_by uuid REFERENCES staff(id),

  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- What came back. ON DELETE SET NULL so purging a bureau payload does not
  -- erase the evidence that a pull was requested — the request is the audit
  -- record and must outlive the data it produced.
  result_id    uuid REFERENCES crs_results(id) ON DELETE SET NULL,

  provider     text NOT NULL DEFAULT 'crs',
  provider_ref text,

  -- Why a failed pull failed, as the provider said it. Free text on purpose:
  -- the vocabulary is the provider's and is not ours to close.
  failure_reason text,

  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The newest request per client, which is the only lookup the read path does.
CREATE INDEX IF NOT EXISTS idx_soft_pull_requests_client
  ON soft_pull_requests (client_id, requested_at DESC);

-- One row per provider request id, so a replayed webhook cannot record the same
-- pull twice and make a client look like they were pulled repeatedly. Partial:
-- a request made before the provider assigned an id has none, and two of those
-- are not provably the same request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_soft_pull_requests_provider_ref
  ON soft_pull_requests (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- A completed pull must say what came back, and an uncompleted one must not
-- claim a result. Enforced here rather than in application code because this is
-- the row a dispute is answered from.
ALTER TABLE soft_pull_requests DROP CONSTRAINT IF EXISTS soft_pull_requests_completed_has_result;
ALTER TABLE soft_pull_requests ADD CONSTRAINT soft_pull_requests_completed_has_result
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND result_id IS NULL)
  );

COMMENT ON TABLE soft_pull_requests IS
  'Audit record that a credit pull was requested: when, on what basis, by whom, and what came back. RECORD ONLY — nothing here pulls anything. crs_results holds what came back; this holds what was asked. See db/migrations/077_soft_pull_requests.sql.';

COMMENT ON COLUMN soft_pull_requests.reason IS
  'COMPLIANCE: free text, deliberately and temporarily. The FCRA enumerates permissible purposes and a compliant system stores a coded one. No such vocabulary exists anywhere in this repo, and inventing it in a migration would be inventing the compliance model unreviewed. Treat as an operational note, NOT a compliance artifact, until counsel names the purposes and this becomes a CHECK.';

COMMENT ON COLUMN soft_pull_requests.pull_type IS
  'soft = does not affect the consumer score; hard = does. Recorded explicitly because a hard pull stored as soft is a misrepresentation to a consumer.';

COMMENT ON COLUMN soft_pull_requests.requested_by IS
  'NULL = no employee initiated this; an Inngest workflow did, on diagnostic.paid. Nullable so the actor is never invented. See src/shifts/TELEMETRY-CALLSITES.md for the same finding.';

COMMENT ON COLUMN soft_pull_requests.consent_document_id IS
  'The signed soft-pull authorization in documents (kind=authorization, subtype=soft_pull_consent). NULL = no consent captured — a visible gap, not a pass.';
