-- 089_cashflow_confidence_floor.sql — replace 088's placeholder confidence
-- floor with a value derived from the detector that now exists.
--
-- WHY THIS FILE EXISTS. 088 set `cashflow_settings.confidence_floor` to 0.800
-- and said so in writing, as a [PLACEHOLDER], with an explicit condition
-- attached:
--
--   "⚠️ THE SCALE IT COMPARES AGAINST DOES NOT EXIST YET. Recurring-bill
--    detection is a separate unit that has not landed, so nothing has defined
--    what a confidence of 0.8 MEANS — whether the detector's scores cluster
--    near 1.0 or spread evenly. 0.8 is the conventional 'high confidence' line
--    and it is a guess about a distribution nobody has measured. CONFIRM IT
--    AGAINST THE DETECTOR'S ACTUAL SCORE DISTRIBUTION once that unit lands."
--
-- That unit has landed. `src/banking/recurring.mjs` is on main and it defines
-- the scale. So this file discharges the obligation 088 wrote down, rather than
-- leaving a placeholder to harden into a fact because nobody came back to it.
-- Editing 088 is not an option and would not work: migrate.mjs records each
-- file in schema_migrations by name, so a change to an applied migration is a
-- silent no-op. It is superseded here instead.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE REAL SCALE TURNED OUT TO BE
--
-- src/banking/recurring.mjs, LABEL_THRESHOLDS:
--
--     high    >= 75
--     medium  >= 55
--     low     >= 30
--     none    >=  0
--
-- and MAX_CONFIDENCE = 95 — "nothing inferred from a transaction history is
-- certain, so the score can never reach 100". The highest base score is 88 and
-- every other term is a penalty.
--
-- 0.800 was therefore wrong in a specific, checkable way: it sits ABOVE the
-- detector's own "high" line of 75, so it silently demanded a stricter standard
-- than the detector's own top band, in a range only a handful of scores can
-- reach. It was a round number picked against an imagined 0..100 distribution,
-- and the real distribution is neither uniform nor open at the top.
--
-- THE NEW VALUE IS 0.750 — the detector's own `high` band, exactly.
--
-- WHY `high` AND NOT `medium` (0.55). This is the part worth reading, because
-- there is a 0.55 constant elsewhere in the tree and the two are NOT in
-- conflict — they answer different questions:
--
--   src/banking/cashflow-seam.mjs exports PRESENTABLE_CONFIDENCE_FLOOR = 0.55,
--   derived from PRESENTABLE_LABELS = ["medium","high"]. Its question is
--   "is this safe to SHOW A PERSON as a bill?"
--
--   cashflow_settings.confidence_floor answers a stronger question:
--   "is this certain enough to treat as MONEY THAT IS DEFINITELY LEAVING?" —
--   it decides whether a bill enters the committed track of the projection.
--
-- Calling a `medium` bill certain would contradict the detector's own
-- vocabulary. Showing it to a person is a lower bar than banking on it. So the
-- floor for "certain" is `high`, and the two numbers stay different on purpose.
-- This note exists so the next reader does not "fix" the apparent disagreement
-- by collapsing them into one.
--
--
-- WHY THIS CHANGE IS SAFE BY CONSTRUCTION, AND IT IS WORTH BEING PRECISE.
-- Moving this floor CANNOT produce a wrong payment date, in either direction.
-- paymentWindow() tests feasibility against `worstCaseClosingCents`, which
-- includes confirmed AND unconfirmed bills. The floor only moves a bill between
-- those two labels, and both are already priced into the pessimistic track. It
-- changes which bills ALSO appear in the optimistic track, and the optimistic
-- track is shown to a human, never used to clear a payment. That is why this
-- was the one of 088's three values that could be adjusted on evidence without
-- a fresh risk assessment.
--
--
-- STILL NOT SIGNED OFF. signed_off_at stays NULL. Derived is not the same as
-- confirmed: nobody has yet run the detector over real transaction history and
-- looked at where the scores actually fall, and a band table is a design
-- intention rather than an observed distribution. v_cashflow_config_gaps keeps
-- reporting it, with its status updated below from PLACEHOLDER to DERIVED so
-- the report says which kind of unconfirmed it is.
--
-- Tune with:
--   UPDATE cashflow_settings SET confidence_floor = 0.550,
--          confidence_floor_signed_off_at = now(), confidence_floor_signed_off_by = '<name>'
--    WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);


-- ---------------------------------------------------------------------------
-- A. The value
-- ---------------------------------------------------------------------------
--
-- Guarded on the value still being 088's placeholder. If a human has already
-- moved it, or signed it off, this migration leaves their decision alone — a
-- migration that overwrites a human's considered value with a derived one is
-- worse than no migration.

UPDATE cashflow_settings
   SET confidence_floor = 0.750,
       notes = COALESCE(notes, '') ||
               ' | 089: confidence_floor 0.800 -> 0.750, superseding 088''s placeholder. ' ||
               'Derived from src/banking/recurring.mjs LABEL_THRESHOLDS high >= 75, which is the ' ||
               'detector''s own top band. 0.800 sat above it against an imagined distribution. ' ||
               'Deliberately NOT 0.55: that is cashflow-seam''s PRESENTABLE floor, which answers ' ||
               '"safe to show a person", not "certain enough to bank on". Still unsigned — derived ' ||
               'from a band table, not from an observed score distribution.',
       updated_at = now()
 WHERE confidence_floor = 0.800
   AND confidence_floor_signed_off_at IS NULL;


-- ---------------------------------------------------------------------------
-- B. The gaps view — say which KIND of unconfirmed this now is
-- ---------------------------------------------------------------------------
--
-- Replaced wholesale rather than patched: a view is defined by its whole body,
-- and the other three branches are carried through unchanged so this file is
-- the complete current definition rather than a diff a reader has to apply in
-- their head. Only the confidence_floor branch's status text differs from 088.

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
            WHEN s.confidence_floor_signed_off_at IS NULL THEN 'DERIVED in 089 from the detector''s own high band (>=75) — AWAITING SIGN-OFF against an observed score distribution'
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
SELECT o.id, 'cashflow_settings', 'no row', 'UNSET — this org has no cash-flow settings at all',
       'every threshold falls back to unset; the model reports each as a gap and gives no initiate-by date'
  FROM orgs o
 WHERE NOT EXISTS (SELECT 1 FROM cashflow_settings s WHERE s.org_id = o.id);

COMMENT ON COLUMN cashflow_settings.confidence_floor IS
  'Fraction 0..1, not a percentage. 089 set it to 0.750 — the detector''s own `high` band (src/banking/recurring.mjs LABEL_THRESHOLDS). NOT the same question as cashflow-seam''s PRESENTABLE_CONFIDENCE_FLOOR of 0.55: that one asks "safe to show a person", this one asks "certain enough to treat as money definitely leaving". Cannot affect whether a payment date is safe — both sides of the floor land in the pessimistic track paymentWindow() tests against.';
