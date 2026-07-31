-- 078_alerts.sql — things the system noticed about a client that a human should
-- look at.
--
-- WHY THIS EXISTS. The evaluators in src/alerts/evaluate.mjs compute findings —
-- utilization crossed a threshold, a score moved, a card is maxed. Those
-- findings are worthless if they only exist for the duration of a page render:
-- nobody can acknowledge one, nobody can tell a new finding from the same
-- finding on its ninetieth day, and "we told them" is not provable. This table
-- is where a finding becomes a thing with a lifecycle.
--
-- AN ALERT IS NOT ADVICE AND THIS TABLE HOLDS NO CLAIMS ABOUT CREDIT OUTCOMES.
-- `message` is an observation about data the client's own file already contains
-- ("aggregate utilization is 62%"). It is not a prediction, not a promise, and
-- not a statement about what will happen to a score. Nothing in this repo may
-- draft customer-facing claims about credit outcomes, and a row here that did
-- would be one.
--
-- THE EVIDENCE COLUMN IS THE POINT. `evidence` holds the numbers the finding was
-- computed from. An alert that says "utilization is high" without saying high
-- compared to what, over which cards, at what moment, cannot be checked and
-- cannot be defended. It is also the only way to tell a stale alert from a
-- current one after the underlying balances change.
--
-- DEDUPE IS A CONSTRAINT, NOT A CONVENTION. The evaluators are pure and will
-- happily produce the same finding on every run — that is correct behaviour for
-- a pure function and catastrophic for a table. `dedupe_key` plus the partial
-- unique index below means the ninetieth evaluation of an unchanged fact updates
-- one row instead of adding a ninetieth. The key is the caller's to choose,
-- because only the caller knows what "the same finding" means for its kind.
--
-- NOTHING HERE NOTIFIES ANYONE. No email, no SMS, no push. `sendTemplated`
-- writes rows with status='queued' and nothing transmits — there is no outbound
-- fetch in src/adapters/ or src/lib/. An alert row is a row.

CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Free text on purpose. A closed CHECK here would have to be edited by every
  -- future evaluator, and an evaluator blocked by a migration writes no alert at
  -- all — which is a worse failure than an unfamiliar kind string. The
  -- vocabulary the evaluators actually emit is listed in src/alerts/evaluate.mjs
  -- and that module is the one place it is defined.
  kind         text NOT NULL,

  --   info     — worth knowing, no action implied
  --   warn     — someone should look
  --   critical — someone should act
  -- Closed, unlike kind: severity drives ordering and filtering on every screen,
  -- and a fourth value invented by one evaluator would sort unpredictably
  -- everywhere.
  severity     text NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info', 'warn', 'critical')),

  --   open         — raised, nobody has touched it
  --   acknowledged — a human has seen it
  --   resolved     — the underlying condition went away
  --   dismissed    — a human decided it does not matter
  -- resolved and dismissed are deliberately different: one is the world
  -- changing, the other is a judgement. Collapsing them loses the fact that
  -- somebody made a call.
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),

  -- A plain observation. See the header: NOT a claim about credit outcomes.
  message      text NOT NULL,

  -- The numbers behind the finding. Defaults to {} rather than NULL so a reader
  -- never has to distinguish "no evidence key" from "evidence was null".
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What "the same finding" means, chosen by whoever raised it. NULL means this
  -- alert does not dedupe — every raise is a distinct event. That is a real
  -- choice for one-off findings and is why the unique index is partial.
  dedupe_key   text,

  raised_at    timestamptz NOT NULL DEFAULT now(),

  -- Who acted, and when. NULL staff on a resolved alert is honest: a condition
  -- that went away on its own was resolved by nobody.
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES staff(id),
  resolved_at     timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One live alert per (client, kind, dedupe_key). Scoped to the states that are
-- still live, so a resolved alert does not block the same condition being raised
-- again next month — a recurrence is a new event and should look like one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_live_dedupe
  ON alerts (client_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_alerts_client_open
  ON alerts (client_id, raised_at DESC) WHERE status IN ('open', 'acknowledged');

-- The queue view: everything live in the org, worst first.
CREATE INDEX IF NOT EXISTS idx_alerts_org_severity
  ON alerts (org_id, severity, raised_at DESC) WHERE status IN ('open', 'acknowledged');

-- An acknowledged alert must say when, and a resolved one must say when. A
-- lifecycle column that can be set without its timestamp produces a queue nobody
-- can age or audit.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_lifecycle_timestamps;
ALTER TABLE alerts ADD CONSTRAINT alerts_lifecycle_timestamps
  CHECK (
    (status <> 'acknowledged' OR acknowledged_at IS NOT NULL) AND
    (status <> 'resolved'     OR resolved_at     IS NOT NULL)
  );

COMMENT ON TABLE alerts IS
  'Findings the evaluators raised about a client, with a lifecycle. NOTHING HERE NOTIFIES ANYONE — no email, no SMS, nothing transmits. message is an observation about the client own data and is NEVER a claim or prediction about credit outcomes. See db/migrations/078_alerts.sql.';

COMMENT ON COLUMN alerts.evidence IS
  'The numbers the finding was computed from. An alert that cannot say high compared to what, over which cards, at what moment cannot be checked or defended.';

COMMENT ON COLUMN alerts.dedupe_key IS
  'What the raiser considers the same finding. NULL = this alert does not dedupe; every raise is a distinct event. The unique index is partial and covers only live states, so a recurrence after resolution is a new row.';

COMMENT ON COLUMN alerts.kind IS
  'Free text deliberately: a closed CHECK would have to be migrated for every new evaluator, and an evaluator blocked by a migration writes no alert at all. The emitted vocabulary is defined in src/alerts/evaluate.mjs.';
