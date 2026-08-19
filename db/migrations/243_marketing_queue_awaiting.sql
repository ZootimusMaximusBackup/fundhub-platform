-- 243_marketing_queue_awaiting.sql — the content queue needs a word for "held".
--
-- WHAT WAS WRONG. 240 gave social_posts a real holding pen: a post the guardrail
-- engine returns 'needs_approval' for now lands in status = 'awaiting_approval'
-- and waits for a person instead of going out. api/social/posts.mjs writes a
-- SECOND row for the same post — the partner-facing queue row in
-- marketing_content_queue — and it knew only two endings, 'blocked' or
-- 'scheduled'. So a post that 240 had just stopped was recorded in the queue as
-- scheduled, and the partner was told it was lined up to go out when it never
-- would. The two tables disagreed about the same post, and the one the partner
-- reads held the wrong answer.
--
-- WHY A SCHEMA CHANGE. 172_wl_marketing.sql:86-87 constrains this column to
-- ('draft', 'queued', 'scheduled', 'discarded', 'blocked'). There is no value in
-- that list that honestly means "screened, stopped, waiting for a person":
--   'blocked'  is refused — a different thing, and it would tell the partner to
--              rewrite copy that broke no rule.
--   'draft'    is not written down anywhere yet, which is false: the post exists
--              and is held.
-- So the word has to be added. Writing one of the wrong ones instead would have
-- avoided this file and put a false statement in front of a partner.
--
-- 172 IS NOT EDITED. db/migrate.mjs keys schema_migrations by '<dir>/<file>', so
-- an already-applied file is never re-read and editing it is a silent no-op. This
-- supersedes its CHECK. Verified before writing: 172 is the ONLY migration that
-- defines marketing_content_queue or marketing_content_queue_status_ck.
--
-- NOTHING LEGAL TODAY BECOMES ILLEGAL. All five existing values are carried over
-- unchanged and one is added, so no row that exists can be orphaned by the new
-- CHECK and no re-run can fail on live data.

ALTER TABLE marketing_content_queue
  DROP CONSTRAINT IF EXISTS marketing_content_queue_status_ck;

ALTER TABLE marketing_content_queue
  ADD CONSTRAINT marketing_content_queue_status_ck
  CHECK (status IN ('draft', 'queued', 'scheduled', 'awaiting_approval',
                    'discarded', 'blocked'));
--   draft             — written, not lined up
--   queued            — lined up, no account chosen yet
--   scheduled         — handed to a social account with a send time
--   awaiting_approval — screened, and the engine says a person must sign it off.
--                       It does NOT go out. There is no screen or endpoint that
--                       can approve one yet, so a row here stays here.
--   discarded         — thrown away
--   blocked           — the guardrail said no

-- --------------------------------------------------------------------- self-check
-- A migration that silently did nothing is worse than one that failed, so this
-- proves the new value landed before the file is recorded as applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
     WHERE r.relname = 'marketing_content_queue'
       AND c.conname = 'marketing_content_queue_status_ck'
       AND pg_get_constraintdef(c.oid) LIKE '%awaiting_approval%')
  THEN RAISE EXCEPTION
    '243: marketing_content_queue_status_ck does not admit awaiting_approval';
  END IF;
END $$;
