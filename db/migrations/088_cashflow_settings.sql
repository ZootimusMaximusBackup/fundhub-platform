-- 088_cashflow_settings.sql — give the three cash-flow thresholds a home, and
-- fill them in so the model can give a complete answer.
--
-- WHY THIS FILE EXISTS. 087 and src/banking/cashflow.mjs were built under the
-- instruction "thresholds are rows, not constants — if there is no row for it,
-- that absence is the finding: report it, do not pick a number." They honoured
-- that exactly: the model holds no operator number, takes them as arguments, and
-- reports each missing one by name in `thresholdGaps`. It then reported the
-- finding — THERE WAS NOWHERE TO PUT THEM. No cashflow_settings table, no
-- banking_config table, no threshold column on orgs.
--
-- The owner has since said to figure it out. So this file does what
-- 052_config_defaults.sql did when the same thing happened to the creative and
-- hiring config: creates the home, fills it in ONE file so that reverting to
-- "unconfigured" is `git revert` of a single migration, and carries every value
-- with signed_off_at IS NULL so it is reported as provisional until a human
-- confirms it. A default that stops being visible is a default nobody
-- re-examines, so v_cashflow_config_gaps at the bottom reports these until they
-- are signed off, exactly as 052 does for the billing rates.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE THREE VALUES ARE NOT EQUALLY RISKY, AND THE HEADLINE IS WHICH DIRECTION
-- EACH ONE HURTS IN. Read this before changing any of them.
--
--   settlement_lead_days   ASYMMETRIC. Too high costs a little float. Too low
--                          costs a LATE PAYMENT — a fee and a credit-report mark
--                          on a product whose purpose is repairing credit. Erring
--                          high is the safe direction and this value errs high.
--
--   min_buffer_cents       ASYMMETRIC THE OTHER WAY, which is the trap. A bigger
--                          buffer sounds safer and is not: it makes the model
--                          REFUSE more payment dates, which pushes the payment
--                          later, which risks the same missed payment. Set to the
--                          zero the task already specifies. See section B.
--
--   confidence_floor       CANNOT AFFECT SAFETY AT ALL. Both sides of it land in
--                          the pessimistic track that paymentWindow() actually
--                          tests against. See section C.
-- ═══════════════════════════════════════════════════════════════════════════


-- ---------------------------------------------------------------------------
-- A. The table
-- ---------------------------------------------------------------------------
--
-- One row per org, typed columns rather than a key/value bag. Two of these
-- three are money and time, and a `value text` column that has to be parsed is
-- how a buffer of "1000" ends up meaning ten dollars in one caller and a
-- thousand in another. That is the same factor-of-100 hazard cashflow.mjs
-- refuses numeric strings over.
--
-- EVERY VALUE IS NULLABLE AND NULL MEANS UNSET, NOT ZERO. src/banking/settings.mjs
-- maps a NULL to an ABSENT key in the thresholds object, so the model goes back
-- to reporting it as a gap rather than reading it as a decision. Deleting a
-- value has to return the system to "nobody has decided this", not to "somebody
-- decided zero".
--
-- Each value carries its own signed_off_at/by, because each is a separate
-- decision. A single row-level flag would let signing off on the settlement lead
-- silently bless a buffer nobody looked at.

CREATE TABLE IF NOT EXISTS cashflow_settings (
  org_id                       uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,

  -- How much must remain in the account after a payment lands. NULL = unset, and
  -- the model falls back to the zero its specification states.
  min_buffer_cents             bigint CHECK (min_buffer_cents >= 0),
  min_buffer_signed_off_at     timestamptz,
  min_buffer_signed_off_by     text,

  -- How sure a detected recurring bill must be before it counts as certain.
  -- A fraction, 0..1 — NOT a percentage. 0.800 is "80% sure".
  confidence_floor             numeric(4,3) CHECK (confidence_floor >= 0 AND confidence_floor <= 1),
  confidence_floor_signed_off_at timestamptz,
  confidence_floor_signed_off_by text,

  -- Whole days between starting a payment and it landing. NULL = unset, and the
  -- model refuses to give an initiate-by date at all rather than assume same-day.
  settlement_lead_days         integer CHECK (settlement_lead_days >= 0 AND settlement_lead_days <= 30),
  settlement_lead_signed_off_at timestamptz,
  settlement_lead_signed_off_by text,

  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cashflow_settings IS
  'The three operator thresholds src/banking/cashflow.mjs takes as arguments. One row per org. NULL means UNSET, not zero — the model reports an unset threshold as a gap rather than reading it as a decision. Every value carries its own signed_off_at; v_cashflow_config_gaps reports anything unset or unsigned. See db/migrations/088_cashflow_settings.sql.';
COMMENT ON COLUMN cashflow_settings.min_buffer_cents IS
  'Cents that must remain after a payment lands. RAISING THIS IS NOT AUTOMATICALLY SAFER: a bigger buffer makes the model refuse more payment dates, pushing the payment later and risking the missed payment it was meant to prevent.';
COMMENT ON COLUMN cashflow_settings.confidence_floor IS
  'Fraction 0..1, not a percentage. Cannot affect whether a payment date is safe — both sides of the floor land in the pessimistic track paymentWindow() tests against. It changes only the optimistic track, which is display.';
COMMENT ON COLUMN cashflow_settings.settlement_lead_days IS
  'Whole days between starting a payment and it landing. Too low means a LATE PAYMENT; too high costs only float. Err high.';


-- ---------------------------------------------------------------------------
-- B. [SPEC] min_buffer_cents = 0
-- ---------------------------------------------------------------------------
--
-- Zero, and this is the one value that is not a guess at all: "without driving
-- the projected balance below zero" is the question the owner asked, stated in
-- the task that commissioned the model. The row exists so the value has a home
-- and can be raised deliberately, not because zero needed deciding.
--
-- ⚠️ RAISING THIS IS NOT THE SAFE DIRECTION, WHICH IS THE OPPOSITE OF HOW IT
-- READS. A buffer is a floor the balance must stay above, so a bigger one makes
-- FEWER dates feasible. The model responds by refusing earlier dates, and if the
-- buffer is big enough it refuses every date and the payment does not get
-- scheduled at all. A $500 buffer on an account that runs at $400 turns every
-- card payment into WOULD_OVERDRAW.
--
-- So it starts at the specified zero. If the account genuinely needs a cushion,
-- raise it in small steps and watch whether payment windows start coming back
-- empty. Carried unsigned so it stays visible.
--
-- Tune with:
--   UPDATE cashflow_settings SET min_buffer_cents = 10000,
--          min_buffer_signed_off_at = now(), min_buffer_signed_off_by = '<name>'
--    WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- C. [PLACEHOLDER] confidence_floor = 0.800
-- ---------------------------------------------------------------------------
--
-- 80% sure. A placeholder, and an unusually low-stakes one — this is the only
-- one of the three that CANNOT produce a wrong payment date, for a structural
-- reason worth stating: paymentWindow() tests feasibility against
-- worstCaseClosingCents, which includes confirmed AND unconfirmed bills. Moving
-- the floor moves a bill between "confirmed" and "unconfirmed", and BOTH are in
-- the worst case. The floor changes only which bills also appear in the
-- optimistic track, and the optimistic track is shown to a human, never used to
-- clear a payment.
--
-- ⚠️ THE SCALE IT COMPARES AGAINST DOES NOT EXIST YET. Recurring-bill detection
-- is a separate unit that has not landed, so nothing has defined what a
-- confidence of 0.8 MEANS — whether the detector's scores cluster near 1.0 or
-- spread evenly. 0.8 is the conventional "high confidence" line and it is a
-- guess about a distribution nobody has measured. CONFIRM IT AGAINST THE
-- DETECTOR'S ACTUAL SCORE DISTRIBUTION once that unit lands; until then it is
-- carried unsigned and reported.
--
-- Tune with:
--   UPDATE cashflow_settings SET confidence_floor = 0.900,
--          confidence_floor_signed_off_at = now(), confidence_floor_signed_off_by = '<name>'
--    WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- D. [DERIVED] settlement_lead_days = 3
-- ---------------------------------------------------------------------------
--
-- THREE CALENDAR DAYS. This is the value the whole file was written for — it is
-- what stops the model saying "pay by the 20th" and leaving a person to guess
-- when to actually press the button.
--
-- DERIVED, NOT INVENTED, AND HERE IS THE DERIVATION.
--
-- A card payment pushed from a bank account is an ACH debit. Standard ACH
-- settles on the NEXT BANKING DAY; it is not instant, and same-day ACH is a
-- separate, opted-into product that cannot be assumed. So the floor is one
-- banking day. Three things push the realistic figure above that floor:
--
--   1. BANKING DAYS ARE NOT CALENDAR DAYS, and this model counts calendar days.
--      A payment started on a Friday settles Monday at the earliest — three
--      calendar days for one banking day. A public holiday adds another.
--   2. THE ISSUER STILL HAS TO POST IT. Settlement moves the money; crediting it
--      against the card account is a second step on the issuer's own cycle.
--   3. CUT-OFF TIMES. A payment started after the day's cut-off is tomorrow's
--      payment, and this model has no clock — it works in whole days and cannot
--      know whether a person acted at 9am or 9pm.
--
-- Three calendar days covers the Friday case exactly, which is the common one
-- that a one-day or two-day figure gets wrong.
--
-- WHY ERRING HIGH IS CORRECT HERE, unlike the buffer in section B. The two
-- directions cost wildly different amounts:
--   too high → the payment is started a couple of days earlier than it had to
--              be. The cost is the float on that money for two days. Pennies.
--   too low  → the payment lands after the due date. A late fee, and a late mark
--              on a credit report, on a product whose entire purpose is
--              repairing credit.
-- An asymmetry that lopsided means the number should sit on the safe side of
-- realistic, and three does.
--
-- ⚠️ THIS IS A PROPERTY OF YOUR PAYMENT RAIL, NOT A UNIVERSAL FACT. A client
-- paying on the issuer's own website with a debit card often posts same day; a
-- mailed cheque takes a week. If a rail is ever wired into this system, this
-- value belongs to that rail and should be re-derived from its documented
-- timing rather than kept. Carried unsigned until somebody confirms which rail
-- this actually describes.
--
-- Tune with:
--   UPDATE cashflow_settings SET settlement_lead_days = 2,
--          settlement_lead_signed_off_at = now(), settlement_lead_signed_off_by = '<name>'
--    WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

INSERT INTO cashflow_settings (
  org_id, min_buffer_cents, confidence_floor, settlement_lead_days, notes
)
SELECT o.id, 0, 0.800, 3,
       'Set in 088. min_buffer_cents = 0 is the task specification, not a guess. confidence_floor 0.800 is a PLACEHOLDER and cannot affect payment safety. settlement_lead_days 3 is DERIVED from standard next-banking-day ACH settlement plus weekend drift, erring high because a late payment costs far more than two days of float. All three carry signed_off_at NULL and are reported by v_cashflow_config_gaps until confirmed.'
  FROM orgs o
 WHERE o.is_default
ON CONFLICT (org_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- E. The gaps view
-- ---------------------------------------------------------------------------
--
-- 052's rule, applied again: "a default that stops being visible is a default
-- nobody re-examines". Every value is reported until it is BOTH set AND signed
-- off, and the `consequence` column says what being wrong actually costs so the
-- three are not read as equally urgent.

CREATE OR REPLACE VIEW v_cashflow_config_gaps AS
SELECT s.org_id,
       'cashflow_settings.min_buffer_cents' AS setting,
       COALESCE(s.min_buffer_cents::text, 'null') AS value,
       CASE WHEN s.min_buffer_cents IS NULL THEN 'UNSET — the model falls back to the specified zero floor'
            WHEN s.min_buffer_signed_off_at IS NULL THEN 'SET in 088 to the task specification — AWAITING SIGN-OFF'
            ELSE 'signed off ' || s.min_buffer_signed_off_at::date END AS status,
       'raising this refuses MORE payment dates, which can push a payment late — it is not the safe direction' AS consequence
  FROM cashflow_settings s
 WHERE s.min_buffer_signed_off_at IS NULL
UNION ALL
SELECT s.org_id, 'cashflow_settings.confidence_floor',
       COALESCE(s.confidence_floor::text, 'null'),
       CASE WHEN s.confidence_floor IS NULL THEN 'UNSET — scored bills stay unconfirmed and are priced in the worst case'
            WHEN s.confidence_floor_signed_off_at IS NULL THEN 'PLACEHOLDER set in 088 — AWAITING SIGN-OFF against the detector''s real score distribution'
            ELSE 'signed off ' || s.confidence_floor_signed_off_at::date END,
       'cannot make a payment date unsafe — both sides of the floor are priced in the pessimistic track'
  FROM cashflow_settings s
 WHERE s.confidence_floor_signed_off_at IS NULL
UNION ALL
SELECT s.org_id, 'cashflow_settings.settlement_lead_days',
       COALESCE(s.settlement_lead_days::text, 'null'),
       CASE WHEN s.settlement_lead_days IS NULL THEN 'UNSET — the model refuses to say when to START a payment'
            WHEN s.settlement_lead_signed_off_at IS NULL THEN 'DERIVED default set in 088 — AWAITING SIGN-OFF against your actual payment rail'
            ELSE 'signed off ' || s.settlement_lead_signed_off_at::date END,
       'too low means a payment lands after the due date — a late fee and a credit-report mark'
  FROM cashflow_settings s
 WHERE s.settlement_lead_signed_off_at IS NULL
UNION ALL
-- An org with no row at all is the gap the other three branches cannot see,
-- because they all read FROM cashflow_settings.
SELECT o.id, 'cashflow_settings', 'no row', 'UNSET — this org has no cash-flow settings at all',
       'every threshold falls back to unset; the model reports each as a gap and gives no initiate-by date'
  FROM orgs o
 WHERE NOT EXISTS (SELECT 1 FROM cashflow_settings s WHERE s.org_id = o.id);

COMMENT ON VIEW v_cashflow_config_gaps IS
  'Every cash-flow threshold that is unset or set-but-unsigned, with what being wrong costs. Reports a value even when it HAS one, until a human signs it off — same rule as v_creative_config_gaps. See db/migrations/088_cashflow_settings.sql.';


-- ---------------------------------------------------------------------------
-- F. updated_at trigger
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['cashflow_settings'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;
