-- 077_soft_pull_requests.sql — the ledger that answers "why was this person's
-- credit pulled, who asked for it, and what did it cost".
--
-- *** NOTHING IN THIS FILE PULLS ANYBODY'S CREDIT, AND NOTHING IN THIS FILE CAN
-- *** BE SWITCHED ON TO MAKE IT PULL ANYBODY'S CREDIT.
-- Same posture as 065/067 for the mail build: this migration creates ONE TABLE.
-- There is no provider client, no scheduler, no activation flag, and no env var
-- that turns a row in this table into a request at a bureau. A row here records
-- that somebody asked. The asking is a seam (src/finance/soft-pulls.mjs) that is
-- deliberately not connected to anything outbound — there is no `fetch()` in
-- src/adapters/ or src/lib/ and this does not add one.
--
--
-- WHY THIS EXISTS.
--
-- `crs_results` (001_init.sql) holds the OUTPUT of a soft pull: one jsonb blob
-- per pull, with a client and a timestamp. `src/tradelines/store.mjs` reads the
-- cards back out of it. Between those two there is a hole the size of the whole
-- compliance question: nothing anywhere records that a pull was *requested*, by
-- *whom*, or *why*.
--
-- A soft pull is a consumer-credit event. The question an auditor, a regulator
-- or an angry client asks is never "what did the report say" — that is in
-- crs_results already. It is "who authorised this, and on what basis". Today the
-- honest answer is that the platform does not know: a crs_results row has an
-- org, a client, a payload and a created_at, and no attribution of any kind.
--
-- This table is that answer. One row per request. Who asked, for which client,
-- when, why, what it cost, which crs_results row came back, and what state the
-- request is in.
--
--
-- ATTRIBUTION IS STRUCTURAL, NOT A CONVENTION.
--
-- `src/pii/index.mjs` revealSsn() refuses outright when `accessedBy` is absent —
-- "an unattributed reveal is not loggable" — and writes its log row inside the
-- same transaction as the disclosure, before the value is returned. This table
-- takes the same position one layer down, in the schema rather than in a
-- function that a caller could forget to use:
--
--   * requested_by_kind is NOT NULL and CHECKed to one of two values;
--   * exactly one of the two subject columns must be populated, and it must be
--     the one the kind names (soft_pull_requests_requester_ck);
--   * reason is NOT NULL and CHECKed non-blank, so "" and "   " are as refused
--     as NULL is. A whitespace reason is worse than none: it looks populated in
--     an audit export and says nothing. src/http/pii.pg.test.mjs already pins
--     that exact distinction for SSN reveals; the same rule applies here.
--     The check is `reason ~ '[^[:space:]]'` and NOT `btrim(reason) <> ''`:
--     btrim's default trim set is the SPACE CHARACTER ONLY, so a reason of
--     E'\t\n' passes the btrim form and lands looking like an answer. That was
--     the first version of this file and soft-pulls.pg.test.mjs caught it,
--     because it asserts against the table rather than against the module.
--
-- There is no way to write a row to this table that does not say who asked and
-- why. That is the entire point of putting it here instead of in the service
-- module.
--
--
-- MONEY IS INTEGER CENTS, AND NULL IS A REAL ANSWER.
--
-- `cost_cents` is bigint, matching `tradelines` (054) and the reasoning in
-- src/commissions/money.mjs — every other money column in this schema is
-- numeric dollars and that is the wrong call for values that get summed. New
-- table, so it starts correct.
--
-- NULL cost_cents means UNKNOWN and must survive. It does NOT mean free. A pull
-- requested before a price is known, or under a plan whose per-pull cost is not
-- modelled here, has an unknown cost; defaulting that to 0 would put "this pull
-- was free" into a billing report that nobody checked. The column is nullable
-- with no default, deliberately.
--
--
-- subscription_id CARRIES NO FOREIGN KEY, ON PURPOSE.
--
-- Subscriptions and stored payment credentials are another workflow's build and
-- another workflow's migration. This file must apply cleanly to a database where
-- no `subscriptions` table exists, so the column is a bare uuid: it records
-- WHICH plan a request was attributed to when the caller knows, and NULL when
-- the request was ad-hoc or the plan is unknown. When the owning table lands, an
-- FK can be added by a later migration that can see it. Adding one here would
-- couple two parallel builds through the schema and break whichever applied
-- first.
--
--
-- THE STATE SET HAS NO 'sent'.
--
--   queued     — recorded, nobody has asked a bureau. This is where every row
--                starts and, today, where every row stays.
--   fulfilled  — a crs_results row answered it; crs_result_id points at it.
--   failed     — the request ended without an answer; state_reason says why.
--   cancelled  — withdrawn before an answer; state_reason says why.
--
-- 'sent' / 'in_flight' is missing because nothing can reach that state: there is
-- no transmitter. `sendTemplated` (src/workflows/messaging.mjs) has exactly this
-- shape — it writes `messages` rows with provider='internal', status='queued',
-- and nothing drains them — and this table copies it rather than inventing a
-- richer lifecycle that no code can drive. An unreachable enum value is a
-- promise the schema cannot keep. Adding one when a provider client exists is a
-- new migration and a deliberate act.
--
--
-- WHAT IS IMMUTABLE, AND WHAT IS NOT.
--
-- The request facts — org, client, who asked, why, when, and the plan it was
-- billed to — cannot be updated after insert (trg_soft_pull_requests_immutable).
-- Those are the audit trail. The outcome columns (status, crs_result_id,
-- state_reason, resolved_at, cost_cents once known) are meant to move forward
-- and are left alone by the guard.
--
-- There is NO delete guard, unlike 016_ledger_no_delete.sql, and that is a
-- decision rather than an oversight. The only delete path is the cascade from
-- `clients`, and a consumer-credit log SHOULD go when the consumer's record goes
-- — a table of "we pulled this person's credit" that outlives the erasure of the
-- person is a liability, not an audit trail. Nothing else in the codebase
-- deletes from here, and the immutability trigger means a row cannot be quietly
-- rewritten in place instead.

CREATE TABLE IF NOT EXISTS soft_pull_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHO ASKED. Two principal kinds can tap the button: an employee working the
  -- file, and the client themself from the portal. They live in different tables
  -- (staff / accounts) and collapsing them into one text column would lose the
  -- foreign key, which is the only thing that makes the attribution checkable
  -- later. So: a kind, and one FK per kind, with a CHECK that they agree.
  requested_by_kind       text NOT NULL
                          CHECK (requested_by_kind IN ('staff', 'client')),
  requested_by_staff_id   uuid REFERENCES staff(id),
  requested_by_account_id uuid REFERENCES accounts(id),

  -- WHY. Free text, because the reason a pull is justified is a sentence, not an
  -- enum — "closer working the funding file, client asked for an updated
  -- waterfall" is the answer an audit needs; a code from a dropdown is not.
  -- NOT NULL and at least one non-whitespace character: see the header for why
  -- this is a regex and not btrim().
  reason        text NOT NULL
                CONSTRAINT soft_pull_requests_reason_ck CHECK (reason ~ '[^[:space:]]'),

  -- WHAT IT COST, in integer cents. NULL means UNKNOWN, not free.
  cost_cents    bigint CHECK (cost_cents IS NULL OR cost_cents >= 0),

  -- WHICH PLAN it was billed against, when the caller knew. No FK — see header.
  subscription_id uuid,

  -- WHICH crs_results ROW ANSWERED IT. NULL until one does. ON DELETE SET NULL
  -- rather than CASCADE: losing the report must not erase the record that a pull
  -- was requested. The request happened either way.
  crs_result_id uuid REFERENCES crs_results(id) ON DELETE SET NULL,

  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'fulfilled', 'failed', 'cancelled')),

  -- Why a request ended where it did. Only meaningful for failed/cancelled.
  state_reason  text,

  -- Which provider was asked. 'internal' is the honest value while nothing
  -- transmits — the same string sendTemplated writes on a queued message.
  provider      text NOT NULL DEFAULT 'internal',

  -- Caller-supplied replay guard. A one-tap button that a phone retries must not
  -- pull a consumer's credit twice. NULL is allowed (an ad-hoc request from a
  -- console has nothing to key on) and the unique index below is partial to
  -- match, exactly as tradelines' account_ref index is.
  idempotency_key text,

  requested_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Exactly one requester, and it must be the kind the row claims. This is the
  -- constraint that makes "an unattributed pull is not loggable" true of the
  -- database and not merely of the module that usually writes to it.
  CONSTRAINT soft_pull_requests_requester_ck CHECK (
    (requested_by_kind = 'staff'
       AND requested_by_staff_id IS NOT NULL AND requested_by_account_id IS NULL)
    OR
    (requested_by_kind = 'client'
       AND requested_by_account_id IS NOT NULL AND requested_by_staff_id IS NULL)
  ),

  -- A resolved request has an end time; a queued one does not. Keeps
  -- "still waiting" answerable without reading status and resolved_at together
  -- and hoping they agree.
  CONSTRAINT soft_pull_requests_resolved_ck CHECK (
    (status = 'queued' AND resolved_at IS NULL)
    OR (status <> 'queued' AND resolved_at IS NOT NULL)
  ),

  -- Only a fulfilled request may name a result, and a fulfilled one must.
  -- Without this, 'failed' rows could carry a crs_result_id and the ledger would
  -- disagree with itself about whether an answer arrived.
  CONSTRAINT soft_pull_requests_result_ck CHECK (
    (status = 'fulfilled' AND crs_result_id IS NOT NULL)
    OR (status <> 'fulfilled' AND crs_result_id IS NULL)
  )
);

-- The read this table exists for: one client's pull history, newest first.
CREATE INDEX IF NOT EXISTS idx_soft_pull_requests_client
  ON soft_pull_requests (client_id, requested_at DESC);

-- "What is still waiting" across the org, without scanning history.
CREATE INDEX IF NOT EXISTS idx_soft_pull_requests_open
  ON soft_pull_requests (org_id, requested_at DESC) WHERE status = 'queued';

-- Replay guard. Partial, because NULL is a legitimate "nothing to key on" and a
-- plain unique index would let NULLs multiply while pretending to guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_soft_pull_requests_idem
  ON soft_pull_requests (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Deliberately NOT created: a unique index on (client_id) WHERE status='queued'.
-- It reads like the right double-tap guard and is a trap while nothing
-- transmits: every row stays 'queued' forever, so the first request a client
-- ever made would permanently block every later one at the database level, with
-- no way to clear it short of a manual UPDATE. The same guard lives in
-- src/finance/soft-pulls.mjs, where it returns the open request instead of
-- raising, and where it can be changed without a migration once there is
-- something that moves a row out of 'queued'.

COMMENT ON TABLE soft_pull_requests IS
  'Audit trail for consumer-credit soft pulls: who asked, for which client, when, why, what it cost, and which crs_results row answered. Nothing in this table transmits — see the file header of db/migrations/077_soft_pull_requests.sql.';
COMMENT ON COLUMN soft_pull_requests.cost_cents IS
  'Integer cents. NULL means UNKNOWN, never free — see src/commissions/money.mjs.';
COMMENT ON COLUMN soft_pull_requests.subscription_id IS
  'Plan this request was billed against, when known. No foreign key: the owning table is built by a separate workflow and this migration must apply without it.';

/* The request facts are the audit trail, so they are write-once. Outcome
   columns are not listed here and stay updatable — a request is supposed to
   move from queued to an answer.

   IS DISTINCT FROM, not <>: a NULL-to-value change on subscription_id is still
   a rewrite of what the request said it was billed to, and `NULL <> 'x'` is
   NULL, which a plain comparison would treat as "no change". */
CREATE OR REPLACE FUNCTION soft_pull_requests_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id                  IS DISTINCT FROM OLD.org_id
     OR NEW.client_id            IS DISTINCT FROM OLD.client_id
     OR NEW.requested_by_kind    IS DISTINCT FROM OLD.requested_by_kind
     OR NEW.requested_by_staff_id   IS DISTINCT FROM OLD.requested_by_staff_id
     OR NEW.requested_by_account_id IS DISTINCT FROM OLD.requested_by_account_id
     OR NEW.reason               IS DISTINCT FROM OLD.reason
     OR NEW.subscription_id      IS DISTINCT FROM OLD.subscription_id
     OR NEW.requested_at         IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION
      'soft_pull_requests %: who asked, for whom, why, when and against which plan are immutable — a soft pull is a consumer-credit event and its attribution cannot be rewritten',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_soft_pull_requests_immutable ON soft_pull_requests;
CREATE TRIGGER trg_soft_pull_requests_immutable
  BEFORE UPDATE ON soft_pull_requests
  FOR EACH ROW EXECUTE FUNCTION soft_pull_requests_immutable();
