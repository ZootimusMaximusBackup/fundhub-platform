-- ---------------------------------------------------------------------------
-- "This approval does not count" — recorded, on the application row.
--
-- WHY THIS EXISTS
-- The success fee is a percent of CONFIRMED APPROVALS: Approved applications
-- that carry a real recorded amount (docs/CLOSEOUT-FEE-BASIS.md). An Approved
-- row with a NULL amount is therefore worth nothing on the bill, and a round
-- that closes with one still blank is money we never invoice. So a round can
-- no longer be moved to Funded while any approval on it has no dollar amount
-- (guardFundedAmount, src/funding/card-stacking-rounds.mjs).
--
-- That block deadlocks on a real thing: a bank approves and the client never
-- uses the card, or the approval is withdrawn. The amount is not "not known
-- yet", it is never coming. Without a way out, one dead row holds a whole
-- round open forever. This is that way out, and it is a decision somebody
-- makes on the record — who and when — not a checkbox that clears a warning.
--
-- WHY A FLAG AND NOT A STATUS
-- applications.status is what THE BANK said. src/plays/outcomes.mjs is the
-- approval-vs-denial read and it is exact: YES_STATUSES = {'Approved'},
-- NO_STATUSES = {'Denied'}, and listOutcomesForLaterPlays selects
-- `d.status IN ('Approved','Denied')`. Moving the row to 'Denied' would invert
-- the approval rate — the bank said yes. Inventing a third status would take
-- the row out of BOTH sets, silently deleting a real bank approval from that
-- report, and would mean altering the application_status enum plus the
-- applications_status_ck constraint and teaching every status reader a new word.
--
-- So the two facts stay separate, because they ARE separate:
--   status = 'Approved'      what the bank decided       (unchanged, forever)
--   approval_excluded_at     what WE decided to do about it
--
-- Approval-rate reporting is untouched by design. Only the money reads look at
-- these columns.
--
-- NULL IS UNKNOWN AND IT SURVIVES (CLAUDE.md §12)
-- approval_excluded_at NULL means "counts" — the default and the safe answer.
-- Excluding never writes the amount: approved_amount keeps its NULL, because
-- "we are not billing for this" is not a claim that the bank approved nothing.
-- A 0 in approved_amount would be that claim, and it is refused on the way in
-- (normalizeApprovedAmount, src/applications/status.mjs).
--
-- REVERSIBLE. Setting the column back to NULL puts the approval back in the
-- fee basis, and that reinstatement writes its own application_decisions row.
-- ---------------------------------------------------------------------------

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS approval_excluded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS approval_excluded_by     text,
  ADD COLUMN IF NOT EXISTS approval_exclusion_reason text;

COMMENT ON COLUMN applications.approval_excluded_at IS
  'When staff recorded that this approval does not count toward the round: withdrawn, or never used. NULL means it counts. Never set for a denial — status still says what the bank decided.';

COMMENT ON COLUMN applications.approval_excluded_by IS
  'Who recorded the exclusion. Same shape as application_decisions.created_by.';

COMMENT ON COLUMN applications.approval_exclusion_reason IS
  'Why this approval does not count, in the words of the person who excluded it.';
