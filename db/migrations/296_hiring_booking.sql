-- 296_hiring_booking.sql — make "is the host actually free?" a fact the database
-- can enforce, and give an interview somewhere real to get its join link from.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE YOU BELIEVE THE FREE/BUSY CHECK.
--
-- Measured against this repo on 2026-09-05, THERE IS NO STAFF AVAILABILITY MODEL
-- HERE AT ALL. Specifically:
--
--   * `bookings` (225) has no staff column of any kind — no host, no owner, no
--     assignee — and no later migration adds one. The only person on a booking
--     row is the ATTENDEE (the client), by name and email. So a sales call
--     sitting on a closer's day is invisible to any host-based query, because
--     the row does not record whose day it is on.
--   * `shifts` (schema/001) is a clock-in / clock-out punch card: started_at,
--     ended_at, one open row per person. It answers "who is working right now",
--     which is exactly how public/app/calendar.html uses it. It does not answer
--     "is Sarah free at 2pm on Thursday".
--   * There is no working-hours table, no time-off table, no availability table.
--     Nothing in db/, src/, api/ or public/ mentions one.
--   * The real calendar lives OUTSIDE this repo. The public booking page is a
--     ClickFunnels page driven by Cronofy (see 225's header), and
--     src/adapters/clickfunnels.mjs is receive-only — it verifies a webhook
--     signature and emits an event, and contains no outbound fetch. This system
--     is only ever TOLD what got booked. It has never once ASKED a calendar what
--     is free, and it has no credential with which to ask.
--
-- So the guard below is honest about its own reach: it stops one person being
-- scheduled for two overlapping INTERVIEWS. It cannot see a sales call, a
-- dentist appointment, or anything else on that person's actual calendar.
-- src/hiring/booking.mjs exports the same list as HOST_BLIND_SPOTS so the gap is
-- returned to a caller rather than left implied.
--
-- What would close it: a Cronofy (or Google/Microsoft) free/busy read for each
-- host, which needs an app credential and a per-staff calendar connection this
-- repo does not have. That is an integration, not a query, and inventing
-- availability in its place would put a candidate on a call nobody is going to
-- attend. Nothing here invents one.
-- ══════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- A. hiring_interviews.ends_at — derived, stored, never hand-written
-- ---------------------------------------------------------------------------
--
-- WHY A COLUMN RATHER THAN THE OBVIOUS EXPRESSION. The overlap guard in section
-- B wants a range, and the natural way to write it is
--
--     tstzrange(scheduled_for, scheduled_for + make_interval(mins => duration_min))
--
-- which Postgres refuses inside an index or exclusion constraint: adding an
-- interval to a timestamptz is STABLE, not IMMUTABLE, because day and month
-- arithmetic depends on the session's TimeZone. tstzrange(a, b) over two plain
-- columns IS immutable, so the end time has to exist as a column.
--
-- It is DERIVED, so nothing may set it directly — the trigger overwrites whatever
-- a writer passes. A stored end time that disagreed with duration_min would make
-- the guard below quietly wrong, which is worse than not having it.

ALTER TABLE hiring_interviews
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;

COMMENT ON COLUMN hiring_interviews.ends_at IS
  'DERIVED from scheduled_for + duration_min by trg_hiring_interviews_ends_at. '
  'Never write it directly. It exists only because timestamptz + interval is '
  'STABLE and so cannot appear in the exclusion constraint (296_hiring_booking.sql).';

CREATE OR REPLACE FUNCTION hiring_interview_ends_at() RETURNS trigger AS $$
BEGIN
  -- NULL scheduled_for stays NULL: 051 allows an interview with no time yet,
  -- and "unknown" must survive rather than become a range starting at epoch.
  NEW.ends_at := CASE
    WHEN NEW.scheduled_for IS NULL THEN NULL
    ELSE NEW.scheduled_for + make_interval(mins => NEW.duration_min)
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hiring_interviews_ends_at ON hiring_interviews;
CREATE TRIGGER trg_hiring_interviews_ends_at
  BEFORE INSERT OR UPDATE OF scheduled_for, duration_min, ends_at
  ON hiring_interviews
  FOR EACH ROW EXECUTE FUNCTION hiring_interview_ends_at();

-- Backfill the rows that already exist. In this repo that is zero: before this
-- migration the ONLY INSERT INTO hiring_interviews anywhere outside a test file
-- did not exist — no product code has ever booked one. The statement is written
-- to be correct anyway rather than to assume the count.
UPDATE hiring_interviews
   SET ends_at = scheduled_for + make_interval(mins => duration_min)
 WHERE scheduled_for IS NOT NULL AND ends_at IS DISTINCT FROM
       scheduled_for + make_interval(mins => duration_min);

-- ---------------------------------------------------------------------------
-- B. One host, one interview at a time
-- ---------------------------------------------------------------------------
--
-- THE GUARD LIVES HERE AND NOT IN THE APPLICATION (CLAUDE.md §3a.2). A
-- select-then-insert check in JavaScript loses the race every time two people
-- book the same host in the same second, and the coordinator finds out when both
-- candidates join an empty room.
--
-- PARTIAL, three ways, and each exclusion is a real state rather than a
-- convenience:
--   status = 'scheduled'   a cancelled or already-held interview does not hold
--                          the host's time. 051's statuses are
--                          scheduled | held | cancelled | no_show.
--   host_staff_id NOT NULL an interview with no named host blocks nobody,
--                          because there is nobody to block.
--   ends_at NOT NULL       which, via the trigger above, means scheduled_for is
--                          set. An interview with no time cannot overlap one.
--
-- '[)' — a 10:00-11:00 and an 11:00-12:00 interview do NOT conflict. Back-to-back
-- is the normal way a group-interview day is run (doc 11: "Book a 1 hour call
-- slot - plan to wrap within 45 minutes").
--
-- NO org_id IN THE KEY, deliberately. A person is one person. Adding org_id
-- would let the same staff id be booked twice at once across two orgs, and being
-- in two places at 2pm is not something a tenancy boundary makes possible.
--
-- ALREADY-OVERLAPPING ROWS WOULD MAKE THIS FAIL LOUDLY, and that is the correct
-- outcome: an exclusion constraint cannot be added NOT VALID, and a silent
-- "guard that is not actually on" is the worst of the three options.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for the no-overlap exclusion below

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hiring_interviews_host_no_overlap'
  ) THEN
    ALTER TABLE hiring_interviews ADD CONSTRAINT hiring_interviews_host_no_overlap
      EXCLUDE USING gist (
        host_staff_id WITH =,
        tstzrange(scheduled_for, ends_at, '[)') WITH &&
      ) WHERE (status = 'scheduled' AND host_staff_id IS NOT NULL AND ends_at IS NOT NULL);
  END IF;
END $$;

-- The question booking asks on every write: what does this host already have in
-- this window. Without it that is a sequential scan of every interview ever held.
CREATE INDEX IF NOT EXISTS hiring_interviews_host_window_idx
  ON hiring_interviews (host_staff_id, scheduled_for)
  WHERE status = 'scheduled' AND host_staff_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C. staff.meeting_url — where an interview's join link comes from
-- ---------------------------------------------------------------------------
--
-- Doc 11, quoted in 051: "BE SURE THE ZOOM LINK IS IN THE CALENDAR INVITE". An
-- interview with no join link is a no-show with extra steps.
--
-- There was nowhere to read one from. This repo has no Zoom, Google Meet or
-- Whereby integration and no room-generating anything, so the only two ways to
-- fill hiring_interviews.meeting_url were (a) a human types one, or (b) code
-- invents one. public/app/hiring.html currently shows (b) — hardcoded
-- us02web.zoom.us room numbers against "Sarah Whitfield" and "Chris Stanbridge"
-- in a mock data block. Those are mockup furniture and this migration does not
-- promote them to facts; they are not seeded here or anywhere.
--
-- So: a standing room per person, typed in by a human, NULL until then. NULL is
-- a real state and src/hiring/booking.mjs refuses to book against it by name
-- rather than writing an interview nobody can join.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS meeting_url text;

COMMENT ON COLUMN staff.meeting_url IS
  'This person''s standing meeting room (Zoom/Meet/etc), typed in by a human. '
  'NULL means nobody has set one — booking refuses rather than inventing a link '
  '(296_hiring_booking.sql). NOT generated, NOT defaulted.';

-- ---------------------------------------------------------------------------
-- D. The gap, surfaced the way 051 surfaces its own
-- ---------------------------------------------------------------------------
--
-- v_hiring_config_gaps (051) lists what a human still has to fill in. A host
-- with no meeting room is exactly that kind of gap: everything looks configured
-- until the first candidate tries to book and cannot.
--
-- Only people who could plausibly host are listed — active staff whose role can
-- own a hiring req. Listing every suspended or ex-employee would bury the two
-- rows that matter.

CREATE OR REPLACE VIEW v_hiring_host_gaps AS
SELECT s.org_id,
       s.id   AS staff_id,
       s.name AS staff_name,
       s.role,
       'staff.meeting_url' AS config,
       'no standing meeting room set for ' || s.name AS detail,
       'this person cannot be booked as an interview host' AS consequence
  FROM staff s
 WHERE s.active
   AND s.status = 'active'
   AND s.role IN ('owner', 'admin', 'sales_manager', 'closer')
   AND s.meeting_url IS NULL;
