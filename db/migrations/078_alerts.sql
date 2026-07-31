-- 078_alerts.sql — a raised alert: what happened, who it is for, when, and what
-- state it is in.
--
-- WHY THIS EXISTS. `src/alerts/evaluate.mjs` decides whether a condition is true
-- right now (utilization over threshold, a score band, a card-upgrade case). A
-- decision that is not written down is re-made from scratch every time somebody
-- opens a screen, which means nobody can answer the two questions that actually
-- matter on a Monday morning: what was flagged, and did anyone do anything about
-- it. This table is that record.
--
-- IT IS A RECORD, NOT A MESSAGE. Nothing in this repo transmits — there is no
-- outbound fetch in src/adapters/ or src/lib/, and `sendTemplated` writes a
-- `messages` row with status='queued' rather than sending anything. An `alerts`
-- row is the same shape of promise: it says a human should look, it does not
-- notify anybody. There is no scheduler here and no send path here, deliberately.
--
-- IT IS NOT `messages` AND IT IS NOT `tasks`. `messages` is outbound comms to a
-- contact. `tasks` is assigned work with a due date. An alert is neither: it is a
-- system observation about a client's data that may or may not turn into either
-- of those. Folding it into `tasks` would put machine-generated noise into a
-- human work queue that is already load-bearing for the shift gate.
--
-- WHAT NULL MEANS HERE. Every nullable column below has its meaning written
-- against it. The rule that governs all of them is the repo's standing one: NULL
-- is "we do not know" or "this has not happened yet", and it must survive. It is
-- never a zero and never a default. `resolved_at IS NULL` means unresolved;
-- `as_of IS NULL` means we do not know when the underlying data was true, which
-- is a materially different statement from "it was true now".
--
-- NOTHING DERIVED IS STORED. No "is_open" boolean, no age-in-days column. Both
-- are functions of columns already here and would go stale the moment `state`
-- changes. Same call 054 made about utilization.

CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  -- WHO IT IS ABOUT. NULL means the alert is not about one specific client —
  -- an org-level or data-health observation. It is not "unknown client": a row
  -- about a client we cannot identify has no business being raised at all.
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,

  -- The specific credit line the observation is about, where there is one.
  -- NULL means the alert is about the client as a whole (an aggregate
  -- utilization alert), not about a single card.
  tradeline_id uuid REFERENCES tradelines(id) ON DELETE SET NULL,

  -- WHO IT IS FOR. NULL means unassigned — raised for whoever picks it up. This
  -- is deliberately nullable: the evaluators are pure functions with no idea who
  -- owns a client, and inventing an assignee would put work in a named person's
  -- queue on a guess.
  assigned_to  uuid REFERENCES staff(id) ON DELETE SET NULL,

  -- WHAT. One value per condition the pure evaluators in src/alerts/ can decide.
  --   utilization_threshold — credit utilization at or over the configured line.
  --   score_band            — a credit score fell in / moved to a named band.
  --   upsell_opportunity    — there is a case for a better card (see 079).
  -- Adding a kind means a NEW migration with a replacement CHECK. Editing this
  -- file after it has been applied is a silent no-op — migrate.mjs keys
  -- schema_migrations on '<dir>/<file>' and will skip it.
  kind         text NOT NULL
               CHECK (kind IN ('utilization_threshold', 'score_band', 'upsell_opportunity')),

  -- HOW LOUD. An operating convention, not a rule anyone sourced: info is "for
  -- the record", warning is "somebody should look this week", critical is "look
  -- today". No behaviour in this repo branches on it; it exists so a screen can
  -- sort. Treat it as presentation, not policy.
  severity     text NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info', 'warning', 'critical')),

  -- STATE.
  --   open         — raised, nobody has touched it.
  --   acknowledged — a human has seen it and is on it.
  --   resolved     — the underlying condition was dealt with.
  --   dismissed    — a human decided it did not matter. NOT the same as
  --                  resolved, and the difference is the whole point: a pile of
  --                  dismissed alerts of one kind is the signal that the
  --                  threshold behind it is wrong.
  state        text NOT NULL DEFAULT 'open'
               CHECK (state IN ('open', 'acknowledged', 'resolved', 'dismissed')),

  -- One human-readable sentence. Written for the person reading the queue.
  --
  -- ⚠️ NOT CUSTOMER-FACING. Nothing in this repo shows an alerts row to a
  -- consumer, and nothing should start doing so without human sign-off. This is
  -- a regulated consumer-finance product: a sentence about somebody's credit,
  -- shown to that person, is a claim about a credit outcome.
  title        text NOT NULL,

  -- The evaluator's own output, verbatim — the numbers that caused this row.
  -- Kept so a disputed alert can be settled by looking at what was actually
  -- computed rather than by re-running today's data against yesterday's alert.
  -- Same reasoning as tradelines.raw.
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Idempotency. A stable string naming the CONDITION, not the occurrence — e.g.
  -- 'utilization_threshold:<tradeline_id>:3000'. The partial unique index below
  -- allows exactly one OPEN alert per condition per org, so re-evaluating the
  -- same unchanged data updates nothing instead of stacking a fourth identical
  -- row on the pile. NULL means the caller opted out of dedupe and accepts
  -- duplicates; NULLs do not collide in a unique index, which is what makes the
  -- opt-out work.
  dedupe_key   text,

  -- WHEN THE UNDERLYING DATA WAS TRUE, which is not when this row was written. A
  -- pull run Monday and evaluated Wednesday describes Monday's balances. NULL
  -- means the source data carried no as-of date — unknown, not "now". Mirrors
  -- tradelines.as_of, which is where this value comes from.
  as_of        timestamptz,

  -- WHEN IT WAS RAISED. Defaults to now() because the moment of writing is a
  -- fact the database knows; the evaluators are pure and hold no clock.
  raised_at        timestamptz NOT NULL DEFAULT now(),

  -- NULL means it has not happened yet. Never backfilled, never defaulted.
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES staff(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- Why it was dismissed. NULL when it was not dismissed, or when a human
  -- dismissed it without saying why — an absence worth being able to count.
  dismissed_reason text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The queue screen's query: everything still open in one org, newest first.
CREATE INDEX IF NOT EXISTS idx_alerts_open
  ON alerts (org_id, raised_at DESC)
  WHERE state = 'open';

-- The client-detail screen's query: this client's alert history, newest first.
CREATE INDEX IF NOT EXISTS idx_alerts_client
  ON alerts (client_id, raised_at DESC);

-- One open alert per condition. Partial on state so that a resolved alert does
-- not block the same condition being raised again later — a client who goes back
-- over the utilization line next quarter is a new alert, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_condition
  ON alerts (org_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state = 'open';

-- 001_init.sql attaches set_updated_at() to the tables that existed then, by name.
-- 054 added a table with an updated_at column and no trigger, so tradelines.updated_at
-- has never moved. Not repeating that here. CREATE OR REPLACE TRIGGER is available
-- from PG14 and is idempotent, which is what this file needs on a re-run.
CREATE OR REPLACE TRIGGER trg_alerts_updated
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
