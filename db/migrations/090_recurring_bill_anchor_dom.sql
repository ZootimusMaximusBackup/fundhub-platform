-- 090_recurring_bill_anchor_dom.sql — store the billing day-of-month the
-- detector already works out, so a month-end bill stops drifting.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG, EXACTLY
-- ═══════════════════════════════════════════════════════════════════════════
-- A bill charged on the 31st has no 31st in February, April, June, September or
-- November. `src/banking/recurring.mjs` handles that correctly when it predicts:
-- its advance() clamps to the last day of a short month, so a bill due the 31st
-- predicts the 30th for a 30-day month.
--
-- `next_expected_on` therefore holds a CLAMPED date whenever the next month is
-- short. And that is the only forward-looking date this table stores.
--
-- `src/banking/cashflow-seam.mjs` then expands that one date into the series the
-- cash-flow projection needs. Its own header says what happens next:
--
--   "`nextExpectedDate` may itself be clamped: a bill charged on the 31st has a
--    predicted date of the 30th whenever the next month is short. Anchoring on
--    that clamped value and stepping forward pins the bill to the 30th FOREVER
--    — the first version of this file did exactly that and the month-end test
--    caught it. The detector publishes the true anchor for this reason;
--    `first.d` is only the fallback for a caller hand-building a bill without
--    one."
--
-- The detector DOES publish it — `anchorDayOfMonth` is emitted by
-- detectRecurringBills() (src/banking/recurring.mjs, in the bill it returns).
-- But `toBillRow()` drops it, because this table has had no column to put it in.
-- So every bill that goes through the database loses the true anchor, the seam
-- falls back to `first.d`, and the fallback is exactly the clamped value the
-- comment above warns about.
--
-- Net effect on a real screen: a rent payment on the 31st, read out of the
-- database in a 30-day month, is shown as due on the 30th of every month from
-- then on. It never returns to the 31st. It is one day early, forever, and
-- nothing anywhere reports it as an estimate.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A COLUMN AND NOT A DERIVATION
-- ═══════════════════════════════════════════════════════════════════════════
-- It cannot be derived. Given a stored date of the 30th, "was the true anchor
-- the 30th or the 31st?" has no answer without the evidence the detector saw,
-- and that evidence is a join away and may have been re-detected since. The
-- detector is the only thing that knows, it already knows, and this is a column
-- to write it down in.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULLABLE, AND NULL IS A REAL AND CORRECT ANSWER
-- ═══════════════════════════════════════════════════════════════════════════
-- The detector emits `anchorDayOfMonth: null` for every day-based cadence —
-- weekly and biweekly bills step by days and have no day-of-month at all
-- (recurring.mjs: `fit.cadence.months === 0 ? null : anchorDom`). Making this
-- NOT NULL would force a caller to invent a number for a weekly bill.
--
-- NULL also covers every row written before this migration. Those rows keep the
-- fallback behaviour they already had — the seam still uses `first.d` — which is
-- the same answer they gave yesterday, not a new wrong one. They correct
-- themselves the next time the detector runs over that account. No backfill is
-- attempted here, deliberately: a backfill would have to guess the anchor from a
-- clamped date, which is the guess this file exists to stop.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1..31, NOT 1..28
-- ═══════════════════════════════════════════════════════════════════════════
-- The whole point is to hold a 31 that no February can represent. A CHECK of
-- 1..28 "to be safe" would reject exactly the value this column exists for.
--
-- EDITING AN APPLIED MIGRATION IS A SILENT NO-OP — migrate.mjs keys
-- schema_migrations on '<dir>/<file>' and skips a file it has already run. If
-- this needs to change, supersede it with a new file.

ALTER TABLE recurring_bills
  ADD COLUMN IF NOT EXISTS anchor_day_of_month integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_anchor_dom_ck'
  ) THEN
    ALTER TABLE recurring_bills
      ADD CONSTRAINT recurring_bills_anchor_dom_ck
      CHECK (anchor_day_of_month IS NULL
             OR (anchor_day_of_month BETWEEN 1 AND 31));
  END IF;
END $$;

-- A day-of-month on a weekly or biweekly bill is meaningless and would be read
-- by the seam as an anchor it must honour. The detector never emits one; this
-- stops anything else from writing one by hand.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_anchor_dom_cadence_ck'
  ) THEN
    ALTER TABLE recurring_bills
      ADD CONSTRAINT recurring_bills_anchor_dom_cadence_ck
      CHECK (anchor_day_of_month IS NULL
             OR cadence IN ('monthly', 'annual'));
  END IF;
END $$;

COMMENT ON COLUMN recurring_bills.anchor_day_of_month IS
  'The TRUE billing day of the month, 1-31, as the detector determined it — not the day in next_expected_on, which is clamped down in short months. NULL for weekly and biweekly bills, which have no day-of-month, and for rows written before migration 090. Read by src/banking/cashflow-seam.mjs expectedOccurrences(); without it a bill due on the 31st is pinned to the 30th forever. See db/migrations/090_recurring_bill_anchor_dom.sql.';
