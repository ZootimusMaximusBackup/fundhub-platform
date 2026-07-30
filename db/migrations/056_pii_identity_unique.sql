-- 056_pii_identity_unique.sql — one identity row per client, and an index for
-- the access log's own read path.
--
-- 001_init created pii_identity with a NON-unique index on client_id. A person
-- has one SSN and one date of birth; two rows would make "which is current" a
-- question someone has to answer while a client is on the phone, and the wrong
-- answer means disputing the wrong identity with a bureau.
--
-- The unique index is also what makes src/pii/index.mjs's upsert possible at
-- all — ON CONFLICT needs a unique constraint to conflict against.
--
-- IF THIS MIGRATION FAILS, THAT IS THE POINT. Duplicate identity rows must be
-- reconciled by a human who can tell which is right, not silently deduplicated
-- by a migration picking the newest.

CREATE UNIQUE INDEX IF NOT EXISTS uq_pii_identity_client
  ON pii_identity (client_id);

-- The audit question is always "who touched THIS client's identity, recently".
CREATE INDEX IF NOT EXISTS idx_pii_access_client
  ON pii_access_log (client_id, created_at DESC);
