-- Affiliate and partner logins live on accounts, not staff.
-- Forgot-password already mails a token from password_resets. This lets that
-- same table hold a reset for an affiliate or partner without inventing a
-- second token path.

ALTER TABLE password_resets
  ALTER COLUMN staff_id DROP NOT NULL;

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_subject_ck'
  ) THEN
    ALTER TABLE password_resets
      ADD CONSTRAINT password_resets_subject_ck
      CHECK (
        (staff_id IS NOT NULL AND account_id IS NULL)
        OR (staff_id IS NULL AND account_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pwreset_account
  ON password_resets (account_id, created_at DESC);
