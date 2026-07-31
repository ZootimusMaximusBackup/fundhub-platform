-- 077_soft_pull_requests.sql — the request half of a credit pull. `crs_results`
-- is the answer; nothing in the schema recorded the question.
--
-- *** COMPLIANCE REVIEW REQUIRED — PERMISSIBLE PURPOSE. ***
-- *** `reason` is FREE TEXT and that is a deliberate, flagged interim. Pulling a
-- *** consumer's credit file requires a permissible purpose under the FCRA, and a
-- *** permissible purpose is a CODED CATEGORY, not a sentence somebody typed.
-- *** This column is honest about which sentence was recorded and proves nothing
-- *** about which category it belongs to.
-- ***
-- *** A coded list is NOT invented here, for the reason the rest of this schema
-- *** keeps giving: there is no source in this repository for what the categories
-- *** are (`docs/compliance/` does not exist), and an invented enum is a guess
-- *** wearing a constraint — worse than free text, because it looks decided.
-- *** Whoever owns compliance supplies the list; a later migration adds the
-- *** column and backfills from these strings with a human reading each one.
-- ***
-- *** WHAT IS ALREADY TRUE AND IS NOT A GAP: a reason must be present and
-- *** non-empty on every row. There is no path in this schema that records a pull
-- *** with no stated reason at all.
--
--
-- WHY THIS EXISTS. `crs_results` (001_init.sql:310) stores what came back from a
-- pull: an org, a client, a jsonb payload and an outcome tier. It cannot answer
-- any of the questions an auditor actually asks — WHY was this file pulled, WHO
-- asked for it, WHEN was it asked for as opposed to answered, and did anything
-- come back at all. A pull that was requested and never returned leaves no trace
-- whatsoever today: no row is written until a result exists, so a failed pull and
-- a pull nobody ever ran are the same absence.
--
--
-- THE REQUESTER IS USUALLY NOBODY, AND THE COLUMN SAYS SO. A pull is requested by
-- `src/workflows/c-00-crs-soft-pull-request.mjs` reacting to `diagnostic.paid` —
-- the client's own $32 payment — and returned through `src/adapters/crs.mjs`. No
-- employee is involved at any point, and there is no field anywhere that says
-- which one caused a workflow to run (the same finding
-- `src/shifts/TELEMETRY-CALLSITES.md` records for `pull_run` telemetry).
--
-- So `requested_by_staff_id` is NULLABLE and NULL MEANS AUTOMATED. It is not
-- defaulted to a service account, because a service account row would read as an
-- attribution and there is nobody to attribute it to. `source` carries the
-- distinction that actually exists.
--
--
-- REPLAY SAFETY IS THE POINT OF source_event_id. `diagnostic.paid` is an event on
-- a bus with a documented replay path (Rule 9). Without a key, replaying it
-- records a second pull of the same file — and "how many times did you pull this
-- consumer's credit" is a question with a legal answer, not a cosmetic one. The
-- partial unique index below makes the second write a no-op rather than a
-- duplicate. It is per-org, never global: Rule 7.
--
--
-- WHAT WAS DELIBERATELY NOT DONE (1): NO BUREAU COLUMN. Which bureau a soft pull
-- hit is not carried by anything in this repository — not the event payload, not
-- the adapter, not `crs_results.result` in any shape that has been confirmed.
-- A column populated from a guess is worse than an absent one.
--
-- WHAT WAS DELIBERATELY NOT DONE (2): NO CONSENT FLAG. Consent is captured
-- upstream of this table (the invoice/consent gate in C-00) and a boolean here
-- would be a copy that can disagree with the record it copies. Consent capture is
-- itself compliance-flagged territory; it needs its own model, not a checkbox
-- bolted to the request.
--
-- WHAT WAS DELIBERATELY NOT DONE (3): NOTHING TRIGGERS A PULL. This table records
-- that a pull was requested. It does not request one — there is no outbound call
-- here, no job row a worker polls, and no status a scheduler advances.

CREATE TABLE IF NOT EXISTS soft_pull_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  --   requested — asked for, nothing back yet. The state that has no row today.
  --   completed — a result landed; crs_result_id points at it.
  --   failed    — the pull came back with nothing usable. Distinct from
  --               `requested` on purpose: "we tried and it did not work" and
  --               "we are still waiting" are different answers to a client.
  --   cancelled — abandoned before an answer (a refund, a withdrawn consent).
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'completed', 'failed', 'cancelled')),

  -- WHY the file was pulled. Free text, required, non-empty. See the flag at the
  -- top of this file — this is an interim, not a model of permissible purpose.
  reason       text NOT NULL CHECK (btrim(reason) <> ''),

  -- The vocabulary c-00-crs-soft-pull-request.mjs already uses, not a new one.
  -- NULL = the scope was not stated, which is a real state for a pull recorded
  -- from outside that workflow.
  scope        text CHECK (scope IS NULL OR scope IN ('consumer_only', 'consumer_plus_ex_business')),

  --   workflow — automated, reacting to an event. The normal case today.
  --   staff    — a person asked for it. Requires requested_by_staff_id.
  --   client   — the client asked through the portal.
  source       text NOT NULL DEFAULT 'workflow'
               CHECK (source IN ('workflow', 'staff', 'client')),

  -- NULL MEANS AUTOMATED — see the header. Never a service account.
  requested_by_staff_id uuid REFERENCES staff(id),

  -- The event that caused this, for replay safety. NULL for a request that did
  -- not come off the bus.
  source_event_id text,

  -- The answer, once there is one. NULL while status='requested', and NULL
  -- forever for a pull that failed — which is exactly what makes a failed pull
  -- visible instead of absent.
  crs_result_id uuid REFERENCES crs_results(id) ON DELETE SET NULL,

  -- Why it failed, in whatever words the failure arrived in. NULL unless
  -- status='failed'.
  failure_reason text,

  requested_at timestamptz NOT NULL DEFAULT now(),
  -- When it stopped being outstanding — completed, failed or cancelled alike.
  -- Distinct from requested_at because the gap between them is the answer to
  -- "how long is a client waiting", which is a number somebody will want.
  settled_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- A settled row has a settled date and an outstanding one does not. Without
  -- this, a completed pull with no settled_at reads as still outstanding to
  -- every "what is waiting" query, forever.
  CONSTRAINT soft_pull_requests_settled_coherent CHECK (
    (status = 'requested') = (settled_at IS NULL)
  ),

  -- Only a completed pull may name a result. A failed pull pointing at a
  -- crs_results row would mean the failure produced an answer.
  CONSTRAINT soft_pull_requests_result_coherent CHECK (
    crs_result_id IS NULL OR status = 'completed'
  ),

  -- A staff-sourced request must name the staff member. This is the one place
  -- "who asked" is knowable, and losing it there would make the column useless.
  CONSTRAINT soft_pull_requests_actor_coherent CHECK (
    source <> 'staff' OR requested_by_staff_id IS NOT NULL
  )
);

-- The read every screen makes: this client's pull history, newest first.
CREATE INDEX IF NOT EXISTS soft_pull_requests_client_idx
  ON soft_pull_requests (org_id, client_id, requested_at DESC);

-- "What is still outstanding" — the question no table could answer before.
CREATE INDEX IF NOT EXISTS soft_pull_requests_outstanding_idx
  ON soft_pull_requests (org_id, requested_at)
  WHERE status = 'requested';

-- Replay safety. Per-org, never global (Rule 7): a global unique on an event id
-- would let one tenant's replayed event block another's.
CREATE UNIQUE INDEX IF NOT EXISTS soft_pull_requests_event_uq
  ON soft_pull_requests (org_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_soft_pull_requests_updated ON soft_pull_requests;
CREATE TRIGGER trg_soft_pull_requests_updated BEFORE UPDATE ON soft_pull_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
