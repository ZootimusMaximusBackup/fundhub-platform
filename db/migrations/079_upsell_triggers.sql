-- 079_upsell_triggers.sql — the rule and threshold configuration behind an
-- upsell alert. CONFIGURATION ONLY. A trigger that has FIRED is an `alerts` row.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE DECISION THIS FILE MAKES, AND WHY.
--
-- "upsell_triggers" could reasonably have meant either of two tables: the rules
-- that decide when to upsell, or the log of times a rule fired. It is the rules.
--
-- The fire log already exists. 078 stores a raised alert with kind, subject,
-- state, the numbers that caused it (`detail`), and when. An `upsell_triggers`
-- table that also stored fires would be a second answer to "did this fire, and
-- when" — two tables that must agree, drifting the first time one is written and
-- the other is not. The repo has already paid for that kind of duplication (054
-- refuses to store a utilization column for the same reason), so: one fire log,
-- and it is `alerts`.
--
-- What did NOT exist anywhere is the threshold. It was hardcoded — 0.30, in the
-- default parameter of calcFunding() in src/calculators/deal-funding.mjs, where
-- the comment calls it "per-org configurable" and no per-org anything exists.
-- This table is that missing surface.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- EVERY RULE SHIPS OFF. `enabled` defaults to false and this migration inserts
-- NO ROWS. Both are deliberate, and they are the same decision twice:
--
--   * A threshold that nobody has approved is not a default, it is a guess with
--     a database row around it. 052_config_defaults.sql set provisional values
--     under protest and carried them with signed_off_at IS NULL so they stayed
--     visible as provisional. This file does not even do that — it ships the
--     column and no value.
--   * A rule that arrived switched on would start flagging real clients' credit
--     the moment the migration landed, on a number nobody chose. The build is
--     not gated; the firing is. Same posture as src/mail/, which is finished and
--     deliberately drops nothing.
--
-- NOTHING HERE TRANSMITS AND NOTHING HERE SCHEDULES. There is no cooldown
-- column, no next_run_at, no last_fired_at. Those are scheduler columns and
-- there is no scheduler. Duplicate suppression is already handled, in 078, by
-- the partial unique index that allows one OPEN alert per condition.

CREATE TABLE IF NOT EXISTS upsell_triggers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES orgs(id),

  -- WHICH RULE. One value per pure evaluator in src/alerts/evaluate.mjs. The
  -- names match the function behaviour, not the function names, so renaming a
  -- function does not orphan a config row.
  --   utilization_over_threshold — evaluateUtilization(): balance/limit above
  --                                threshold_bps. Uses threshold_bps.
  --   score_below_threshold      — evaluateScore(): a credit score under
  --                                threshold_score. Uses threshold_score.
  --   card_upgrade_case          — suggestCardUpgrade(): there is a documented
  --                                case for a better card. Uses threshold_bps
  --                                for its utilization input; the rest of the
  --                                rule is code, not config.
  -- Adding a rule means a NEW migration with a replacement CHECK. Editing this
  -- file once applied is a silent no-op (migrate.mjs keys on '<dir>/<file>').
  rule      text NOT NULL
            CHECK (rule IN ('utilization_over_threshold', 'score_below_threshold', 'card_upgrade_case')),

  -- OFF. See the header. A human turns this on, per org, per rule.
  enabled   boolean NOT NULL DEFAULT false,

  -- Utilization threshold in BASIS POINTS. 3000 = 30.00%.
  --
  -- Integer, because this number is multiplied against balances and compared at
  -- the boundary, and a float threshold reintroduces exactly the class of defect
  -- src/commissions/money.mjs exists to prevent (and that
  -- src/affiliates/economics.mjs still demonstrates, a cent short, in
  -- production). Basis points here, a decimal fraction at the code boundary, one
  -- conversion, in thresholdFromBps() in src/alerts/evaluate.mjs. Same shape as
  -- 054: cents in the column, dollars at the edge.
  --
  -- NULL means UNSET — no threshold has been chosen. It does not mean zero. A
  -- zero threshold would fire on every client with any balance at all; unset
  -- must therefore refuse to fire rather than fire on everyone, and the pure
  -- evaluators return an unknown result rather than a decision when handed one.
  -- Ceiling is 100000 (1000%) not 10000, because a card can be genuinely over
  -- its limit and an org may want to flag only the extreme cases.
  threshold_bps    integer CHECK (threshold_bps IS NULL OR (threshold_bps >= 0 AND threshold_bps <= 100000)),

  -- Credit score threshold, as a whole score. NULL means UNSET, same as above.
  -- Bounded 300..850: the published range of the FICO and VantageScore 3.0/4.0
  -- scales, which are the only scales this repo has anything to say about. A
  -- value outside it is a data error rather than a strict threshold, and is
  -- refused here instead of banded on a guess.
  threshold_score  integer CHECK (threshold_score IS NULL OR (threshold_score BETWEEN 300 AND 850)),

  -- The severity to stamp on alerts this rule raises. Presentation, not policy —
  -- see the note on alerts.severity.
  severity  text NOT NULL DEFAULT 'info'
            CHECK (severity IN ('info', 'warning', 'critical')),

  -- WHERE THE NUMBER CAME FROM, in words, from whoever chose it. NULL means
  -- nobody wrote it down — which is itself worth being able to query for.
  notes     text,

  -- Provisional until a human signs it off. Borrowed verbatim from the pattern
  -- 052_config_defaults.sql established: a default that stops being visible is a
  -- default nobody re-examines. NULL = not signed off. A row may be enabled and
  -- unsigned; that combination is a report, not an error, so it is not a CHECK.
  signed_off_at  timestamptz,
  signed_off_by  uuid REFERENCES staff(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One configuration row per rule per org. A second row for the same rule would
-- be a second threshold, and nothing could say which one applied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_triggers_org_rule
  ON upsell_triggers (org_id, rule);

-- The evaluator's query: the live rules for one org.
CREATE INDEX IF NOT EXISTS idx_upsell_triggers_enabled
  ON upsell_triggers (org_id, rule)
  WHERE enabled;

CREATE OR REPLACE TRIGGER trg_upsell_triggers_updated
  BEFORE UPDATE ON upsell_triggers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The link back. Lives here rather than in 078 so that 078 stands alone and does
-- not forward-reference a table that does not exist yet.
--
-- NULL means this alert was not raised by a configured rule — raised by hand, or
-- by an evaluator called directly with an explicit threshold. It is not a
-- missing foreign key; it is the ordinary case until rules are switched on.
-- New column, nullable, no default: no existing row changes.
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS trigger_id uuid REFERENCES upsell_triggers(id) ON DELETE SET NULL;

-- "Which alerts did this rule raise" — the query that tells an owner whether a
-- threshold is set right, by showing how many of its alerts got dismissed.
CREATE INDEX IF NOT EXISTS idx_alerts_trigger
  ON alerts (trigger_id, raised_at DESC)
  WHERE trigger_id IS NOT NULL;
