-- 165: outbound email may carry files (letter PDFs).
-- Bytes live as base64 in jsonb so dispatch can attach them without a second store.
-- Empty array is "no files", never null.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
