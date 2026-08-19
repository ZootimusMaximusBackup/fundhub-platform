-- 240_social_approval_hold.sql — a post that needs a human cannot go out without one.
--
-- WHAT WAS WRONG. src/compliance/screen.mjs returns three verdicts: 'blocked',
-- 'needs_approval' and 'passed'. src/social/scheduler.mjs branched on 'blocked'
-- only, so 'needs_approval' and 'passed' took the identical path into
-- status = 'queued', and publishDue selects on status = 'queued' alone. The
-- database agreed with the mistake: 049's screen gate admitted BOTH 'passed' and
-- 'needs_approval' into 'queued'. So every post the guardrail engine held for a
-- person — including every credit_repair post, which 047/screen.mjs holds
-- unconditionally and which no setting can release — was published without one.
--
-- WHY THIS IS A SCHEMA CHANGE AND NOT A ONE-LINE GUARD. social_posts had no state
-- meaning "screened, waiting for a person", and no record of who approved or when.
-- The vocabulary needed to express the correct behaviour did not exist, so a guard
-- in JavaScript would have had nowhere to put the held post and nothing to check
-- before releasing it.
--
-- 049 IS NOT EDITED. db/migrate.mjs keys schema_migrations by '<dir>/<file>', so an
-- already-applied file is never re-read; editing it would be a silent no-op. This
-- supersedes it. Verified before writing: 049_social.sql is the ONLY migration that
-- defines social_posts.status, social_posts_status_ck or social_post_screen_gate.
-- 172_wl_marketing.sql:79 merely foreign-keys to social_posts(id) and is unaffected.
--
-- THE OTHER FAILURE DIRECTION. Holding everything forever is as real a failure as
-- sending everything. So the gate below releases a post the moment approved_at is
-- set, and a post whose verdict was 'passed' is never held at all.

-- ---------------------------------------------------------------- (a) the status
-- 049:89-90 named this constraint explicitly, so it can be dropped by name. Every
-- value that was legal stays legal — 'awaiting_approval' is added, nothing removed,
-- so no existing row can be orphaned by the new CHECK.
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_ck;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_ck
  CHECK (status IN ('draft', 'awaiting_approval', 'queued', 'posting', 'posted',
                    'failed', 'blocked'));
--   draft             — being composed
--   awaiting_approval — screened, and the engine says a person must sign it off
--   queued            — screened, cleared, and scheduled
--   posting           — in flight
--   posted            — done
--   failed            — retried and gave up; surfaces as a task
--   blocked           — the guardrail said no

-- ------------------------------------------------------------- (b) who, and when
-- Both nullable: most posts are never held, and a held post is unapproved until
-- somebody approves it. staff(id), not accounts(id) — approving held marketing copy
-- is an employee action, and staff and accounts are separate tables with separately
-- generated keys, so the wrong one would never match.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES staff(id);

-- --------------------------------------------------------------- (c) the new gate
-- Supersedes social_post_screen_gate() as defined at 049:133-151. Same trigger, same
-- name, replaced body. Two rules now instead of one:
--   1. Nothing reaches a live state without a screening row  (049's rule, kept).
--   2. If the only verdict on the post was 'needs_approval', a live state also
--      needs approved_at  (new).
-- 'awaiting_approval' is the holding pen: it needs a screening row and nothing more.
CREATE OR REPLACE FUNCTION social_post_screen_gate() RETURNS trigger AS $$
DECLARE
  has_pass boolean;
  has_hold boolean;
BEGIN
  IF NEW.status NOT IN ('awaiting_approval', 'queued', 'posting', 'posted') THEN
    RETURN NEW;
  END IF;

  SELECT bool_or(s.state = 'passed'), bool_or(s.state = 'needs_approval')
    INTO has_pass, has_hold
    FROM compliance_screenings s
   WHERE s.subject_type = 'social_post' AND s.subject_id = NEW.id;

  IF NOT COALESCE(has_pass, false) AND NOT COALESCE(has_hold, false) THEN
    RAISE EXCEPTION
      'social post % has not passed the guardrail engine — it cannot be queued (049/240)',
      NEW.id;
  END IF;

  -- Being held is always allowed once screened. This is the safe landing spot.
  IF NEW.status = 'awaiting_approval' THEN
    RETURN NEW;
  END IF;

  -- Going out. A 'passed' verdict needs no signature. A post whose only verdict was
  -- 'needs_approval' does, and approved_at is the signature.
  IF NOT COALESCE(has_pass, false) AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION
      'social post % was held for human approval and nobody has approved it — it cannot be queued or sent (240)',
      NEW.id;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_post_screen_gate ON social_posts;
CREATE TRIGGER trg_social_post_screen_gate
  BEFORE UPDATE OF status ON social_posts
  FOR EACH ROW EXECUTE FUNCTION social_post_screen_gate();

-- -------------------------------------------------- rows that are already queued
-- WHAT HAPPENS TO POSTS QUEUED BEFORE TODAY. Without this step they would sit in
-- 'queued', publishDue would still pick them up, and their next status change would
-- raise — aborting the whole publish batch, not just their own row. So the ones that
-- should never have been queued are moved into the holding pen now. Nothing is
-- deleted and no post is sent that would not have been sent a minute ago; this only
-- STOPS sends. A post with a 'passed' verdict is left exactly where it is.
DO $$
DECLARE
  held    integer;
  orphans integer;
  stuck   integer;
BEGIN
  UPDATE social_posts p
     SET status = 'awaiting_approval'
   WHERE p.status = 'queued'
     -- Already signed off. approved_at is new in this file so nothing can carry one
     -- yet on a first run, but leaving this out would mean a re-run dragged approved
     -- posts back into the pen — caught by running the step twice on a scratch
     -- database, not by reading it.
     AND p.approved_at IS NULL
     AND EXISTS (SELECT 1 FROM compliance_screenings s
                  WHERE s.subject_type = 'social_post' AND s.subject_id = p.id
                    AND s.state = 'needs_approval')
     AND NOT EXISTS (SELECT 1 FROM compliance_screenings s
                      WHERE s.subject_type = 'social_post' AND s.subject_id = p.id
                        AND s.state = 'passed');
  GET DIAGNOSTICS held = ROW_COUNT;

  -- Queued with no screening row at all. 049's gate should have made this
  -- impossible on the UPDATE path, so if any exist they were inserted straight into
  -- 'queued' (an INSERT has never been gated). NOT touched — moving one would be
  -- guessing at a verdict that was never recorded. Reported instead.
  SELECT count(*) INTO orphans
    FROM social_posts p
   WHERE p.status = 'queued'
     AND NOT EXISTS (SELECT 1 FROM compliance_screenings s
                      WHERE s.subject_type = 'social_post' AND s.subject_id = p.id);

  -- Left mid-flight by a crash. Untouched: it may already be live on the platform,
  -- and calling it "awaiting approval" would be a claim the record cannot support.
  SELECT count(*) INTO stuck FROM social_posts WHERE status = 'posting';

  RAISE NOTICE '240: % queued post(s) moved to awaiting_approval', held;
  IF orphans > 0 THEN
    RAISE NOTICE '240: % queued post(s) have NO screening row — left alone, they will refuse their next status change', orphans;
  END IF;
  IF stuck > 0 THEN
    RAISE NOTICE '240: % post(s) are stranded in posting — left alone, unchanged by this migration', stuck;
  END IF;
END $$;

-- --------------------------------------------------------------------- self-check
-- A migration that silently did nothing is worse than one that failed, so this
-- proves the two shape changes landed before the file is recorded as applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
     WHERE r.relname = 'social_posts' AND c.conname = 'social_posts_status_ck'
       AND pg_get_constraintdef(c.oid) LIKE '%awaiting_approval%')
  THEN RAISE EXCEPTION '240: social_posts_status_ck does not admit awaiting_approval';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'social_posts' AND column_name = 'approved_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'social_posts' AND column_name = 'approved_by')
  THEN RAISE EXCEPTION '240: approved_at / approved_by were not added';
  END IF;
END $$;
