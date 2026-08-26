-- Staff-typed expected creditor name next to the bureau's actual string.
-- Reuses inquiry_log. Does not open removal. Does not feed C-02.

ALTER TABLE inquiry_log
  ADD COLUMN IF NOT EXISTS expected_name text;

COMMENT ON COLUMN inquiry_log.expected_name IS
  'Name staff expected to see. Actual bureau string stays on inquiry_name.';
