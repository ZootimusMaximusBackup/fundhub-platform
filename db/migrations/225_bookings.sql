-- 225_bookings.sql — a booking is finally stored as a booking (T7-03, T7-05).
--
-- WHY THIS TABLE EXISTS. Until now a scheduled call left three traces and no
-- record: an append-only `events` row (booking.created), a `tasks` row for the
-- closer to chase, and nothing that a calendar could ask "what is booked
-- between these two dates". `tasks` is a to-do list that happens to carry a
-- due_at; it has no start/end pair, no attendee, no provider id and no status
-- beyond done/not-done, and onBookingRescheduled overwrites its due_at in
-- place so the originally-booked time is destroyed. This table is the missing
-- noun.
--
-- NUMBERED 225, NOT 177. docs/workflows/fix-2026-08-18/BOARD.md reserves
-- 225-229 for thread T7. An earlier brief said 177; that number belongs to
-- another thread and using it would collide.
--
--
-- *** T7-05: EVERY BOOKING IN THIS SYSTEM IS MISLABELLED 'calcom'. ***
--
-- src/handlers/comms.mjs hardcoded sourceWorkflow: "calcom" on every booking
-- task. The public booking page (apply.fundhub.ai/funding-book-call) is not
-- Cal.com and never has been — it is a ClickFunnels page driven by Cronofy.
-- Measured on the live database 2026-08-18: of 31 booking.created events,
-- payload->>'source' is clickfunnels on 27, gauntlet-all on 2, gauntlet on 1,
-- sim on 1, and calcom on NONE. Meanwhile all 16 'Strategy session booked'
-- task rows read source_workflow = 'calcom'. The label was a guess written
-- into every row.
--
-- This file stores the TRUE origin on `bookings.source` and repairs the wrong
-- label on the existing `tasks` rows, taking both from the event payload —
-- never from a default. A row whose true source cannot be proved from an event
-- is left exactly as it is (see the UPDATE at the bottom).
--
--
-- *** starts_at AND ends_at STAY NULLABLE. DO NOT ADD NOT NULL. ***
--
-- src/handlers/comms.mjs writes `dueAt: p.startTime || null`, so a booking
-- whose provider sent no start time is a real, occurring case — one live
-- booking.created event has no startTime at all. CLAUDE.md: NULL means unknown
-- and must survive. Defaulting an unknown start to now(), to epoch, or to the
-- event's created_at would invent a meeting time, and a calendar would then
-- show a call nobody scheduled.

CREATE TABLE IF NOT EXISTS bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  -- Nullable: a booking can arrive from a provider before the person is a
  -- client here (and one live event carries no resolvable client at all).
  --
  -- ON DELETE CASCADE, matching call_outcomes (147). Two reasons, and the first
  -- is the one that matters: this row carries the attendee's own name and email,
  -- so it is that person's data. When a client record is purged — retention
  -- sweep, demo teardown, a deletion request — the booking must go with it,
  -- not survive as an orphaned copy of the PII that was just removed. The
  -- second is mechanical: without it, every existing DELETE FROM clients in
  -- this repo (src/demo/, src/verification/fixtures.mjs, the sandbox scripts)
  -- starts failing on a foreign-key violation the day this table has rows.
  client_id       uuid REFERENCES clients(id) ON DELETE CASCADE,
  -- The TRUE origin: 'clickfunnels' | 'calcom' | 'sim' | 'gauntlet' | ...
  -- Whatever the event payload said. Never a default, never a guess.
  source          text NOT NULL,
  -- The provider's own booking id. Nullable because a payload can omit it.
  provider_uid    text,
  starts_at       timestamptz,   -- NULLABLE ON PURPOSE. See the header.
  ends_at         timestamptz,   -- NULLABLE ON PURPOSE. See the header.
  -- booked | rescheduled | cancelled | noshow | completed
  status          text,
  meeting_url     text,
  attendee_email  text,
  attendee_name   text,
  event_type_slug text,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per (company, provider booking id).
--
-- *** `source` IS NOT PART OF THE KEY. ***
--
-- It used to be — (org_id, source, provider_uid) — and that quietly re-created
-- the T7-05 trap one level down. A booking is identified by the provider's own
-- booking id, not by which company's label happened to be written on it the
-- first time. With `source` in the key, the SAME appointment arriving later
-- under a different label (or under no label at all, which falls back to
-- 'unknown') found no conflict and inserted a SECOND row, so one call showed up
-- on the calendar twice with two different statuses. The lookups in
-- src/bookings/store.mjs already ignore the label for exactly this reason; the
-- key now agrees with them.
--
-- STILL PARTIAL. A payload with no provider_uid is "unknown id", not "the same
-- booking as every other unknown id" — NULLs must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_uid_uq
  ON bookings (org_id, provider_uid)
  WHERE provider_uid IS NOT NULL;

-- The identity of a booking that has NO provider id: the event that created it.
--
-- Without this, a uid-less booking is outside every unique index, so each
-- redelivered webhook and each pass of src/events/bus.mjs replay() inserts
-- another copy of the same call — unbounded, and silently. The tasks layer is
-- already replay-proof (tasks_idempotency_idx); bookings must be too.
--
-- `raw->>'__event_id'` is the same fact the backfill below records, and
-- src/bookings/store.mjs writes it on every live insert. Two genuinely
-- different uid-less bookings arrive on two different events, so they keep two
-- rows — this de-duplicates a repeat, it does not merge distinct bookings.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_event_id_uq
  ON bookings (org_id, (raw->>'__event_id'))
  WHERE provider_uid IS NULL AND raw->>'__event_id' IS NOT NULL;

-- The calendar's only question: what is booked for this company in this range.
CREATE INDEX IF NOT EXISTS bookings_org_starts_idx
  ON bookings (org_id, starts_at);

-- Lookup by provider id ACROSS sources — the reschedule/cancel path must find a
-- booking by its uid without knowing which label was written when it was first
-- stored — is served by bookings_provider_uid_uq above, which is now keyed on
-- exactly (org_id, provider_uid). A separate index on the same two columns
-- would be dead weight, so there is none.

CREATE INDEX IF NOT EXISTS bookings_client_idx
  ON bookings (client_id);


-- ===========================================================================
-- BACKFILL 1 — build the table out of the events that already happened.
-- ===========================================================================
--
-- `events` is append-only and already holds every booking this system has ever
-- seen (columns: org_id, name, version, idempotency_key, client_id, payload —
-- see src/events/bus.mjs). So the table lands with real rows in it rather than
-- empty and waiting for the next webhook.
--
-- WHERE EACH COLUMN COMES FROM, and nowhere else:
--   source          payload->>'source'      the TRUE origin
--   provider_uid    payload->>'bookingUid'
--   starts_at       payload->>'startTime'   NULL stays NULL
--   ends_at         payload->>'endTime'
--   attendee_*      payload->>'email' / 'name'
--   meeting_url     payload->>'meetingUrl'  (live: NULL on all 31 — the
--                   ClickFunnels appointment webhook carries no join link at
--                   all; there is no field to read, so nothing is invented)
--
-- events.client_id is NULL on every live booking.created row, so the client is
-- recovered from the task the same booking already created, and failing that
-- by matching the attendee email inside the same company. If neither resolves,
-- client_id stays NULL — unknown, not guessed.
--
-- IDEMPOTENT. Each row records the source event's id at raw->>'__event_id'
-- (the same trick onMailResponse uses for bank_inbox) and the insert skips any
-- event already represented. That guard is what makes a re-run safe, and
-- bookings_event_id_uq above turns it into a rule the database enforces rather
-- than a habit this statement has.
--
--
-- *** ONE ROW PER BOOKING — AND A BOOKING WITH NO ID IS STILL A BOOKING. ***
--
-- The de-duplication key below reads
--   COALESCE(NULLIF(payload->>'bookingUid',''), 'evt:' || e.id)
-- and both halves of that matter.
--
-- It used to be a bare `payload->>'bookingUid'`, grouped with `source`. SQL's
-- DISTINCT treats NULL as NOT DISTINCT FROM NULL, so every booking.created in
-- one (org, source) that carried no bookingUid collapsed into ONE row and the
-- rest were thrown away — no error, no log, no way to notice. That is the exact
-- thing the index comment above forbids: an unknown id is not "the same booking
-- as every other unknown id". Falling back to the event's own id gives each
-- uid-less booking a group of its own, so all of them survive.
--
-- `source` is gone from the key for the same reason it is gone from the unique
-- index: the same appointment reported twice under two labels is one booking,
-- and grouping by the label kept both.
--
-- migrate.mjs runs this file exactly once, so anything dropped here is dropped
-- permanently.
--
-- Cast note: `payload->>'startTime'` is text. It is cast with a plain
-- ::timestamptz, which throws on a malformed value rather than silently
-- storing NULL. A booking time we cannot parse is a fault to find, not a fact
-- to drop.

INSERT INTO bookings (
  org_id, client_id, source, provider_uid, starts_at, ends_at,
  status, meeting_url, attendee_email, attendee_name, event_type_slug, raw,
  created_at, updated_at
)
SELECT DISTINCT ON (e.org_id, COALESCE(NULLIF(e.payload->>'bookingUid', ''), 'evt:' || e.id::text))
       e.org_id,
       COALESCE(
         e.client_id,
         t.client_id,
         (SELECT c.id FROM clients c
           WHERE c.org_id = e.org_id
             AND lower(c.email) = lower(NULLIF(e.payload->>'email',''))
           LIMIT 1)
       ),
       -- NOT NULL column. 'unknown' is the honest answer for a payload that
       -- named no source; it is never 'calcom'. Live: zero rows take this path.
       COALESCE(NULLIF(e.payload->>'source', ''), 'unknown'),
       NULLIF(e.payload->>'bookingUid', ''),
       NULLIF(e.payload->>'startTime', '')::timestamptz,
       NULLIF(e.payload->>'endTime', '')::timestamptz,
       'booked',
       NULLIF(e.payload->>'meetingUrl', ''),
       NULLIF(e.payload->>'email', ''),
       NULLIF(e.payload->>'name', ''),
       NULLIF(e.payload->>'eventTypeSlug', ''),
       e.payload || jsonb_build_object('__event_id', e.id::text),
       -- The booking was created when the event was recorded, not when this
       -- migration ran. A created_at of now() would make every historic
       -- booking look like it arrived today.
       e.created_at,
       e.created_at
  FROM events e
  LEFT JOIN LATERAL (
    SELECT tk.client_id
      FROM tasks tk
     WHERE tk.org_id = e.org_id
       AND tk.body = e.payload->>'bookingUid'
       AND e.payload->>'bookingUid' IS NOT NULL
     ORDER BY tk.created_at ASC
     LIMIT 1
  ) t ON true
 WHERE e.name = 'booking.created'
   AND NOT EXISTS (
     SELECT 1 FROM bookings b WHERE b.raw->>'__event_id' = e.id::text
   )
 ORDER BY e.org_id,
          COALESCE(NULLIF(e.payload->>'bookingUid', ''), 'evt:' || e.id::text),
          e.created_at ASC
ON CONFLICT DO NOTHING;


-- BACKFILL 2 — apply the terminal events as status, matched BY PROVIDER UID
-- ACROSS SOURCES. A cancellation is not required to carry the same source
-- label the creation did, and after T7-05 nothing may assume it does.
--
-- Live counts on 2026-08-18: 1 booking.cancelled, 1 booking.noshow. Both are
-- expected to match nothing, because src/adapters/clickfunnels.mjs derives
-- bookingUid from the ClickFunnels *webhook event id* rather than the
-- appointment id, so a later webhook about the same appointment carries a
-- different uid. That is a real defect in that adapter and is reported, not
-- patched here. This statement is written to be correct once it is fixed.

UPDATE bookings b
   SET status = 'cancelled', updated_at = now()
  FROM events e
 WHERE e.name = 'booking.cancelled'
   AND e.org_id = b.org_id
   AND e.payload->>'bookingUid' IS NOT NULL
   AND e.payload->>'bookingUid' = b.provider_uid
   AND b.status IS DISTINCT FROM 'cancelled';

UPDATE bookings b
   SET status = 'noshow', updated_at = now()
  FROM events e
 WHERE e.name = 'booking.noshow'
   AND e.org_id = b.org_id
   AND e.payload->>'bookingUid' IS NOT NULL
   AND e.payload->>'bookingUid' = b.provider_uid
   AND b.status IS DISTINCT FROM 'noshow';


-- ===========================================================================
-- BACKFILL 3 — T7-05: repair the wrong label on the tasks that already exist.
-- ===========================================================================
--
-- *** EXPECTED TO TOUCH 16 ROWS. ***
--
-- Measured against the live database on 2026-08-18: 16 tasks titled 'Strategy
-- session booked', all stamped source_workflow = 'calcom', and all 16 join a
-- booking.created event on tasks.body = payload->>'bookingUid'. Every one of
-- those events says the true source is 'clickfunnels'. Zero are unmatched.
-- On a fresh or scratch database with no such rows this touches 0, which is
-- also correct.
--
-- ONLY A ROW A REAL EVENT PROVES IS CHANGED. The join is the evidence: no
-- matching booking.created event, no update. There is no fallback, no
-- heuristic on the title, and no "probably ClickFunnels" — an unmatched row
-- keeps the label it has, wrong or not, because inventing a corrected value is
-- worse than leaving a known-suspect one. NEVER invent a source.
--
-- NOT FILTERED ON THE TITLE, deliberately. A booking task that has since been
-- rescheduled reads 'Strategy session rescheduled', and it is mislabelled in
-- exactly the same way. The proof that a row is a booking task is the event it
-- joins to, not its wording.
--
-- The DISTINCT ON subquery makes the choice deterministic when a (org,
-- bookingUid) pair somehow has two events: the earliest one wins.
--
--
-- *** A ROW WHOSE NEW LABEL WOULD COLLIDE KEEPS ITS OLD LABEL, ON PURPOSE. ***
--
-- `tasks` carries UNIQUE tasks_idempotency_idx (client_id, source_workflow,
-- body) NULLS NOT DISTINCT. If one client somehow holds BOTH
-- (client,'calcom',UID) and (client,'clickfunnels',UID), relabelling the first
-- would make it a duplicate of the second, and this is ONE global UPDATE: a
-- single colliding pair anywhere raises "duplicate key value violates unique
-- constraint tasks_idempotency_idx", the whole file rolls back, and the
-- bookings table is never created at all. One dirty pair would take the entire
-- migration down with it.
--
-- The NOT EXISTS below skips exactly those rows. A skipped row keeps its old
-- (wrong) 'calcom' label deliberately — the correctly-labelled twin already
-- exists beside it, so nothing is lost, and leaving one stale label behind is a
-- far smaller problem than not shipping the table. Deleting or merging the pair
-- would be destroying data to tidy a label, which this file will not do.
--
-- IS NOT DISTINCT FROM, not `=`, because the index is NULLS NOT DISTINCT: two
-- NULL client_ids or two NULL bodies collide there, and `=` would not see it.

UPDATE tasks t
   SET source_workflow = ev.true_source,
       updated_at      = now()
  FROM (
    SELECT DISTINCT ON (e.org_id, e.payload->>'bookingUid')
           e.org_id,
           e.payload->>'bookingUid' AS booking_uid,
           NULLIF(e.payload->>'source', '') AS true_source
      FROM events e
     WHERE e.name = 'booking.created'
       AND NULLIF(e.payload->>'bookingUid', '') IS NOT NULL
       AND NULLIF(e.payload->>'source', '') IS NOT NULL
     ORDER BY e.org_id, e.payload->>'bookingUid', e.created_at ASC
  ) ev
 WHERE t.org_id = ev.org_id
   AND t.body   = ev.booking_uid
   AND t.source_workflow = 'calcom'
   AND ev.true_source <> 'calcom'
   AND NOT EXISTS (
     SELECT 1
       FROM tasks x
      WHERE x.id <> t.id
        AND x.client_id       IS NOT DISTINCT FROM t.client_id
        AND x.body            IS NOT DISTINCT FROM t.body
        AND x.source_workflow IS NOT DISTINCT FROM ev.true_source
   );
