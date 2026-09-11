-- 365_waypoint_nudges.sql — the ledger that makes the chase ladder terminate.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). This file governs client-facing
-- messaging cadence on a consumer-finance file. NOTHING IN THIS FILE SENDS
-- ANYTHING. There is no provider call, no scheduler and no activation flag
-- here; it is a table of what was already decided, and every constraint on it
-- points the same way — toward fewer messages, never more.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS AT ALL: 51 TEXTS TO ONE PHONE IN TWO HOURS
--
-- On 2026-09-03 a chase loop in this product sent fifty-one identical texts to
-- one person in two hours, to clients who had already booked. Two causes
-- stacked. The funnel events carried no client id, so the "have they done it
-- yet?" check could never match; and the provider fired roughly sixteen
-- duplicate webhooks per survey, each one starting its own run.
--
-- Read that failure carefully and it is not a bug in a message. It is the
-- absence of a durable record of what had already been said. The scheduler
-- remembered nothing, so every trigger looked like the first one.
--
-- So this table IS the memory, and the two unique constraints below are the
-- whole feature. They are not an optimisation and they are not a nicety:
--
--   waypoint_nudges_waypoint_step_uq   UNIQUE (waypoint_id, step)
--       Four steps exist. Four rows can exist. There is therefore no sequence
--       of events, retries, replays, duplicate webhooks or concurrent
--       schedulers that can produce a fifth message about one waypoint,
--       because the fifth row cannot be written. The cap is stored, exactly as
--       the spec demands, and it is emphatically NOT held in the scheduler's
--       memory.
--
--   waypoint_nudges_client_day_uq      UNIQUE (client_id, client_local_date)
--                                      WHERE client_local_date IS NOT NULL
--       AT MOST ONE CLIENT-FACING MESSAGE PER CLIENT PER DAY, ACROSS EVERY
--       WAYPOINT. A client with three overdue items gets one text, not three.
--       This cap is global rather than per waypoint, and it is the single
--       thing that stops a growing checklist becoming a growing spam problem.
--       The date is the client's OWN local calendar day, not ours — see
--       client_time_zone below.
--
--       IT COUNTS RECORDS, AND THAT IS NOT THE SAME AS COUNTING PEOPLE. A
--       person with two client rows on one phone number is two records, so
--       this constraint let them have two texts in a day. Measured on a
--       scratch database on 2026-09-06: two rows, '+15550004000' and
--       '+1 (555) 000-4000', one pass, two outbound messages.
--       db/migrations/369 adds a SECOND cap keyed on the normalised
--       destination. This one is kept as well as, not replaced by, that one —
--       replacing it would newly allow one client an SMS and an email on the
--       same day. The effective rule is the stricter of the two.
--
-- Both are enforced by the database rather than by a SELECT-then-INSERT in
-- JavaScript. That distinction is the point. `transactions` in this repo
-- dedupes by check-then-write and is racy under two writers; the pattern
-- copied here instead is the proven one — the partial unique index on
-- events(org_id, idempotency_key) (db/schema/001_init.sql:377) and
-- uq_soft_pull_requests_idem (077) — where the conflict is the guard and the
-- application never gets a vote.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A ROW HERE MEANS "THIS STEP IS SPENT", NOT "A CLIENT WAS MESSAGED"
--
-- This is the part that is easy to get wrong later, so it is spelled out.
--
-- The row is written FIRST, before anything is queued, and it is written as a
-- CLAIM. Whoever wins the insert owns the step; everyone else sees zero rows
-- back from ON CONFLICT DO NOTHING and stops. Only then is a message queued,
-- and `outcome` is updated to say what actually happened:
--
--   claimed           the claim exists and the send has not resolved yet. A row
--                     left in this state means a pass died mid-flight. It is
--                     NOT retried — a step is spent once. Fewer messages.
--                     THE CODE NOW ACTUALLY DOES THIS. Until 2026-09-06 the
--                     client-message path INSERTed outcome='queued' before
--                     sendTemplated was called, so a pass that died between the
--                     two left a row reading exactly like a delivered nudge and
--                     this header described something the code did not do.
--                     src/nudge/run.mjs writes 'claimed' and resolves it after
--                     the send returns. A 'claimed' row still holds the
--                     client's day, because not knowing whether a message went
--                     out is not a reason to send a second one — which needed
--                     waypoint_nudges_day_outcome_ck relaxed to permit a local
--                     date beside 'claimed'. That relaxation is in
--                     db/migrations/369, NOT edited into the CHECK below: this
--                     file is already applied wherever it is applied, and
--                     migrate.mjs keys schema_migrations on <dir>/<file>, so an
--                     edit here would never re-run (CLAUDE.md §12).
--   queued            a messages row was written with status='queued'. The
--                     dispatcher (src/messaging/dispatch.mjs) sends it, on its
--                     own clock, through its own compliance gate. This table
--                     never sends.
--   no_contact        there is no usable address for that channel — the client
--                     has no phone and the step was an SMS. The step is SPENT,
--                     deliberately, so the ladder advances to the next rung
--                     instead of retrying an impossible send forever.
--   template_pending  the template key has no approved row, so sendTemplated
--                     refused. The step is spent; the day is NOT (see below).
--   refused           sendTemplated declined for some other reason and `detail`
--                     records which. A separate value from template_pending on
--                     purpose: "we have no copy" and "the send path said no"
--                     are different problems and folding them together would
--                     hide whichever one is rarer.
--   staff_task        step 4. A task was opened for a human. No client message.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN (CLAUDE.md §12)
--
--   client_local_date NULL  — no client-facing message was actually queued on
--     this row, so it consumes NO part of the one-per-day allowance. It is not
--     "sent on the epoch" and it is not "sent today". A no_contact skip and a
--     template_pending refusal both land here, and both correctly leave the
--     client's day free for a message that can really go out.
--   client_time_zone NULL   — we do not know where the client is. The runner
--     records the zone it actually used, so a message that went out at a
--     surprising local hour can be explained rather than guessed at.
--   message_id NULL         — nothing was queued. Never zero, never a stand-in.
--   task_id NULL            — no task. Only step 4 ever has one.
--
--
-- SAFETY. Additive. Creates one table, touches no existing row, drops nothing.
-- Re-running it is a no-op.

CREATE TABLE IF NOT EXISTS public.waypoint_nudges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The waypoint being chased. CASCADE because exit condition 2 is "the
  -- waypoint is deleted": when it goes, its chase history goes with it and
  -- nothing is left behind that could resume a ladder for a row that no longer
  -- exists.
  waypoint_id   uuid NOT NULL REFERENCES public.client_waypoints(id) ON DELETE CASCADE,

  -- Which rung. 1..4 and nothing else — the ladder terminating is a property
  -- of the schema, not of the code that reads it.
  step          int NOT NULL
                CONSTRAINT waypoint_nudges_step_ck CHECK (step BETWEEN 1 AND 4),

  kind          text NOT NULL
                CONSTRAINT waypoint_nudges_kind_ck
                CHECK (kind IN ('client_message', 'staff_task')),

  channel       text
                CONSTRAINT waypoint_nudges_channel_ck
                CHECK (channel IS NULL OR channel IN ('sms', 'email')),

  template_key  text,

  outcome       text NOT NULL DEFAULT 'claimed'
                CONSTRAINT waypoint_nudges_outcome_ck
                CHECK (outcome IN ('claimed', 'queued', 'no_contact',
                                   'template_pending', 'refused', 'staff_task')),

  -- Free text saying WHY, for the outcomes that have a why. Never a client's
  -- words and never a message body — this table is an index over what the
  -- machinery did, not a second outbox.
  detail        text,

  message_id    uuid REFERENCES messages(id) ON DELETE SET NULL,
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  event_id      uuid REFERENCES events(id) ON DELETE SET NULL,

  -- The same string written to events.idempotency_key for this step. Stored so
  -- the two records can be tied together by eye during an incident.
  idempotency_key text NOT NULL,

  -- THE ONE-PER-DAY KEY. Set only when a client-facing message was really
  -- queued, and expressed in the client's own calendar day.
  client_local_date date,
  client_time_zone  text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- FOUR MESSAGES PER WAYPOINT, EVER. The hard cap, stored.
  CONSTRAINT waypoint_nudges_waypoint_step_uq UNIQUE (waypoint_id, step),

  -- Step 4 is a staff task and carries no client message; steps 1-3 are client
  -- messages and must name a channel. Neither shape can be written wrong.
  CONSTRAINT waypoint_nudges_shape_ck CHECK (
    (kind = 'staff_task'
       AND step = 4
       AND channel IS NULL
       AND client_local_date IS NULL
       AND message_id IS NULL)
    OR
    (kind = 'client_message'
       AND step BETWEEN 1 AND 3
       AND channel IS NOT NULL
       AND task_id IS NULL)
  ),

  -- A local date is a claim that a client-facing message went out on it, so it
  -- may only appear on a row whose outcome says one did.
  CONSTRAINT waypoint_nudges_day_outcome_ck CHECK (
    client_local_date IS NULL OR outcome = 'queued'
  ),

  -- A staff task row says staff_task and nothing else; a client row never does.
  CONSTRAINT waypoint_nudges_outcome_kind_ck CHECK (
    (kind = 'staff_task' AND outcome IN ('claimed', 'staff_task'))
    OR (kind = 'client_message' AND outcome <> 'staff_task')
  )
);

-- THE GLOBAL DAILY CAP. Partial, because a row with no local date queued
-- nothing and must not occupy the client's one slot for that day.
CREATE UNIQUE INDEX IF NOT EXISTS waypoint_nudges_client_day_uq
  ON public.waypoint_nudges (client_id, client_local_date)
  WHERE client_local_date IS NOT NULL;

-- "What has already been said about this waypoint" — read once per candidate
-- on every pass.
CREATE INDEX IF NOT EXISTS waypoint_nudges_waypoint_idx
  ON public.waypoint_nudges (waypoint_id, step);

-- "When did we last touch this client" — the reply-detection window starts at
-- the first nudge on a waypoint.
CREATE INDEX IF NOT EXISTS waypoint_nudges_client_created_idx
  ON public.waypoint_nudges (client_id, created_at);

COMMENT ON TABLE public.waypoint_nudges IS
  'One row per (waypoint, step) of the overdue-waypoint chase ladder. UNIQUE (waypoint_id, step) is the hard four-message cap; the partial UNIQUE (client_id, client_local_date) is the one-client-facing-message-per-client-per-day cap. Written as a claim before anything is queued, so duplicate triggers collapse to one send. Nothing in this table sends.';
COMMENT ON COLUMN public.waypoint_nudges.client_local_date IS
  'The client''s own calendar day on which a client-facing message was queued. NULL = nothing was queued on this row, so it consumes no part of the one-per-day allowance. Never a default date.';
COMMENT ON COLUMN public.waypoint_nudges.outcome IS
  'claimed = in flight and never retried; queued = a messages row exists; no_contact = no address for that channel, step spent on purpose so it is not retried forever; template_pending = no approved template; refused = the send path declined and detail says why; staff_task = step 4, a human took it.';

-- ---------------------------------------------------------------------------
-- updated_at, guarded the same way 330 guards it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_waypoint_nudges_updated ON public.waypoint_nudges;
    CREATE TRIGGER trg_waypoint_nudges_updated
      BEFORE UPDATE ON public.waypoint_nudges
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape client_waypoints (330) carries
-- ---------------------------------------------------------------------------
-- ENABLE + FORCE + one permissive policy. RLS on with no policy denies
-- everything to fundhub_app silently, which is the failure 200/201/285 exist to
-- clean up. Isolation for this class of table lives in the application layer,
-- exactly as it does for clients, messages and client_waypoints.
ALTER TABLE public.waypoint_nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waypoint_nudges FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'waypoint_nudges'
       AND policyname = 'waypoint_nudges_app_all'
  ) THEN
    CREATE POLICY waypoint_nudges_app_all ON public.waypoint_nudges
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.waypoint_nudges TO fundhub_app;
  END IF;
END $$;
