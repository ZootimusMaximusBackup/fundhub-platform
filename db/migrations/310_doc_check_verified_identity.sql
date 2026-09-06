-- 310_doc_check_verified_identity.sql
--
-- TWO THINGS, ONE FILE, because they are the same change.
--
-- ONE. The Document Check agent already reads the government ID and the proof
-- of address and already decides whether the two addresses match. Its output
-- schema never asked it for the name and address it just read, so the verified
-- values died inside the model call. Downstream, the dispute letters fell back
-- to clients.first_name + clients.last_name (typed by a closer on a sales call,
-- no middle name) and pii_identity.addresses[0] (the first element of an
-- unvalidated jsonb array). That is how a letter once asserted a client's
-- BUSINESS address was their home address.
--
-- This migration adds the fields to the output schema, appends the matching
-- instruction to the prompt, and gives pii_identity somewhere to keep the
-- answer. pii_identity is the existing home for a person's DOB and addresses,
-- so the verified values sit beside the on-file ones rather than in a new
-- table. They are held in SEPARATE columns from dob / addresses on purpose:
-- the on-file values are what somebody typed, the verified values are what an
-- agent read off a document, and collapsing the two would lose exactly the
-- distinction the letters need.
--
-- TWO. GoHighLevel is out (owner, 2026-08-15). The agent code becomes
-- DOC-CHECK and its Inngest function id becomes doc-check. The code change
-- ships in the same commit; the agent's row has to move with it or nothing
-- wakes the agent.
--
-- 114_ghl_agent_seed.sql IS NOT EDITED. db/migrate.mjs keys schema_migrations
-- by '<dir>/<file>' and skips what it has already applied, so editing it would
-- be a silent no-op. This file supersedes it for this one row.

-- ── 1. Somewhere to keep what the agent read ────────────────────────────────
-- All nullable. NULL means "no document has proved this yet" and must survive:
-- code that fills a gap here puts a sentence in a letter mailed to a credit
-- bureau in a real person's name.
ALTER TABLE pii_identity
  ADD COLUMN IF NOT EXISTS verified_legal_name    text,
  -- {line1, line2, city, state, zip, formatted} — whichever parts were printed
  -- on the document. Never merged with an address from anywhere else.
  ADD COLUMN IF NOT EXISTS verified_address       jsonb,
  ADD COLUMN IF NOT EXISTS verified_dob           date,
  -- the agent code that last wrote any of the three above
  ADD COLUMN IF NOT EXISTS verified_by            text,
  ADD COLUMN IF NOT EXISTS verified_at            timestamptz,
  -- Per-field provenance, because the three fields can legitimately come from
  -- different uploads: the ID carries the name and DOB, a utility bill carries
  -- the current address. Shape, one key per field that has ever been proved:
  --   {"legal_name": {"document_id": "...", "document_version_id": "...",
  --                   "agent": "DOC-CHECK", "at": "2026-09-04T..."}}
  -- A single verified_at column could not say which document proved which
  -- field, and "which document proved this" is the whole point of the audit.
  ADD COLUMN IF NOT EXISTS verified_field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pii_identity.verified_legal_name IS
  'Full legal name as printed on a government ID, read by the DOC-CHECK agent. NULL = never proved.';
COMMENT ON COLUMN pii_identity.verified_address IS
  'Current address as printed on the document the DOC-CHECK agent accepted. NULL = never proved.';
COMMENT ON COLUMN pii_identity.verified_dob IS
  'Date of birth as printed on a government ID. NULL = never proved. Separate from pii_identity.dob, which is whatever was typed at intake.';

-- ── 2. Ask the agent for what it reads ──────────────────────────────────────
UPDATE agents
   SET output_schema = jsonb_build_object(
         'outcome',            'accept, request_more, or hold',
         'documents_reviewed', jsonb_build_array('list what you saw'),
         'issues',             jsonb_build_array('each problem in one line, empty if none'),
         'message_to_client',  'what to tell the client, only if request_more',
         'hold_reason',        'one line, only if hold',
         'verified_legal_name',
           'the full legal name EXACTLY as printed on the government ID, including any middle name or initial. null if this upload is not a government ID or the name is not legible.',
         'verified_address',
           jsonb_build_object(
             'line1', 'street address exactly as printed, or null',
             'line2', 'unit or apartment exactly as printed, or null',
             'city',  'city exactly as printed, or null',
             'state', 'two-letter state, or null',
             'zip',   'ZIP exactly as printed, or null'
           ),
         'verified_date_of_birth',
           'YYYY-MM-DD exactly as printed on the government ID, or null if this upload does not show one'
       ),
       updated_at = now()
 WHERE code = 'GHL-DOC';

UPDATE agents
   SET prompt = prompt || E'\n\nRETURN WHAT YOU READ\nYou are the only thing in this system that ever sees the document. Whatever you copy out of it becomes the client''s identity of record and is quoted in letters mailed to the credit bureaus, so copy it and never compose it. Fill verified_legal_name, verified_address and verified_date_of_birth with what is PRINTED ON THE IMAGE IN FRONT OF YOU. Do not copy them from the client data on file. Do not correct spelling, expand an abbreviation, or tidy up formatting. If a field is not printed on this document, or you cannot read it clearly, set it to null. A null is always the right answer when you are not sure; a guess is never one. On a proof of address, verified_address is the address printed on the bill or statement and verified_legal_name is the name printed on it; leave verified_date_of_birth null. On a government ID, fill all three. On any other document type, leave all three null. These three fields are yours to fill whatever the outcome is, but only an accept is recorded.',
       updated_at = now()
 WHERE code = 'GHL-DOC'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%RETURN WHAT YOU READ%';

-- ── 3. The rename ───────────────────────────────────────────────────────────
-- agent_triggers.agent_code is a plain text column, not a foreign key (checked
-- 2026-09-04), so it is updated here rather than cascading. agent_runs history
-- keeps 'GHL-DOC' on rows that really did run under that code; nothing reads
-- agent_runs.agent_code by that literal.
UPDATE agent_triggers
   SET agent_code = 'DOC-CHECK',
       updated_at = now()
 WHERE agent_code = 'GHL-DOC';

UPDATE agents
   SET code          = 'DOC-CHECK',
       runtime_ref   = 'doc-check',
       runtime_notes = COALESCE(runtime_notes || ' · ', '') ||
         'Renamed from GHL-DOC to DOC-CHECK by migration 310 on 2026-09-04. ' ||
         'GoHighLevel is out; this agent has only ever run on Inngest inside ' ||
         'this repository. The Inngest function id moved with it: ' ||
         'ghl-doc-document-check is now doc-check.',
       updated_at    = now()
 WHERE code = 'GHL-DOC';
