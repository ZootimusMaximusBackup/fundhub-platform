-- 165_messages_attachments.sql — optional outbound file attachments.
--
-- A message may carry zero or more attachments. Shape:
--   [{"asset":"ebook-placeholder","filename":"fundhub-ebook.pdf"}]
--
-- `asset` is a key in src/messaging/assets.mjs. Bytes are loaded at send time
-- by the Mailgun provider — never stored in this column. NULL means none.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments jsonb;

COMMENT ON COLUMN messages.attachments IS
  'Optional outbound attachments as [{asset, filename?}]. Bytes resolved at send from src/messaging/assets.mjs.';
