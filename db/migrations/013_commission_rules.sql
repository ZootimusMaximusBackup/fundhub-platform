-- 013 — COMMISSION RULES. Every rate is a row. There are no rates in code.
--
-- Two kinds of commission, both first-class:
--   front_end — on the sale itself. Closer earns on deposit collected.
--   back_end  — on funding, earned at round.funded, weeks or months later.
--
-- Scope is per product, per role, overridable per person. Effective dates mean
-- changing a rate never rewrites history: you close the current row and open a
-- new one. There is no UPDATE path that can restate a past commission.
--
-- Two stacking modes:
--   base  — COMPETE. Exactly one base rule wins per (person, basis), most
--           specific scope first. This is the person's commission.
--   bonus — STACK. Every matching bonus rule adds on top of the base.
--           This is Sarah's bonus structuring (spec §14).
--
-- NEEDS DARWIN'S REVIEW: the bonus stacking mechanism is new and unvalidated
-- against a real comp plan. See commission-model-open-questions.md.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for the no-overlap exclusion below

-- ---------------------------------------------------------------------------
-- commission_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- The label on the admin screen. Make it read like a sentence:
  -- "Closer — Card Stacking deposit", "Advisor — 0.25% of funded".
  name          text NOT NULL,
  description   text,

  basis         text NOT NULL CHECK (basis IN ('front_end', 'back_end')),

  -- base competes, bonus stacks.
  stacking      text NOT NULL DEFAULT 'base' CHECK (stacking IN ('base', 'bonus')),

  -- SCOPE. Any level left NULL means "applies to all".
  --   product_id NULL = every product
  --   role       NULL = every role
  --   staff_id   NULL = everyone  (set it to override one person)
  product_id    uuid REFERENCES products(id),
  role          text,                                -- staff_roles.key
  staff_id      uuid REFERENCES staff(id),

  -- COMPUTATION
  --   percent        — percent of the amount_basis. 0.25 means 0.25%.
  --   flat           — a fixed amount, once, regardless of size
  --   flat_per_unit  — flat_amount for every whole per_unit_amount of the base
  --                    (e.g. $500 per $3,000 collected). Kept available for
  --                    products that need it; NOT how the card stacking closer
  --                    is paid — that is a plain `flat` (CHRIS PROVISIONAL #1).
  --   tiered         — see commission_rule_tiers below
  calc_method   text NOT NULL
    CHECK (calc_method IN ('percent', 'flat', 'flat_per_unit', 'tiered')),

  percent         numeric(9,5) CHECK (percent IS NULL OR percent >= 0),
  flat_amount     numeric(14,2) CHECK (flat_amount IS NULL OR flat_amount >= 0),
  per_unit_amount numeric(14,2) CHECK (per_unit_amount IS NULL OR per_unit_amount > 0),

  -- tiered only: how a tier applies once the base lands in it.
  --   marginal — THE DEFAULT. Each bracket pays its own rate on its own slice
  --              (tax-bracket style): only the dollars above a bracket pay the
  --              higher rate. Requires percent on every tier.
  --   whole    — the whole base is paid at the matching tier's rate. Use this
  --              for a ladder of flat amounts, which marginal cannot express.
  --
  -- Marginal is the default because a whole-ladder creates a cliff — funding one
  -- dollar more jumps the ENTIRE commission to the higher rate, which is both
  -- expensive and an incentive to game the funded number.
  tier_mode     text NOT NULL DEFAULT 'marginal' CHECK (tier_mode IN ('whole', 'marginal')),

  -- WHAT THE RATE APPLIES TO.
  --
  -- This is the one enum on this table that is NOT admin-editable, because each
  -- value is a formula the calculator implements. Adding a value here is a code
  -- change. Everything else on this table — names, rates, scopes, dates — is a
  -- row a person edits. Stated plainly so nobody discovers it the hard way.
  --
  --   front_end:
  --     deposit_collected — money in the door, kind='deposit'.  <-- the default
  --     cash_collected    — every non-refund payment to date
  --     sale_price        — the agreed price at signature, paid or not
  --   back_end:
  --     amount_funded     — funding_rounds.funded_amount for THAT round
  --     amount_approved   — funding_rounds.approved_amount for that round
  --     success_fee       — the client-facing fee we charge on that round
  amount_basis  text NOT NULL
    CHECK (amount_basis IN ('sale_price', 'deposit_collected', 'cash_collected',
                            'amount_funded', 'amount_approved', 'success_fee')),

  -- Guardrails. Applied after the rate, before the split.
  min_amount    numeric(14,2) CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount    numeric(14,2) CHECK (max_amount IS NULL OR max_amount >= 0),

  -- EFFECTIVE DATING. This is how history stays intact.
  -- To change a rate: set effective_to = now() on the live row, INSERT a new row
  -- with effective_from = now(). Never UPDATE the rate itself.
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,          -- NULL = still in effect

  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- The method must actually carry the numbers it needs. Catches a half-filled
  -- admin form before it becomes a wrong paycheque.
  CONSTRAINT commission_rules_method_complete CHECK (
    (calc_method = 'percent'       AND percent IS NOT NULL) OR
    (calc_method = 'flat'          AND flat_amount IS NOT NULL) OR
    (calc_method = 'flat_per_unit' AND flat_amount IS NOT NULL AND per_unit_amount IS NOT NULL) OR
    (calc_method = 'tiered')
  ),

  -- front end cannot be paid on a funding number, and vice versa.
  CONSTRAINT commission_rules_basis_coherent CHECK (
    (basis = 'front_end' AND amount_basis IN ('sale_price', 'deposit_collected', 'cash_collected')) OR
    (basis = 'back_end'  AND amount_basis IN ('amount_funded', 'amount_approved', 'success_fee'))
  ),

  CONSTRAINT commission_rules_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),

  CONSTRAINT commission_rules_amount_band CHECK (
    min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount
  )
);

CREATE INDEX IF NOT EXISTS commission_rules_lookup_idx
  ON commission_rules (org_id, basis, stacking, effective_from DESC)
  WHERE active;
CREATE INDEX IF NOT EXISTS commission_rules_product_idx ON commission_rules (product_id);
CREATE INDEX IF NOT EXISTS commission_rules_staff_idx   ON commission_rules (staff_id);

-- ---------------------------------------------------------------------------
-- No two live BASE rules may cover the same scope at the same time.
--
-- This is the constraint that makes the admin screen safe for a non-developer:
-- Postgres physically refuses to create an ambiguous rate. Chris cannot
-- accidentally end up with two overlapping closer rates and a payout report
-- nobody can explain.
--
-- COALESCE sentinels are needed because NULL never conflicts with NULL under an
-- exclusion constraint, and NULL here means "all", which very much does conflict.
--
-- bonus rules are deliberately exempt — stacking multiple bonuses is the point.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_no_overlap'
  ) THEN
    ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_no_overlap
      EXCLUDE USING gist (
        org_id WITH =,
        basis  WITH =,
        (COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        (COALESCE(lower(role), '*')) WITH =,
        (COALESCE(staff_id,   '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      ) WHERE (active AND stacking = 'base');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- commission_rule_tiers — graduated rates.
--
-- Built now rather than retrofitted. A rule with calc_method='tiered' reads its
-- brackets from here; every other method ignores this table entirely.
--
-- Brackets are on the AMOUNT BASIS, not on the commission. So "rounds funding
-- over $50,000 pay 0.5%" is min_amount 50000, max_amount NULL, percent 0.5.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rule_tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  rule_id         uuid NOT NULL REFERENCES commission_rules(id) ON DELETE CASCADE,

  -- [min_amount, max_amount) — lower bound inclusive, upper exclusive.
  -- max_amount NULL = the top bracket, no ceiling.
  min_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  max_amount      numeric(14,2) CHECK (max_amount IS NULL OR max_amount > 0),

  percent         numeric(9,5) CHECK (percent IS NULL OR percent >= 0),
  flat_amount     numeric(14,2) CHECK (flat_amount IS NULL OR flat_amount >= 0),
  per_unit_amount numeric(14,2) CHECK (per_unit_amount IS NULL OR per_unit_amount > 0),

  sort_order      integer NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commission_rule_tiers_band CHECK (
    max_amount IS NULL OR max_amount > min_amount
  ),
  CONSTRAINT commission_rule_tiers_pays_something CHECK (
    percent IS NOT NULL OR flat_amount IS NOT NULL OR per_unit_amount IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS commission_rule_tiers_rule_idx
  ON commission_rule_tiers (rule_id, min_amount);

-- Brackets within one rule may not overlap — same reasoning as the rule
-- exclusion above: an admin screen must not be able to build an ambiguous ladder.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_rule_tiers_no_overlap'
  ) THEN
    ALTER TABLE commission_rule_tiers ADD CONSTRAINT commission_rule_tiers_no_overlap
      EXCLUDE USING gist (
        rule_id WITH =,
        numrange(min_amount, max_amount, '[)') WITH &&
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- NO COMMISSION RATES ARE SEEDED BY THIS MIGRATION.
--
-- Spec §14 has numbers ($500 flat per $3K deposit, 0.25% of funded, $6.25/hr)
-- but they are a sentence in a spec, not a signed comp plan, and Chris's answers
-- are recorded as PROVISIONAL pending Darwin. Rates go in through the admin
-- screen, or through a follow-up seed once they are confirmed.
--
-- A worked example of what the confirmed rows would look like is in
-- src/commissions/commission-model-open-questions.md. It is deliberately not
-- executable SQL in this repo.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_commission_rules_updated ON commission_rules;
CREATE TRIGGER trg_commission_rules_updated BEFORE UPDATE ON commission_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_commission_rule_tiers_updated ON commission_rule_tiers;
CREATE TRIGGER trg_commission_rule_tiers_updated BEFORE UPDATE ON commission_rule_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
