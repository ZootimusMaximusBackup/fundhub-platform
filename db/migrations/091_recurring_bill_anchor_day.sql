-- 091_recurring_bill_anchor_day.sql — store the day of the month a bill really
-- lands on, so reading a bill back does not silently move it.
--
-- *** THIS FILE ADDS ONE NULLABLE COLUMN. *** No data is deleted, no column is
-- dropped or renamed, and every existing row keeps working — the column is NULL
-- on rows written before this migration, which is exactly the "we do not know"
-- the reader already handles.
--
--
-- WHAT WAS BROKEN.
--
-- src/banking/recurring.mjs:1091 computes `anchorDayOfMonth` — the true day of
-- the month a month-based bill is charged on — and its own comment at 1082-1090
-- says the number CANNOT BE RECOVERED afterwards:
--
--   A bill charged on the 31st whose next predicted date falls in a 30-day
--   month has that date clamped to the 30th. Anything downstream that carries
--   the prediction forward from the clamped value pins the bill to the 30th
--   permanently.
--
-- toBillRow() returned sixteen keys and this was not one of them, and
-- `anchor_day_of_month` appeared in zero .sql files. So the detector worked the
-- number out, the writer dropped it on the floor, and the reader
-- (src/banking/cashflow-seam.mjs:152-158) fell back to the clamped date — the
-- exact defect that file says a month-end test already caught once in memory.
--
-- Rent charged on the 31st, saved and read back, was pinned to the 30th forever.
--
--
-- WHY NULL IS THE RIGHT DEFAULT AND NOT 1.
--
-- NULL means "this bill was written before the anchor was stored, or its cadence
-- has no day-of-month". Both are true unknowns. Defaulting to 1 would state that
-- every historical bill is charged on the first of the month, which is a
-- specific false claim about a client's money rather than an absence — the same
-- rule 081 states for balances and 077 for cost.
--
-- The seam already handles the absence: `bill.anchorDayOfMonth ?? first.d` falls
-- back to the day in the predicted date, which is the behaviour every existing
-- row has today. Nothing regresses; new rows simply stop losing the number.
--
--
-- WEEKLY AND BIWEEKLY BILLS STORE NULL, DELIBERATELY.
--
-- recurring.mjs:1091 already publishes null when `fit.cadence.months === 0`. A
-- day-of-month on a weekly bill is meaningless — it moves every occurrence — and
-- writing one would invite a reader to anchor on it. The CHECK below enforces
-- that only month-based cadences may carry an anchor, so the storage layer
-- refuses the mistake rather than trusting each writer to remember it.

ALTER TABLE recurring_bills
  ADD COLUMN IF NOT EXISTS anchor_day_of_month smallint;

COMMENT ON COLUMN recurring_bills.anchor_day_of_month IS
  'The day of the month a month-based bill is actually charged on, 1-31. NULL means unknown (row predates this column) or not applicable (weekly/biweekly cadence). Published by the detector because it cannot be recovered from next_expected_on, which is clamped in short months: a bill on the 31st reads back as the 30th without this. Consumed by src/banking/cashflow-seam.mjs.';

-- 1-31 or nothing. 31 is permitted and is the whole point — a bill genuinely
-- charged on the 31st is the case this column exists to preserve. Clamping to
-- the length of any particular month happens at projection time, per month, in
-- advance() — never at storage time, which is what lost the number before.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_anchor_day_range'
  ) THEN
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_anchor_day_range
      CHECK (anchor_day_of_month IS NULL
             OR (anchor_day_of_month >= 1 AND anchor_day_of_month <= 31));
  END IF;
END $$;

-- An anchor day only means something for a cadence measured in months. Weekly
-- and biweekly bills must not carry one — see the header.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_anchor_day_cadence'
  ) THEN
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_anchor_day_cadence
      CHECK (anchor_day_of_month IS NULL
             OR cadence NOT IN ('weekly', 'biweekly'));
  END IF;
END $$;
