-- 252_repair_rounds_six.sql — six bureau rounds + letter target (bureau vs furnisher).
-- WS-B repair-build-spec §5. Numbered 252 because 251 is reserved by WS-C inbound.

ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_round_check;
ALTER TABLE dispute_cases
  ADD CONSTRAINT dispute_cases_round_check
  CHECK (round IN ('R1','R2','R3','R4','R5','R6','FURNISHER'));

ALTER TABLE dispute_items DROP CONSTRAINT IF EXISTS dispute_items_round_check;
ALTER TABLE dispute_items
  ADD CONSTRAINT dispute_items_round_check
  CHECK (round IN ('R1','R2','R3','R4','R5','R6','FURNISHER'));

ALTER TABLE dispute_letters
  ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'bureau';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dispute_letters_target_check'
  ) THEN
    ALTER TABLE dispute_letters
      ADD CONSTRAINT dispute_letters_target_check
      CHECK (target IN ('bureau','furnisher'));
  END IF;
END $$;

ALTER TABLE dispute_letters
  ADD COLUMN IF NOT EXISTS furnisher_address_id uuid
  REFERENCES furnisher_mail_addresses(id);
