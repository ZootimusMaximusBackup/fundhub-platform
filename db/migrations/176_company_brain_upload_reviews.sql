-- 176_company_brain_upload_reviews.sql — let staff uploads use the review queue.
--
-- Board: docs/workflows/company-brain-chat-2026-08-17.md §3.6 / §3.7 (W5).
--
-- Why this file exists:
--   132_company_brain_classification.sql created brain_classification_reviews
--   with CHECK (proposed_tier IN ('owner','affiliate')), because Drive
--   classification only ever queues those two tiers — public/sales/staff
--   auto-assign. Staff uploads are different: an upload is NOT answerable
--   until the owner approves it, whatever tier was proposed, so an upload
--   proposing 'public', 'sales' or 'staff' must also be able to enqueue.
--   That old CHECK would reject the insert.
--
--   Editing 132 in place is a silent no-op — migrate.mjs records each file in
--   schema_migrations keyed <dir>/<file>, so an already-applied file never runs
--   again. This new file supersedes the constraint instead.
--
-- Owner-set H-3 (2026-08-02) is untouched: only the `owner` role decides a
-- review. Widening the tiers that may be QUEUED does not widen who APPROVES.
--
-- DEPENDS ON: 132_company_brain_classification.sql.

-- 1) Drop the old two-tier CHECK. Discover it by definition rather than by
--    name — 132 declared it inline, so Postgres named it automatically.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'brain_classification_reviews'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%proposed_tier%'
  LOOP
    EXECUTE format(
      'ALTER TABLE brain_classification_reviews DROP CONSTRAINT %I', c.conname
    );
  END LOOP;
END $$;

-- 2) Re-add it, explicitly named, covering all five tiers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'brain_classification_reviews'::regclass
       AND conname = 'brain_classification_reviews_proposed_tier_ck'
  ) THEN
    ALTER TABLE brain_classification_reviews
      ADD CONSTRAINT brain_classification_reviews_proposed_tier_ck
      CHECK (proposed_tier IN ('public', 'sales', 'staff', 'owner', 'affiliate'));
  END IF;
END $$;

-- 3) Tell the two kinds of review apart. Existing rows are Drive
--    classification reviews, so the default backfills them correctly.
ALTER TABLE brain_classification_reviews
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'classification'
    CHECK (kind IN ('classification', 'upload'));

CREATE INDEX IF NOT EXISTS brain_classification_reviews_org_kind_status_idx
  ON brain_classification_reviews (org_id, kind, status, created_at DESC);

COMMENT ON COLUMN brain_classification_reviews.proposed_tier IS
  'Never auto-applied. Live access_tier stays owner until the owner approves. All five tiers may be queued since 176 — an upload needs approval at any tier.';
COMMENT ON COLUMN brain_classification_reviews.kind IS
  'classification = Drive file tier proposal. upload = staff-uploaded document held unanswerable (brain_files.approval_status = pending) until owner approval.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_classification_reviews TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
