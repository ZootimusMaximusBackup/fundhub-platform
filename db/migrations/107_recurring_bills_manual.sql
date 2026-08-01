-- 107_recurring_bills_manual.sql — a human can say "this is a recurring bill"
-- directly, without three months of transaction history to detect it from.
--
-- WHY THIS EXISTS. 086_recurring_bills.sql built one path into this table:
-- detectRecurringBills() infers a bill from OBSERVED transactions, and every
-- constraint on the table assumes that — occurrence_count >= 2, first/last_seen
-- both required, confidence_label reflecting a fit the detector judged. A new
-- account with no transaction history yet has none of that to infer from, and
-- the Finance OS audit found no way to add a recurring bill except waiting for
-- enough history to accumulate. That is a real gap, not a cosmetic one: a
-- client's rent or a subscription is often known on day one.
--
-- THE ADDITIVE PART. `source` distinguishes the two paths. Every existing row
-- becomes 'detected' — the only path that has ever written this table — and
-- nothing about a detected row's meaning changes.
ALTER TABLE recurring_bills ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'detected';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_source_ck') THEN
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_source_ck
      CHECK (source IN ('detected', 'manual'));
  END IF;
END $$;

-- WHY A MANUAL ROW RELAXES occurrence_count/first_seen_on/last_seen_on/
-- detected_as_of RATHER THAN FAKING THEM. Those four columns are honest facts
-- about a detection run: how many charges it saw, over what window, at what
-- instant. A manually declared bill has none of that — there is no run, no
-- charges, no window. Writing occurrence_count = 2 and first_seen_on =
-- last_seen_on = today to satisfy the old CHECKs would be exactly the species
-- of confident-looking fabrication this repo's finance migrations keep
-- refusing (082, 085, 098's headers all make the same argument). So the
-- constraints below are rewritten to require those four ONLY for a 'detected'
-- row, and to require NOTHING FAKE for a 'manual' one — a manual row simply
-- leaves them NULL, which reads honestly as "not applicable" rather than as a
-- detection that never happened.
ALTER TABLE recurring_bills DROP CONSTRAINT IF EXISTS recurring_bills_occurrences_ck;
ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_occurrences_ck
  CHECK (source = 'manual' OR occurrence_count >= 2);

ALTER TABLE recurring_bills ALTER COLUMN occurrence_count DROP NOT NULL;
ALTER TABLE recurring_bills ALTER COLUMN first_seen_on DROP NOT NULL;
ALTER TABLE recurring_bills ALTER COLUMN last_seen_on DROP NOT NULL;
ALTER TABLE recurring_bills ALTER COLUMN detected_as_of DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_manual_shape_ck') THEN
    ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_manual_shape_ck
      CHECK (
        (source = 'detected' AND occurrence_count IS NOT NULL AND first_seen_on IS NOT NULL
          AND last_seen_on IS NOT NULL AND detected_as_of IS NOT NULL)
        OR
        (source = 'manual' AND occurrence_count IS NULL AND first_seen_on IS NULL
          AND last_seen_on IS NULL AND detected_as_of IS NULL)
      );
  END IF;
END $$;

ALTER TABLE recurring_bills DROP CONSTRAINT IF EXISTS recurring_bills_window_ck;
ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_window_ck
  CHECK (source = 'manual' OR last_seen_on >= first_seen_on);

-- CONFIDENCE ON A MANUAL ROW IS NOT A GUESS TO BE HEDGED — a human declared it,
-- which is the one case 086's own header already reserved room for: "100 IS NOT
-- REACHABLE [by the detector] and that is deliberate ... the CHECK allows 100
-- anyway rather than encoding the detector's clamp as a schema rule". A manual
-- row is written with confidence_pct = 100, confidence_label = 'high' — the
-- schema already anticipated this without needing to change.

-- next_expected_on / next_expected_unknown_reason's existing CHECK (exactly one
-- set) is UNCHANGED and applies to manual rows too: a person declaring a bill
-- must state either a next date or a reason there isn't a knowable one, same as
-- a detected row.
