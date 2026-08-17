-- 170_call_outcome_checklist.sql — what the closer confirmed before Save.
-- Four boxes on the call cockpit (recorded, personal guarantee, month-14 cliff,
-- bank decides). jsonb so a missing key is "not checked", never invented true.

ALTER TABLE call_outcomes
  ADD COLUMN IF NOT EXISTS checklist jsonb;

COMMENT ON COLUMN call_outcomes.checklist IS
  'Closer confirmations at save: call_recorded, personal_guarantee, month_14_cliff, bank_decides. NULL = not sent.';
