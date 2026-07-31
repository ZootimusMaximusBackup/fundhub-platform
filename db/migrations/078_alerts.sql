-- 078_alerts.sql — a client-level alert: something crossed a line somebody set,
-- and it stays visible until a person deals with it.
--
-- WHY THIS EXISTS. The platform can compute plenty that somebody should act on —
-- a card at 94% utilization, a score that dropped 40 points — and has nowhere to
-- put the observation. Today the only way to notice is for a human to open the
-- right screen on the right day. An alert that exists only while a page is open
-- is not an alert.
--
--
-- THE THRESHOLD THAT FIRED IS STORED ON THE ROW, AND THAT IS THE WHOLE POINT.
-- `threshold_value` is not decoration and it is not denormalisation. Policy
-- changes: the day somebody moves the utilization line from 80% to 70%, every
-- alert already raised was raised under the old line, and a row that stores only
-- the observed value silently re-reads as having fired under the new one. The
-- pair (observed_value, threshold_value) makes an alert explain itself forever,
-- with no lookup into a config table whose value has since moved.
--
-- This is the same reasoning 013_commission_rules.sql applies to rates and 011
-- applies to an agreed price: the number that governed a past decision belongs
-- with the decision.
--
--
-- *** THERE ARE NO THRESHOLD ROWS ANYWHERE IN THIS REPOSITORY, AND THIS FILE
-- *** DOES NOT INVENT ANY. `config_defaults` (052) holds no utilization band, no
-- *** score-drop trigger, no alert policy of any kind. src/alerts/index.mjs
-- *** therefore REQUIRES thresholds to be passed in and refuses to run without
-- *** them, rather than shipping a plausible 30/50/90 that would read as a
-- *** decision somebody made. The absence is the finding.
--
--
-- ONE OPEN ALERT PER SUBJECT. Re-evaluating a client every night must not stack
-- thirty copies of "utilization is high" — an inbox that cries wolf is one nobody
-- reads, and the volume itself destroys the signal. `dedupe_key` plus the partial
-- unique index below means the second evaluation updates nothing and inserts
-- nothing while the first is still open. A RESOLVED alert does not block a new
-- one: the same card crossing the line again next quarter is a new event.
--
--
-- WHAT WAS DELIBERATELY NOT DONE (1): NOTHING IS SENT. No email, no SMS, no
-- push, no scheduler, no `notify_at` column. Writing a row is not telling
-- anybody. `sendTemplated` writes `status='queued'` and nothing in this
-- repository transmits, so an alert that claimed to have notified a client would
-- be claiming something the platform cannot do.
--
-- WHAT WAS DELIBERATELY NOT DONE (2): NO SEVERITY LADDER. 'low/medium/high' is
-- three words nobody has defined, and every reader would define them
-- differently. What is stored instead is what was observed and what line it
-- crossed, which any consumer can rank for itself against its own policy.
--
-- WHAT WAS DELIBERATELY NOT DONE (3): NO CLIENT-FACING COPY. There is no
-- message, headline or body column. What a consumer is TOLD about their own
-- credit is compliance-flagged territory (credit-repair messaging), and a text
-- column here would become that copy by default, written by whoever added the
-- alert. Rendering is a decision for a reviewed surface.

CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  --   utilization — a revolving line, or the whole book, is drawn too far.
  --   score       — a credit score moved more than the line allows.
  -- Two kinds because two are implemented (src/alerts/index.mjs). A kind with no
  -- evaluator is a word, not a feature; the CHECK grows when an evaluator does.
  kind         text NOT NULL CHECK (kind IN ('utilization', 'score')),

  --   open         — nobody has looked at it.
  --   acknowledged — seen, being worked, still true.
  --   resolved     — no longer true, or dealt with.
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'acknowledged', 'resolved')),

  -- What was measured, and the line it crossed. numeric rather than integer
  -- cents because neither is money: a utilization is a ratio in [0,1] and a
  -- score is a bureau integer. Both NULLABLE because an alert can be raised on a
  -- fact that has no single number.
  observed_value  numeric,
  threshold_value numeric,

  -- The specific thing this is about — a tradelines row for a per-card
  -- utilization alert. NULL for a whole-book alert, which is a real subject and
  -- not a missing one.
  tradeline_id uuid REFERENCES tradelines(id) ON DELETE CASCADE,

  -- The inputs the evaluation ran on, kept verbatim. When somebody disputes an
  -- alert months later, this is what settles it.
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What makes two evaluations "the same alert". Built by the evaluator, stored
  -- so the uniqueness below is over a value the reader can see rather than a
  -- rule buried in code.
  dedupe_key   text NOT NULL CHECK (btrim(dedupe_key) <> ''),

  raised_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Resolved means resolved, in both directions. Without the reverse half a row
  -- can carry a resolution date while still reading as open — and that is the
  -- row that stays in somebody's queue forever.
  CONSTRAINT alerts_resolved_coherent CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS alerts_client_idx
  ON alerts (org_id, client_id, raised_at DESC);

-- "What is waiting for somebody" — the queue read.
CREATE INDEX IF NOT EXISTS alerts_open_idx
  ON alerts (org_id, raised_at)
  WHERE status <> 'resolved';

-- One live alert per subject. Partial on status so the same line crossed again
-- after a resolution is a new alert, not a blocked one. Per-org, never global.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_dedupe_uq
  ON alerts (org_id, client_id, dedupe_key)
  WHERE status <> 'resolved';

DROP TRIGGER IF EXISTS trg_alerts_updated ON alerts;
CREATE TRIGGER trg_alerts_updated BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
