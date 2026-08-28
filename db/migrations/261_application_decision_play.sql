-- Stamp the play name on the existing bank yes/no audit row.
-- Reuses application_decisions. No new table. No learner.

ALTER TABLE application_decisions
  ADD COLUMN IF NOT EXISTS play_name text;

COMMENT ON COLUMN application_decisions.play_name IS
  'Staff-named play used when the bank said yes or no. Empty is allowed.';
