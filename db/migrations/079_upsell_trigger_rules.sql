-- 079_upsell_trigger_rules.sql — the CONDITIONS that raise a Finance OS alert.
-- Rows, not code. This file holds the shape; it deliberately holds no numbers.
--
-- WHY THIS EXISTS, AND WHY IT IS A TABLE RATHER THAN A MODULE.
--
-- 013_commission_rules.sql opens with the sentence this repository is loudest
-- about: "Every rate is a row. There are no rates in code." The reason is not
-- style. On 2026-07-31 `src/shifts/timesheet.mjs` had four compensation
-- constants removed because they were a SECOND answer to a question
-- `commission_rules` already owned, and the two answers disagreed — a $6,000
-- deposit paid $1,000 by one and $500 by the other. Nothing had been mispaid
-- only because nothing called either function. Two payable answers to one
-- question is the defect; the disagreement is just how you find out.
--
-- "Utilization dropped below X" is the same shape of question. X is a policy
-- somebody owns, it will be tuned, and tuning it must not be a deploy. So X is a
-- column value on a row in this table, and `src/finance/upsell.mjs` — the
-- evaluator — contains no threshold at all. It takes the rules as an argument
-- and refuses to fire a rule whose thresholds are unset. That refusal is tested.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVERY THRESHOLD IN THIS FILE IS NULL, AND THAT IS THE FINDING.
--
-- The three conditions below need seven numbers between them. I searched this
-- repository for a source for each one and found none:
--
--   * utilization ceiling — the only utilization number anywhere in the tree is
--     `utilizationThreshold = 0.30`, a JavaScript default parameter in
--     src/calculators/deal-funding.mjs. That number answers a DIFFERENT question:
--     it is the guardrail on whether a NEW DRAW pushes a card past a line. It is
--     not a policy about when a client's utilization has improved enough to be
--     worth a conversation, and lifting it into this table would be sourcing a
--     policy from a function's default argument. There is no config row, no
--     migration and no document in this repository that states one.
--   * "clean pull" — the schema does carry the raw facts
--     (`clients.custom_fields.crs_inquiries_ex / _eq / _tu` and
--     `crs_late_payments_count`, db/schema/005_client_custom_fields.sql). What it
--     does not carry anywhere is how many inquiries or late payments still counts
--     as clean.
--   * "seasoned" — no source for an age in months, and see the SECOND finding
--     below: the schema cannot currently measure a tradeline's age at all.
--   * "strength signals" for a second entity — nothing in this repository defines
--     what those signals are or where they cut. Grep for "second entity" returns
--     nothing outside the task that asked for this table.
--
-- So every row below ships `active = false`, `needs_config = true`, and params
-- whose KEYS are present and whose VALUES are null. The keys are there so the
-- person filling them in can see exactly what the rule reads; the nulls are there
-- because a plausible-looking default is indistinguishable from a decision
-- somebody made on purpose. This is the pattern 048_campaign_config.sql already
-- set for `kill_no_conversions` and `spend_tier_refresh`, and it is why those two
-- rules never paused a working campaign against an invented floor.
--
-- The gaps are reported by `v_upsell_config_gaps` at the bottom of this file, not
-- left as a comment nobody reads.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- SECOND FINDING — SEASONING CANNOT BE COMPUTED FROM THE SCHEMA AS IT STANDS.
-- `tradelines` (054) has no opened date. Its columns are lender, kind, limit,
-- balance, apr, source, source_ref, account_ref, raw, as_of, closed_at. There is
-- no `opened_at` and no `date_opened`, and nothing else in the tree carries one
-- (grep: zero hits for opened_at / date_opened / months_open / seasoned).
-- So `seasoned_tradelines` can only ever be answered for a line whose opened date
-- the CALLER supplies; the evaluator reads `opened_at` off the row it is handed
-- and returns "N lines have no opened date" rather than guessing an age. Adding
-- the column is a change to 054's ingest path and to the normalizer that fills
-- it, which is not this migration's block, so it is reported rather than done.
--
-- THIRD FINDING — `tradelines` KEEPS NO HISTORY, so "utilization DROPPED" cannot
-- be answered from that table alone. src/tradelines/store.mjs upserts in place by
-- (client_id, account_ref): a new pull overwrites the balance and the previous
-- one is gone. The prior position is still recoverable — `crs_results` is history
-- ("full engine output per pull", db/schema/001_init.sql:309) and
-- `normalizeFromCrs()` will re-read an older row into the same shape — but that
-- is a wiring decision for whoever calls the evaluator. The evaluator itself
-- takes both sets of lines as arguments and says so.

-- ---------------------------------------------------------------------------
-- upsell_trigger_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upsell_trigger_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  -- The evaluator's key. `src/finance/upsell.mjs` implements one function per
  -- key; a row whose key no function implements is reported as unimplemented
  -- rather than silently ignored. Adding a NEW condition is therefore a code
  -- change plus a row, exactly as 013 says of `commission_rules.amount_basis`:
  -- everything about a rule is editable except the formula it names.
  rule_key     text NOT NULL CHECK (btrim(rule_key) <> ''),

  -- How this reads on the admin screen.
  name         text NOT NULL,
  description  text,

  -- THE THRESHOLDS. jsonb rather than columns because each condition wants a
  -- different shape and a wide table of mostly-NULL numerics hides which ones a
  -- given rule actually reads — the same call 048 made for optimization_rules.
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The severity the raised alert carries (078's ladder). A row, so that
  -- promoting a condition from "worth knowing" to "act on this" is an UPDATE.
  -- Seeded at the floor for all three; see the note under the seed.
  severity     text NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info', 'warning', 'critical')),

  -- An inactive rule does not run. That is how an unset threshold stays OFF
  -- rather than running against a guess.
  active       boolean NOT NULL DEFAULT true,
  -- TRUE while a human still owes this rule a number. Read by
  -- v_upsell_config_gaps so the debt is visible rather than silently off.
  needs_config boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- A rule cannot be simultaneously live and awaiting its numbers. Same
  -- constraint as optimization_rules_config_ck, for the same reason.
  CONSTRAINT upsell_trigger_rules_config_ck CHECK (NOT (needs_config AND active))
);

-- PER ORG, NOT GLOBAL. A second org must be able to hold the same rule key with
-- its own thresholds; a globally unique rule_key would make the first org to
-- configure a condition the only one that can.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_trigger_rules_key
  ON upsell_trigger_rules (org_id, rule_key);

CREATE INDEX IF NOT EXISTS idx_upsell_trigger_rules_active
  ON upsell_trigger_rules (org_id, rule_key) WHERE active;

-- ---------------------------------------------------------------------------
-- The three conditions. Shapes seeded, numbers not.
-- ---------------------------------------------------------------------------
--
-- SEVERITY IS SEEDED AT THE FLOOR ('info') FOR ALL THREE. Nothing in this
-- repository ranks these conditions against each other, and the floor is the only
-- value that cannot over-alarm anybody. It is also inert as shipped, because
-- `active = false` means none of them can raise anything yet. Set the severity in
-- the same UPDATE that sets the thresholds.

INSERT INTO upsell_trigger_rules
  (org_id, rule_key, name, description, params, severity, active, needs_config)
SELECT o.id, v.k, v.n, v.d, v.p::jsonb, 'info', false, true
  FROM orgs o
  CROSS JOIN (VALUES

    ('utilization_drop_clean_pull',
     'Utilization dropped and the pull is clean',
     'Raise when revolving utilization has fallen to or below the ceiling from above it, the latest pull is within the clean-pull limits, and drawable headroom has actually increased. FLAGGED: all four numbers are deliberately unset. utilization_ceiling_pct is in PERCENT UNITS (30 means 30%), read the same way commission_rules.percent is. min_drop_basis_points is the smallest movement worth mentioning, in basis points (100 = 1 percentage point); leave it null to accept any drop across the ceiling. The two clean_pull limits are counts, compared against clients.custom_fields.crs_inquiries_* and crs_late_payments_count.',
     '{"utilization_ceiling_pct": null,
       "min_drop_basis_points": null,
       "clean_pull_max_inquiries_per_bureau": null,
       "clean_pull_max_late_payments": null}'),

    ('seasoned_tradelines',
     'Enough seasoned lines to be a line-of-credit or refinance candidate',
     'Raise when the client holds at least min_seasoned_lines open drawable lines that are at least min_age_months old. FLAGGED: both numbers are deliberately unset. ALSO BLOCKED ON SCHEMA: tradelines (054) stores no opened date, so age can only be measured for a line whose opened_at the caller supplies. Until 054 carries one, this rule reports how many lines it could not age rather than assuming any of them qualify.',
     '{"min_age_months": null,
       "min_seasoned_lines": null}'),

    ('strength_signals',
     'Strength signals consistent with a second entity',
     'Raise when total credit limit, count of open revolving lines and utilization are all at or beyond their thresholds at the same time. FLAGGED: all three are deliberately unset, and nothing in this repository defines what a strength signal is or where it cuts. min_total_limit_cents is INTEGER CENTS (054''s money convention). max_utilization_pct is in PERCENT UNITS.',
     '{"min_total_limit_cents": null,
       "min_open_revolving_lines": null,
       "max_utilization_pct": null}')

  ) AS v(k, n, d, p)
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM upsell_trigger_rules r
                    WHERE r.org_id = o.id AND r.rule_key = v.k);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_upsell_trigger_rules_updated_at'
                        AND tgrelid = 'public.upsell_trigger_rules'::regclass) THEN
    CREATE TRIGGER trg_upsell_trigger_rules_updated_at BEFORE UPDATE ON upsell_trigger_rules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- v_upsell_config_gaps — what a human still has to decide, on a screen
-- ---------------------------------------------------------------------------
--
-- Same reasoning as v_creative_config_gaps (048/052): a flag is only a flag if it
-- is somewhere the person who has to decide will see it. One row per UNSET
-- parameter, not one per rule, because "this rule needs configuring" does not
-- tell anybody which number is missing.

CREATE OR REPLACE VIEW v_upsell_config_gaps AS
SELECT r.org_id,
       r.rule_key,
       'upsell_trigger_rules.' || r.rule_key || '.' || p.key AS config,
       r.name AS detail,
       CASE WHEN r.active THEN 'SET — rule is live'
            ELSE 'UNSET — rule inactive until this number is decided' END AS status,
       'src/finance/upsell.mjs refuses to fire this condition while the value is null'
         AS consequence
  FROM upsell_trigger_rules r
  CROSS JOIN LATERAL jsonb_each(r.params) AS p(key, value)
 WHERE p.value = 'null'::jsonb
UNION ALL
-- Seasoning is blocked by the schema as well as by a missing number, and that is
-- a different kind of debt: filling in min_age_months alone will not make it work.
SELECT r.org_id,
       r.rule_key,
       'tradelines.opened_at',
       'no column anywhere in the schema records when a tradeline was opened',
       'BLOCKED — schema, not configuration',
       'seasoning can only be measured for lines whose opened date the caller supplies'
  FROM upsell_trigger_rules r
 WHERE r.rule_key = 'seasoned_tradelines';

COMMENT ON TABLE upsell_trigger_rules IS
  'The conditions that raise a Finance OS alert. Thresholds are rows here, never constants in code (013_commission_rules.sql). Every value ships NULL and every rule ships inactive because no source for any of them exists in this repository — see v_upsell_config_gaps.';
