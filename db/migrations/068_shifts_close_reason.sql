-- 068_shifts_close_reason.sql — say, on the shift row itself, who ended it.
--
-- WHY THIS EXISTS. autoCloseStale() (src/shifts/store.mjs) closes shifts nobody
-- clocked out of. It decides when the person stopped by looking at their last
-- `staff_events` row, and when there is no such row it falls back to
-- `started_at` — which produces a CLOSED SHIFT OF ZERO LENGTH.
--
-- That fallback is honest about the data and catastrophic as a timesheet entry.
-- Only the Inquiry Remover desk currently writes `staff_events` at all (see
-- src/shifts/TELEMETRY-CALLSITES.md and docs/workflows/finish-the-build.md §W1).
-- A closer on calls all day, a funding advisor moving rounds, an admin — none of
-- them produce a single event, so every one of their forgotten shifts closes at
-- its own start time and reads as "worked 0 seconds". Nothing downstream can
-- tell that row apart from a real 30-second shift, because the two are byte-for-
-- byte identical: started_at, ended_at, and no other evidence anywhere.
--
-- The information already exists — autoCloseStale writes `had_activity` into the
-- detail of its `staff_events` audit row — but it exists on a DIFFERENT TABLE, in
-- a jsonb blob, which means every reader of `shifts` would have to know to join
-- to it and none of them do. src/shifts/timesheet.mjs is pure and takes shift
-- rows as arguments; it cannot reach that audit row even in principle.
--
-- So the fact moves onto the row it is a fact about.
--
-- WHY NOT JUST REFUSE TO CLOSE THOSE SHIFTS. Because uq_shifts_one_open (060)
-- means an open shift blocks that person's next clock-in. Leaving the no-evidence
-- ones open trades a wrong timesheet row for an employee who cannot start work in
-- the morning. Both are unacceptable; closing them and MARKING them is neither.
--
-- WHAT IT DOES NOT DO. It does not decide what payroll should pay for a shift
-- nobody can reconstruct. That is a decision for whoever owns payroll, and this
-- column is what makes it possible to find those shifts and ask.

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by text;

COMMENT ON COLUMN shifts.closed_by IS
  'Who ended this shift. NULL = the staff member did, or it is still open (ended_at IS NULL) — NULL is the normal, trustworthy case and is the default for every row that existed before this migration, all of which predate the sweep having any caller. '
  '''sweep_idle'' = closed by src/shifts/store.mjs autoCloseStale(); ended_at is the last recorded staff_events activity, so it is an estimate WITH evidence behind it. '
  '''sweep_no_evidence'' = closed by the same sweep with NO recorded activity at all; ended_at fell back to started_at and the shift reads as zero length. That row is NOT a timesheet fact and must never be totalled silently — src/shifts/timesheet.mjs refuses it.';

-- A closed vocabulary, enforced. `staff_events.kind` was left free text and two
-- writers promptly invented two vocabularies for it (see the KNOWN GAP note in
-- src/shifts/telemetry.mjs). Three values that decide whether time is payable is
-- not a place to repeat that. Existing rows are all NULL and pass unchanged.
--
-- Guarded rather than plain ADD CONSTRAINT: migrate.mjs skips a file it has
-- already recorded, but a migration that cannot be run twice by hand is a
-- migration nobody can safely re-run against a restored database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shifts_closed_by_known' AND conrelid = 'shifts'::regclass
  ) THEN
    ALTER TABLE shifts ADD CONSTRAINT shifts_closed_by_known
      CHECK (closed_by IS NULL OR closed_by IN ('sweep_idle', 'sweep_no_evidence'));
  END IF;
END $$;

-- The query this column exists to make possible: "which shifts do I have to ask
-- a human about". Partial, because the rows that need review are the rare ones
-- and a full index on a column that is NULL for every honest shift is waste.
CREATE INDEX IF NOT EXISTS idx_shifts_needs_review
  ON shifts (org_id, started_at)
  WHERE closed_by = 'sweep_no_evidence';
