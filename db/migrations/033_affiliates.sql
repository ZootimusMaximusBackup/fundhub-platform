-- 033 — AFFILIATE DATA MODEL. Current state, the attribution chain, and payouts.
--
-- The gap this closes (workflow-migration-table.md, AF-Series):
--   `affiliates` (001_init.sql) has id, org_id, name, status. That is all.
--   `affiliate_events` is a history log (kind: lead|status_change|payout), not
--   current state. AF-01, AF-03A, AF-03B, AF-04, AF-05, AF-07 and AF-08 are all
--   BLOCKED because there is nowhere to read or write tier, tracking id,
--   downline, or payout state.
--
-- 001_init.sql is never edited. Everything here is additive and re-runnable.
--
-- FOUR IDEAS HOLD THIS TOGETHER:
--
--   1. ATTRIBUTION IS STICKY AND THAT IS A DATABASE FACT.
--      First touch wins. One direct attribution per client, one downline
--      attribution per client, enforced by a unique index — a second write
--      cannot land. The columns that identify the attribution are then frozen
--      by trigger, so it cannot be re-pointed by an UPDATE either. Code that
--      forgets the rule is corrected by Postgres rather than trusted.
--
--   2. DOWNLINE IS AN EDGE, NOT A COUNTER.
--      `affiliates.recruited_by` is the truth. `direct_downline_count` is a
--      cached rollup maintained by trigger, and a BEFORE UPDATE guard rejects
--      any hand-written value that disagrees with the edges. The counter
--      cannot drift because the only value it will accept is the derived one.
--
--   3. SO IS THE MONEY.
--      The per-referral record is `affiliate_referrals.commission_due`, frozen
--      with a snapshot of the rule that produced it. What actually went out is
--      `affiliate_payout_lines`. `affiliates.balance_due` and `payout_status`
--      are rollups of those two, maintained by the same guarded-trigger pattern
--      and reconcilable at any time via v_affiliate_state_drift.
--
--   4. NO COMMISSION RATE IS INVENTED HERE.
--      The source marks affiliate commission as "(your calc / number field)" —
--      unspecified even in GHL. `affiliate_commission_rules` is the structure;
--      every rate is a row somebody enters, exactly as in 013_commission_rules.
--      This migration seeds none. With no rules configured, commission_due
--      stays NULL, balance stays zero, and nothing pays. That is deliberate.
--
-- Open questions — including one direct contradiction between the affiliate
-- wireframe and the first-touch rule this schema enforces — are in
-- src/affiliates/affiliate-model-open-questions.md. Read that before seeding
-- anything.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for the no-overlap exclusion below

-- ===========================================================================
-- A. affiliates — the missing current state
-- ===========================================================================

-- HOW A REFERRAL IS ATTRIBUTED. The code on the link (?ref=...). Unique per org,
-- case-insensitively, because nobody types a referral code in the case it was
-- issued in.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tracking_id text;

-- WHERE THEY ARE IN THE PROGRAMME.
--   tier1 — every affiliate starts here.
--   tier2 — unlocked by a paid outcome (AF-03A) or a first recruit (AF-03B).
-- Stored lowercase to match the rest of the platform's enums; the wireframe's
-- "Tier1/Tier2" is a display concern.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tier_level text NOT NULL DEFAULT 'tier1';
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tier2_unlocked_at timestamptz;

-- THE DOWNLINE EDGE. Who recruited this affiliate. NULL = recruited by nobody.
-- This single column is what makes the downline derivable; see section E.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS recruited_by uuid REFERENCES affiliates(id);
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS recruited_at timestamptz;

-- DERIVED, NOT MAINTAINED BY HAND. See the guard in section E — writing a wrong
-- number here raises rather than drifts.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS direct_downline_count integer NOT NULL DEFAULT 0;

-- PAYOUT STATE. Both derived rollups; both guarded. See section E.
--   balance_due   — accrued commission not yet settled by a paid payout run.
--   payout_status — none | pending | processing | paid
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS balance_due numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'none';

-- THE HOLD. The affiliate wireframe holds payouts until the partner license is
-- signed ("payouts accrue but do not release until it is signed"), so this is a
-- real column with real teeth: section D refuses to move a payout run to
-- processing or paid while it is NULL. Not a UI flag.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS partner_license_signed_at timestamptz;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS partner_license_ref text;  -- e-sign envelope / document id

-- Payout destination. Deliberately a reference and a label, never account
-- numbers — banking details are not this platform's to hold.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_method text;      -- ach | check | manual
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_method_ref text;  -- "ACH ·••4471", provider token

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_tier_level_chk') THEN
    ALTER TABLE affiliates ADD CONSTRAINT affiliates_tier_level_chk
      CHECK (tier_level IN ('tier1', 'tier2'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_payout_status_chk') THEN
    ALTER TABLE affiliates ADD CONSTRAINT affiliates_payout_status_chk
      CHECK (payout_status IN ('none', 'pending', 'processing', 'paid'));
  END IF;

  -- tier2 without an unlock date (or the reverse) is a half-applied unlock, and
  -- AF-03A/03B both read the date. Keep them in step.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_tier2_coherent') THEN
    ALTER TABLE affiliates ADD CONSTRAINT affiliates_tier2_coherent
      CHECK ((tier_level = 'tier2') = (tier2_unlocked_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_no_self_recruit') THEN
    ALTER TABLE affiliates ADD CONSTRAINT affiliates_no_self_recruit
      CHECK (recruited_by IS NULL OR recruited_by <> id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tracking IDs. Same shape as employee_code / client_code in 012_attribution:
-- auto-assigned on insert, but only when the caller did not supply one, so an
-- import or a vanity code ("DKOWAL-000123", as the wireframe shows) is kept.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS affiliate_tracking_seq START 1;

CREATE OR REPLACE FUNCTION assign_affiliate_tracking_id() RETURNS trigger AS $$
BEGIN
  IF NEW.tracking_id IS NULL OR btrim(NEW.tracking_id) = '' THEN
    NEW.tracking_id := 'AFF-' || lpad(nextval('affiliate_tracking_seq')::text, 6, '0');
  ELSE
    NEW.tracking_id := btrim(NEW.tracking_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliates_tracking_id ON affiliates;
CREATE TRIGGER trg_affiliates_tracking_id
  BEFORE INSERT ON affiliates
  FOR EACH ROW EXECUTE FUNCTION assign_affiliate_tracking_id();

-- Backfill anyone already in the table. Idempotent: only touches NULL/blank.
UPDATE affiliates
   SET tracking_id = 'AFF-' || lpad(nextval('affiliate_tracking_seq')::text, 6, '0')
 WHERE tracking_id IS NULL OR btrim(tracking_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS affiliates_org_tracking_uniq
  ON affiliates (org_id, upper(tracking_id)) WHERE tracking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliates_recruiter_idx ON affiliates (recruited_by);
CREATE INDEX IF NOT EXISTS affiliates_payable_idx
  ON affiliates (org_id, payout_status) WHERE balance_due > 0;

-- ---------------------------------------------------------------------------
-- The recruiter chain must stay a tree. A cycle (A recruited B recruited A)
-- would make any upward walk — commission roll-up, downline reporting — spin
-- forever. Cheapest possible place to catch it is the write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliates_recruiter_guard() RETURNS trigger AS $$
DECLARE cur uuid; depth integer := 0; recruiter_org uuid;
BEGIN
  IF NEW.recruited_by IS NULL THEN RETURN NEW; END IF;

  SELECT org_id INTO recruiter_org FROM affiliates WHERE id = NEW.recruited_by;
  IF recruiter_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'affiliate %: recruiter % belongs to a different org', NEW.id, NEW.recruited_by;
  END IF;

  cur := NEW.recruited_by;
  WHILE cur IS NOT NULL AND depth < 64 LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'affiliate %: recruiter chain is circular via %', NEW.id, NEW.recruited_by;
    END IF;
    SELECT recruited_by INTO cur FROM affiliates WHERE id = cur;
    depth := depth + 1;
  END LOOP;

  IF cur IS NOT NULL THEN
    RAISE EXCEPTION 'affiliate %: recruiter chain deeper than 64 — probably a cycle', NEW.id;
  END IF;

  IF NEW.recruited_at IS NULL THEN NEW.recruited_at := now(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliates_recruiter ON affiliates;
CREATE TRIGGER trg_affiliates_recruiter
  BEFORE INSERT OR UPDATE OF recruited_by ON affiliates
  FOR EACH ROW EXECUTE FUNCTION affiliates_recruiter_guard();

-- ===========================================================================
-- B. affiliate_commission_rules — every rate is a row. There are no rates here.
--
-- Same pattern as 013_commission_rules: scope, effective dating, and a
-- Postgres-level refusal to create two live rules covering the same scope.
-- Deliberately simpler than 013 — no base/bonus stacking, no tier ladders —
-- because nothing in the source suggests affiliates have either, and inventing
-- structure is as bad as inventing a number.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS affiliate_commission_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- Reads like a sentence on the admin screen: "Affiliate — direct referral,
  -- first paid product".
  name          text NOT NULL,
  description   text,

  -- SCOPE. NULL at any level means "applies to all".
  --   tier         NULL = both direct and downline credit
  --   product_id   NULL = every product
  --   affiliate_id NULL = every affiliate (set it to override one person)
  tier          text CHECK (tier IS NULL OR tier IN ('direct', 'downline')),
  product_id    uuid REFERENCES products(id),
  affiliate_id  uuid REFERENCES affiliates(id),

  calc_method   text NOT NULL CHECK (calc_method IN ('percent', 'flat')),
  percent       numeric(9,5) CHECK (percent IS NULL OR percent >= 0),   -- 12 means 12%
  flat_amount   numeric(14,2) CHECK (flat_amount IS NULL OR flat_amount >= 0),

  -- WHAT THE RATE APPLIES TO. Like 013's amount_basis, this enum is NOT
  -- admin-editable: each value is a formula the calculator implements. Adding
  -- one is a code change. Everything else on this table is a row a person edits.
  --   sale_price        — the agreed price on the converting sale
  --   deposit_collected — deposit actually paid on that sale
  --   cash_collected    — every non-refund payment on that sale to date
  --   first_payment     — the single first payment the referred client made
  amount_basis  text NOT NULL
    CHECK (amount_basis IN ('sale_price', 'deposit_collected', 'cash_collected', 'first_payment')),

  -- HOW OFTEN A REFERRED CLIENT PAYS OUT.
  --   first_paid_product — once, on the client's first qualifying purchase
  --   every_sale         — every qualifying purchase, forever
  -- Defaulted to first_paid_product because the affiliate wireframe states it
  -- ("Later purchases by the same client do not pay again"). That is a
  -- wireframe, not a signed partner agreement — see open question 3.
  scope_rule    text NOT NULL DEFAULT 'first_paid_product'
    CHECK (scope_rule IN ('first_paid_product', 'every_sale')),

  -- Guardrails, applied after the rate.
  min_amount    numeric(14,2) CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount    numeric(14,2) CHECK (max_amount IS NULL OR max_amount >= 0),

  -- EFFECTIVE DATING. To change a rate: close the live row, open a new one.
  -- Never UPDATE the rate itself — that would restate history.
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,          -- NULL = still in effect

  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT affiliate_commission_rules_method_complete CHECK (
    (calc_method = 'percent' AND percent     IS NOT NULL) OR
    (calc_method = 'flat'    AND flat_amount IS NOT NULL)
  ),
  CONSTRAINT affiliate_commission_rules_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT affiliate_commission_rules_amount_band CHECK (
    min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount
  )
);

CREATE INDEX IF NOT EXISTS affiliate_commission_rules_lookup_idx
  ON affiliate_commission_rules (org_id, effective_from DESC) WHERE active;
CREATE INDEX IF NOT EXISTS affiliate_commission_rules_affiliate_idx
  ON affiliate_commission_rules (affiliate_id);

-- No two live rules may cover the same scope at the same time. COALESCE
-- sentinels because NULL here means "all", which very much does conflict with
-- another "all" — and NULL never conflicts with NULL under an exclusion
-- constraint. Same reasoning as commission_rules_no_overlap in 013.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_commission_rules_no_overlap'
  ) THEN
    ALTER TABLE affiliate_commission_rules ADD CONSTRAINT affiliate_commission_rules_no_overlap
      EXCLUDE USING gist (
        org_id WITH =,
        (COALESCE(tier, '*')) WITH =,
        (COALESCE(product_id,   '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        (COALESCE(affiliate_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      ) WHERE (active);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- NO AFFILIATE COMMISSION RATE IS SEEDED BY THIS MIGRATION.
--
-- The GHL source marks "Funding/Repair Commission Amount" as
-- "(your calc / number field)" — unspecified at the source, same category as
-- the F-07 gap. The affiliate wireframe shows 12% of the first paid product
-- against a rule called "CR-05 v1"; that is sample data in a mockup, not a
-- signed partner agreement, and this migration does not promote it to a fact.
--
-- Until a rule row exists, the calculator returns no commission and
-- affiliate_referrals.commission_due stays NULL. Nothing accrues, nothing pays,
-- nothing is silently wrong. See src/affiliates/affiliate-model-open-questions.md.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- C. affiliate_referrals — the attribution chain
--
-- One row per (client, tier). This is the answer to "who gets credit for this
-- client", and it is written once, at first touch, and never again.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  affiliate_id  uuid NOT NULL REFERENCES affiliates(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- direct   — this affiliate's own referral (GHL's a1 / "Affiliate Tier1 Owner")
  -- downline — credit flowing up to the recruiter (a2 / "Affiliate Tier2 Owner")
  tier          text NOT NULL CHECK (tier IN ('direct', 'downline')),

  -- The code as it was used on the link. Snapshotted because a vanity code can
  -- be reissued, and a payout report from March must still explain itself.
  tracking_id_used text,

  -- FIRST TOUCH. The business time of the attributing event, not the write.
  attributed_at timestamptz NOT NULL DEFAULT now(),
  source        text,          -- clickfunnels | manual | import | af-02-backfill
  source_event  text,          -- entry.captured | diagnostic.paid | ...
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- CONVERSION. Set once, when the referred client first pays a qualifying
  -- product. converting_sale_id is the wireframe's "first paid product".
  converted_at        timestamptz,
  converting_sale_id  uuid REFERENCES sales(id),

  -- THE MONEY, as a record rather than a calculation (014's principle).
  -- NULL = not calculated: either not converted yet, or no rule was in force.
  -- basis_amount is what the rate applied to, kept so the number can be
  -- explained without re-deriving it from tables that have since moved on.
  commission_due  numeric(14,2) CHECK (commission_due IS NULL OR commission_due >= 0),
  basis_amount    numeric(14,2),
  currency        text NOT NULL DEFAULT 'USD',
  rule_id         uuid REFERENCES affiliate_commission_rules(id),
  rule_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,

  --   attributed — credited, client has not paid
  --   converted  — client paid; commission_due is set if a rule was in force
  --   paid       — settled by a paid payout run
  --   void       — disqualified or clawed back; excluded from balance
  status        text NOT NULL DEFAULT 'attributed'
    CHECK (status IN ('attributed', 'converted', 'paid', 'void')),
  void_reason   text,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT affiliate_referrals_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CONSTRAINT affiliate_referrals_converted_coherent CHECK (
    status IN ('attributed', 'void') OR converted_at IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- THE STICKY RULE, AS A DATABASE FACT.
--
-- One direct owner and one downline owner per client, forever. First INSERT
-- wins; the second one hits this index and fails. Writers use
-- `ON CONFLICT (client_id, tier) DO NOTHING`, which makes the write both
-- idempotent on replay and incapable of stealing an existing attribution —
-- the same statement does both jobs.
--
-- This is the constraint that means a bug in a handler, a replayed webhook, or
-- a second affiliate's link cannot silently move somebody's commission.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_referrals_client_tier_uniq
  ON affiliate_referrals (client_id, tier);

CREATE INDEX IF NOT EXISTS affiliate_referrals_affiliate_idx
  ON affiliate_referrals (affiliate_id, status, attributed_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_referrals_payable_idx
  ON affiliate_referrals (org_id, affiliate_id)
  WHERE status = 'converted' AND commission_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_referrals_sale_idx ON affiliate_referrals (converting_sale_id);

-- The unique index stops a second INSERT. This stops an UPDATE doing the same
-- thing by the back door: who is credited, for which client, at what tier, from
-- which code, at what moment — none of it is editable after the fact.
CREATE OR REPLACE FUNCTION affiliate_referrals_sticky() RETURNS trigger AS $$
BEGIN
  IF NEW.client_id        IS DISTINCT FROM OLD.client_id
  OR NEW.affiliate_id     IS DISTINCT FROM OLD.affiliate_id
  OR NEW.tier             IS DISTINCT FROM OLD.tier
  OR NEW.attributed_at    IS DISTINCT FROM OLD.attributed_at
  OR NEW.tracking_id_used IS DISTINCT FROM OLD.tracking_id_used THEN
    RAISE EXCEPTION
      'affiliate_referrals %: attribution is first-touch and immutable — void this row, do not re-point it',
      OLD.id;
  END IF;

  -- Conversion happens once. A second qualifying sale does not reopen it.
  IF OLD.converted_at IS NOT NULL AND NEW.converted_at IS DISTINCT FROM OLD.converted_at THEN
    RAISE EXCEPTION 'affiliate_referrals %: converted_at is write-once (was %)', OLD.id, OLD.converted_at;
  END IF;

  -- Once settled, the amount is frozen. Money that has to come back is a
  -- clawback line on a payout run, never an edit (014's rule, same reasoning).
  IF OLD.status = 'paid' THEN
    IF NEW.commission_due IS DISTINCT FROM OLD.commission_due
    OR NEW.basis_amount   IS DISTINCT FROM OLD.basis_amount
    OR NEW.rule_snapshot  IS DISTINCT FROM OLD.rule_snapshot THEN
      RAISE EXCEPTION
        'affiliate_referrals %: commission is frozen once paid — post a clawback line instead',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_referrals_sticky ON affiliate_referrals;
CREATE TRIGGER trg_affiliate_referrals_sticky
  BEFORE UPDATE ON affiliate_referrals
  FOR EACH ROW EXECUTE FUNCTION affiliate_referrals_sticky();

-- Deleting a referral would free its (client_id, tier) slot and let a different
-- affiliate be attributed — stickiness with a trapdoor is not stickiness. Void
-- it instead. The client CASCADE path is deliberately left open: if a client is
-- erased, their attribution goes with them.
CREATE OR REPLACE FUNCTION affiliate_referrals_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'affiliate_referrals %: attribution rows are not deletable — set status = ''void'' with a reason',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_referrals_no_delete ON affiliate_referrals;
CREATE TRIGGER trg_affiliate_referrals_no_delete
  BEFORE DELETE ON affiliate_referrals
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)     -- lets the clients CASCADE through, blocks hand deletes
  EXECUTE FUNCTION affiliate_referrals_no_delete();

-- ===========================================================================
-- D. affiliate_payouts + affiliate_payout_lines — payout runs
--
-- A run is a period, an amount, and a set of line items pointing back at the
-- referrals it settles. The lines are what make a run explainable: every dollar
-- traces to a referral, which traces to a client and a rule snapshot.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  affiliate_id  uuid NOT NULL REFERENCES affiliates(id),

  -- The period the run covers. Half-open [start, end) so consecutive runs
  -- cannot both claim the same instant.
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,

  -- Sum of the lines. Maintained by trigger; a hand-written total that does not
  -- match its own line items is rejected (section E).
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',

  --   pending    — built and payable, waiting for the run
  --   held       — blocked. In practice: partner license unsigned
  --   processing — handed to the payment rail, money in flight
  --   paid       — settled
  --   void       — cancelled; never became money
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'held', 'processing', 'paid', 'void')),
  hold_reason   text,
  void_reason   text,

  method        text,     -- ach | check | manual
  external_ref  text,     -- ACH batch id, cheque number, provider reference
  initiated_at  timestamptz,
  paid_at       timestamptz,

  -- Replay safety (Rule 9). A re-run of the Friday job derives the same key and
  -- lands on the unique index instead of paying somebody twice.
  idempotency_key text,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT affiliate_payouts_period CHECK (period_end > period_start),
  CONSTRAINT affiliate_payouts_hold_reason CHECK (status <> 'held' OR hold_reason IS NOT NULL),
  CONSTRAINT affiliate_payouts_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CONSTRAINT affiliate_payouts_paid_at      CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payouts_idem_uniq
  ON affiliate_payouts (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_payouts_affiliate_idx
  ON affiliate_payouts (affiliate_id, status, period_end DESC);
CREATE INDEX IF NOT EXISTS affiliate_payouts_open_idx
  ON affiliate_payouts (org_id, status) WHERE status IN ('pending', 'held', 'processing');

CREATE TABLE IF NOT EXISTS affiliate_payout_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  payout_id     uuid NOT NULL REFERENCES affiliate_payouts(id) ON DELETE CASCADE,

  -- Back to the referral. This is the whole point of the table.
  referral_id   uuid NOT NULL REFERENCES affiliate_referrals(id),

  --   commission — settles a referral's commission_due. Positive.
  --   clawback   — reverses one already paid (the wireframe's 30-day refund
  --                rule). Negative, and never an edit to the original.
  --   adjustment — a human correction, either sign, always with a note.
  kind          text NOT NULL DEFAULT 'commission'
    CHECK (kind IN ('commission', 'clawback', 'adjustment')),

  amount        numeric(14,2) NOT NULL,

  -- Snapshots, so a payout statement reads standalone (014's pattern).
  client_id     uuid REFERENCES clients(id),
  client_code   text,
  basis_amount  numeric(14,2),
  rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT affiliate_payout_lines_sign CHECK (
    (kind = 'commission' AND amount >= 0) OR
    (kind = 'clawback'   AND amount <= 0) OR
    (kind = 'adjustment')
  ),
  CONSTRAINT affiliate_payout_lines_adjustment_note CHECK (kind <> 'adjustment' OR notes IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_lines_uniq
  ON affiliate_payout_lines (payout_id, referral_id, kind);

-- A referral's commission is settled exactly once, across all runs, ever. This
-- is the double-pay guard: two overlapping runs that both pick up the same
-- converted referral cannot both carry it. Clawbacks and adjustments are exempt
-- — being able to post more than one of those is the point.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_lines_commission_once
  ON affiliate_payout_lines (referral_id) WHERE kind = 'commission';

CREATE INDEX IF NOT EXISTS affiliate_payout_lines_payout_idx ON affiliate_payout_lines (payout_id);
CREATE INDEX IF NOT EXISTS affiliate_payout_lines_client_idx ON affiliate_payout_lines (client_id);

-- ---------------------------------------------------------------------------
-- Payout run lifecycle. Forward only, with one gate that matters.
--
-- THE LICENSE HOLD IS ENFORCED HERE, not in a screen. An affiliate with no
-- partner_license_signed_at cannot have a run moved to processing or paid. The
-- balance keeps accruing — that is what the wireframe promises — but it does
-- not leave the building.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate_payouts_guard() RETURNS trigger AS $$
DECLARE signed_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    IF NEW.amount       IS DISTINCT FROM OLD.amount
    OR NEW.affiliate_id IS DISTINCT FROM OLD.affiliate_id
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end   IS DISTINCT FROM OLD.period_end
    OR NEW.paid_at      IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION
        'affiliate_payouts %: a paid run is frozen — post a clawback or adjustment line on a new run',
        OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending'    AND NEW.status IN ('held', 'processing', 'void')) OR
      (OLD.status = 'held'       AND NEW.status IN ('pending', 'processing', 'void')) OR
      (OLD.status = 'processing' AND NEW.status IN ('paid', 'pending', 'held', 'void'))
    ) THEN
      RAISE EXCEPTION 'affiliate_payouts %: illegal status transition % -> %',
        OLD.id, OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status IN ('processing', 'paid') THEN
    SELECT a.partner_license_signed_at INTO signed_at
      FROM affiliates a WHERE a.id = NEW.affiliate_id;
    IF signed_at IS NULL THEN
      RAISE EXCEPTION
        'affiliate_payouts %: affiliate % has not signed the partner license — payouts accrue but do not release',
        COALESCE(NEW.id::text, '(new)'), NEW.affiliate_id;
    END IF;
  END IF;

  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  IF NEW.status = 'processing' AND NEW.initiated_at IS NULL THEN NEW.initiated_at := now(); END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payouts_guard ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_guard
  BEFORE INSERT OR UPDATE ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION affiliate_payouts_guard();

-- Deleting a paid run would cascade its lines away, free the
-- affiliate_payout_lines_commission_once slot on every referral it settled, and
-- let the next run pay them all again. Money that went out stays on the record.
CREATE OR REPLACE FUNCTION affiliate_payouts_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION
      'affiliate_payouts %: a paid run cannot be deleted — its lines are what stops those referrals being paid twice',
      OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payouts_no_delete ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_no_delete
  BEFORE DELETE ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION affiliate_payouts_no_delete();

-- Lines on a paid run are the payout statement. They do not change afterwards.
CREATE OR REPLACE FUNCTION affiliate_payout_lines_guard() RETURNS trigger AS $$
DECLARE parent_status text; row_id uuid; parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_id := OLD.id; parent_id := OLD.payout_id;
  ELSE
    row_id := NEW.id; parent_id := NEW.payout_id;
  END IF;

  SELECT status INTO parent_status FROM affiliate_payouts WHERE id = parent_id;

  IF parent_status = 'paid' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'affiliate_payout_lines: cannot add a line to a paid run — open a new run';
    END IF;
    RAISE EXCEPTION
      'affiliate_payout_lines %: the run is paid — its lines are the statement and cannot be changed',
      row_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payout_lines_guard ON affiliate_payout_lines;
CREATE TRIGGER trg_affiliate_payout_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON affiliate_payout_lines
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION affiliate_payout_lines_guard();

-- The run total is the sum of its lines. Not a number anyone types.
CREATE OR REPLACE FUNCTION affiliate_payouts_sync_amount(target uuid) RETURNS void AS $$
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  UPDATE affiliate_payouts p
     SET amount = COALESCE((SELECT SUM(l.amount) FROM affiliate_payout_lines l
                             WHERE l.payout_id = p.id), 0)
   WHERE p.id = target
     AND p.amount IS DISTINCT FROM
         COALESCE((SELECT SUM(l.amount) FROM affiliate_payout_lines l
                    WHERE l.payout_id = p.id), 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION affiliate_payout_lines_after() RETURNS trigger AS $$
DECLARE parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN parent_id := OLD.payout_id; ELSE parent_id := NEW.payout_id; END IF;
  PERFORM affiliate_payouts_sync_amount(parent_id);
  PERFORM affiliates_sync_payout_state(
    (SELECT affiliate_id FROM affiliate_payouts WHERE id = parent_id));

  -- An UPDATE can move a line between runs; the run it left needs re-totalling.
  IF TG_OP = 'UPDATE' AND OLD.payout_id IS DISTINCT FROM NEW.payout_id THEN
    PERFORM affiliate_payouts_sync_amount(OLD.payout_id);
    PERFORM affiliates_sync_payout_state(
      (SELECT affiliate_id FROM affiliate_payouts WHERE id = OLD.payout_id));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ===========================================================================
-- E. The derived columns, and why they cannot drift
--
-- affiliates.direct_downline_count, balance_due and payout_status are rollups
-- of tables elsewhere in this file. Each is maintained by an AFTER trigger on
-- the table it summarises, and a BEFORE UPDATE guard on affiliates rejects any
-- value that disagrees with the source. The only writable value is the true
-- one, so "the counter drifted" is not a failure mode this schema has.
-- ===========================================================================

-- One definition of the payout rollup, used by both the trigger and the view
-- below — so there is no second copy of the formula to fall out of step.
CREATE OR REPLACE FUNCTION affiliate_derived_state(p_affiliate uuid)
RETURNS TABLE (balance_due numeric, payout_status text) AS $$
  WITH accrued AS (
    SELECT COALESCE(SUM(r.commission_due), 0) AS amt
      FROM affiliate_referrals r
     WHERE r.affiliate_id = p_affiliate
       AND r.status <> 'void'
       AND r.commission_due IS NOT NULL
  ),
  settled AS (
    SELECT COALESCE(SUM(l.amount), 0) AS amt
      FROM affiliate_payout_lines l
      JOIN affiliate_payouts p ON p.id = l.payout_id
     WHERE p.affiliate_id = p_affiliate
       AND p.status = 'paid'
  ),
  runs AS (
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'processing') AS in_flight,
      COUNT(*) FILTER (WHERE p.status = 'paid')       AS ever_paid
      FROM affiliate_payouts p
     WHERE p.affiliate_id = p_affiliate
  )
  SELECT
    ROUND(a.amt - s.amt, 2),
    CASE
      WHEN r.in_flight > 0        THEN 'processing'
      WHEN (a.amt - s.amt) > 0    THEN 'pending'
      WHEN r.ever_paid > 0        THEN 'paid'
      ELSE 'none'
    END
  FROM accrued a, settled s, runs r;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION affiliates_sync_payout_state(target uuid) RETURNS void AS $$
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  UPDATE affiliates a
     SET balance_due   = d.balance_due,
         payout_status = d.payout_status
    FROM affiliate_derived_state(target) d
   WHERE a.id = target
     AND (a.balance_due IS DISTINCT FROM d.balance_due
       OR a.payout_status IS DISTINCT FROM d.payout_status);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION affiliates_sync_downline(target uuid) RETURNS void AS $$
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  UPDATE affiliates a
     SET direct_downline_count = (SELECT COUNT(*) FROM affiliates d WHERE d.recruited_by = a.id)
   WHERE a.id = target
     AND a.direct_downline_count IS DISTINCT FROM
         (SELECT COUNT(*) FROM affiliates d WHERE d.recruited_by = a.id);
END;
$$ LANGUAGE plpgsql;

-- The guard. It accepts exactly one value for each derived column: the derived
-- one. The sync functions above always write that, so they pass; a hand-written
-- number raises with the correct value in the message.
CREATE OR REPLACE FUNCTION affiliates_derived_guard() RETURNS trigger AS $$
DECLARE derived_count integer; derived record;
BEGIN
  IF NEW.direct_downline_count IS DISTINCT FROM OLD.direct_downline_count THEN
    SELECT COUNT(*) INTO derived_count FROM affiliates d WHERE d.recruited_by = NEW.id;
    IF NEW.direct_downline_count <> derived_count THEN
      RAISE EXCEPTION
        'affiliates %: direct_downline_count is derived from recruited_by (currently %) — recruit or reassign, do not set it',
        NEW.id, derived_count;
    END IF;
  END IF;

  IF NEW.balance_due   IS DISTINCT FROM OLD.balance_due
  OR NEW.payout_status IS DISTINCT FROM OLD.payout_status THEN
    SELECT * INTO derived FROM affiliate_derived_state(NEW.id);
    IF NEW.balance_due <> derived.balance_due OR NEW.payout_status <> derived.payout_status THEN
      RAISE EXCEPTION
        'affiliates %: balance_due/payout_status are derived from referrals and payout runs (currently %, %) — write those, not this',
        NEW.id, derived.balance_due, derived.payout_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliates_derived_guard ON affiliates;
CREATE TRIGGER trg_affiliates_derived_guard
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION affiliates_derived_guard();

-- Downline maintenance. `UPDATE OF recruited_by` means the counter-writing
-- UPDATE above cannot re-fire this trigger: it never names that column.
CREATE OR REPLACE FUNCTION affiliates_downline_after() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM affiliates_sync_downline(OLD.recruited_by); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM affiliates_sync_downline(NEW.recruited_by); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliates_downline ON affiliates;
CREATE TRIGGER trg_affiliates_downline
  AFTER INSERT OR DELETE OR UPDATE OF recruited_by ON affiliates
  FOR EACH ROW EXECUTE FUNCTION affiliates_downline_after();

CREATE OR REPLACE FUNCTION affiliate_referrals_after() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM affiliates_sync_payout_state(OLD.affiliate_id);
  ELSE
    PERFORM affiliates_sync_payout_state(NEW.affiliate_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_referrals_after ON affiliate_referrals;
CREATE TRIGGER trg_affiliate_referrals_after
  AFTER INSERT OR UPDATE OR DELETE ON affiliate_referrals
  FOR EACH ROW EXECUTE FUNCTION affiliate_referrals_after();

DROP TRIGGER IF EXISTS trg_affiliate_payout_lines_after ON affiliate_payout_lines;
CREATE TRIGGER trg_affiliate_payout_lines_after
  AFTER INSERT OR UPDATE OR DELETE ON affiliate_payout_lines
  FOR EACH ROW EXECUTE FUNCTION affiliate_payout_lines_after();

CREATE OR REPLACE FUNCTION affiliate_payouts_after() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM affiliates_sync_payout_state(OLD.affiliate_id);
  ELSE
    PERFORM affiliates_sync_payout_state(NEW.affiliate_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payouts_after ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_after
  AFTER INSERT OR UPDATE OR DELETE ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION affiliate_payouts_after();

-- Backfill the rollups for anything already in the table. Idempotent — the sync
-- functions only write when the stored value disagrees.
DO $$
DECLARE a uuid;
BEGIN
  FOR a IN SELECT id FROM affiliates LOOP
    PERFORM affiliates_sync_downline(a);
    PERFORM affiliates_sync_payout_state(a);
  END LOOP;
END $$;

-- ===========================================================================
-- F. Views — what the affiliate wireframe reads
-- ===========================================================================

-- Current state of one affiliate, everything on one row.
CREATE OR REPLACE VIEW v_affiliate_state AS
SELECT
  a.id,
  a.org_id,
  a.name,
  a.status,
  a.tracking_id,
  a.tier_level,
  a.activated_at,
  a.tier2_unlocked_at,
  a.recruited_by,
  rec.tracking_id                         AS recruiter_tracking_id,
  a.direct_downline_count,
  a.balance_due,
  a.payout_status,
  a.partner_license_signed_at,
  -- The wireframe's banner condition, computed once, here.
  (a.partner_license_signed_at IS NULL)   AS payouts_held,
  COALESCE(r.referred_count, 0)           AS referred_count,
  COALESCE(r.converted_count, 0)          AS converted_count,
  COALESCE(r.direct_count, 0)             AS direct_referral_count,
  COALESCE(r.downline_count, 0)           AS downline_referral_count,
  COALESCE(p.lifetime_paid, 0)            AS lifetime_paid
FROM affiliates a
LEFT JOIN affiliates rec ON rec.id = a.recruited_by
LEFT JOIN LATERAL (
  SELECT COUNT(*)                                                   AS referred_count,
         COUNT(*) FILTER (WHERE converted_at IS NOT NULL)           AS converted_count,
         COUNT(*) FILTER (WHERE tier = 'direct')                    AS direct_count,
         COUNT(*) FILTER (WHERE tier = 'downline')                  AS downline_count
    FROM affiliate_referrals x
   WHERE x.affiliate_id = a.id AND x.status <> 'void'
) r ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS lifetime_paid
    FROM affiliate_payouts y
   WHERE y.affiliate_id = a.id AND y.status = 'paid'
) p ON true;

-- The downline, one level. Recursive roll-up is deliberately not built: nothing
-- in the source describes commission flowing past tier2.
CREATE OR REPLACE VIEW v_affiliate_downline AS
SELECT
  rec.id            AS recruiter_id,
  rec.org_id,
  rec.tracking_id   AS recruiter_tracking_id,
  d.id              AS affiliate_id,
  d.tracking_id,
  d.name,
  d.tier_level,
  d.activated_at,
  d.recruited_at
FROM affiliates rec
JOIN affiliates d ON d.recruited_by = rec.id;

-- THE CANARY. Should always be empty. If it is not, a trigger was dropped or a
-- migration was applied out of order — do not reconcile by hand, find out why.
CREATE OR REPLACE VIEW v_affiliate_state_drift AS
SELECT
  a.id,
  a.org_id,
  a.tracking_id,
  a.direct_downline_count                            AS stored_downline_count,
  (SELECT COUNT(*) FROM affiliates d WHERE d.recruited_by = a.id) AS derived_downline_count,
  a.balance_due                                      AS stored_balance_due,
  s.balance_due                                      AS derived_balance_due,
  a.payout_status                                    AS stored_payout_status,
  s.payout_status                                    AS derived_payout_status
FROM affiliates a
CROSS JOIN LATERAL affiliate_derived_state(a.id) s
WHERE a.balance_due   IS DISTINCT FROM s.balance_due
   OR a.payout_status IS DISTINCT FROM s.payout_status
   OR a.direct_downline_count IS DISTINCT FROM
      (SELECT COUNT(*) FROM affiliates d WHERE d.recruited_by = a.id);

-- ===========================================================================
-- G. Backfill from AF-02's writes
--
-- AF-02 (src/workflows/af-02-referral-ownership-capture.mjs) already captures
-- first-touch ownership onto clients.custom_fields as affiliate_tier1_owner /
-- affiliate_tier2_owner. That file belongs to another session and is not edited
-- here; this moves what it has already written into the structured model.
--
-- Matches on tracking_id, case-insensitively. It is a no-op on a database whose
-- affiliates all carry auto-assigned AFF-nnnnnn codes and whose custom_fields
-- carry legacy GHL codes — which is the expected state until real codes are
-- imported. ON CONFLICT DO NOTHING makes it safe to re-run and, more
-- importantly, makes it incapable of overwriting an attribution that already
-- exists. Same statement shape the handlers use.
-- ===========================================================================
INSERT INTO affiliate_referrals (org_id, affiliate_id, client_id, tier, tracking_id_used,
                                 attributed_at, source, detail)
SELECT c.org_id, a.id, c.id, 'direct', c.custom_fields->>'affiliate_tier1_owner',
       COALESCE((c.custom_fields->>'first_touch_date')::timestamptz, c.created_at),
       'af-02-backfill',
       jsonb_build_object('backfilled_from', 'clients.custom_fields.affiliate_tier1_owner')
  FROM clients c
  JOIN affiliates a
    ON a.org_id = c.org_id
   AND upper(a.tracking_id) = upper(c.custom_fields->>'affiliate_tier1_owner')
 WHERE NULLIF(btrim(c.custom_fields->>'affiliate_tier1_owner'), '') IS NOT NULL
ON CONFLICT (client_id, tier) DO NOTHING;

INSERT INTO affiliate_referrals (org_id, affiliate_id, client_id, tier, tracking_id_used,
                                 attributed_at, source, detail)
SELECT c.org_id, a.id, c.id, 'downline', c.custom_fields->>'affiliate_tier2_owner',
       COALESCE((c.custom_fields->>'first_touch_date')::timestamptz, c.created_at),
       'af-02-backfill',
       jsonb_build_object('backfilled_from', 'clients.custom_fields.affiliate_tier2_owner')
  FROM clients c
  JOIN affiliates a
    ON a.org_id = c.org_id
   AND upper(a.tracking_id) = upper(c.custom_fields->>'affiliate_tier2_owner')
 WHERE NULLIF(btrim(c.custom_fields->>'affiliate_tier2_owner'), '') IS NOT NULL
ON CONFLICT (client_id, tier) DO NOTHING;

-- ===========================================================================
-- H. updated_at
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_affiliate_commission_rules_updated ON affiliate_commission_rules;
CREATE TRIGGER trg_affiliate_commission_rules_updated BEFORE UPDATE ON affiliate_commission_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_referrals_updated ON affiliate_referrals;
CREATE TRIGGER trg_affiliate_referrals_updated BEFORE UPDATE ON affiliate_referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_payouts_updated ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_updated BEFORE UPDATE ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_affiliate_payout_lines_updated ON affiliate_payout_lines;
CREATE TRIGGER trg_affiliate_payout_lines_updated BEFORE UPDATE ON affiliate_payout_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
