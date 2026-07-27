-- message_templates.source_doc — which fundhub-docs source a row's copy came from.
--
-- The rows themselves are NOT seeded from SQL. They are parsed out of the source
-- docs at run time by src/messaging/seed/seed.mjs, so a copy edit in
-- fundhub-docs re-seeds without a code change. A generated INSERT list here
-- would go stale the first time someone fixes a typo in a doc.
--
-- This file only carries the one column that seeder needs and 001_init.sql does
-- not have. It lives in db/seed/ rather than db/schema/ purely to stay inside
-- this task's ownership boundary; ADD COLUMN IF NOT EXISTS makes it a no-op if
-- the column is later folded into the schema proper.
--
-- Both statements are re-runnable, which matters because db/migrate.mjs records
-- applied files by name — a re-run against a database that already has the
-- column must not error.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS source_doc text;

COMMENT ON COLUMN message_templates.source_doc IS
  'fundhub-docs path the copy was parsed from, e.g. fundhub-docs/sources/SMS-Compliant-Rewrites.md';

-- The seeder and the renderer both look templates up by channel.
CREATE INDEX IF NOT EXISTS idx_msgtpl_channel ON message_templates(org_id, channel);
