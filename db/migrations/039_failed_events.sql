-- 039_failed_events.sql — the dead-letter queue.
--
-- NUMBERING: this unit was assigned 036, but main used that for
-- 036_partner_role.sql before this landed. 039 is the next free number that is
-- not already spoken for — 037 (agent registry) and 038 (deferred CAPI/Deluxe ad
-- attribution) are both reserved.
--
-- THE GAP THIS CLOSES. src/events/bus.mjs dispatches handlers serially with
-- `await handler(event, db)` and nothing around it. One handler throwing does two
-- bad things at once: every sibling handler registered for that event never runs,
-- and the rejection propagates out of emit() into whichever adapter called it.
-- Where that adapter is a webhook the provider sees a 5xx and may or may not
-- retry; where it is a script the process exits. Either way nothing durable
-- records WHICH handler failed, on WHAT payload, or WHY, so a 2am failure is
-- gone by morning.
--
-- The event itself is already safe — `events` is append-only and written before
-- dispatch, so no data is lost. What is lost is the work the handler was supposed
-- to do. That is what this table tracks, and why a row here points at an event
-- rather than copying it.
--
-- DESIGN NOTES
--
-- One row per (event, handler), not per attempt. A handler that fails on every
-- retry should be one row with attempts=7, not seven rows: the operator question
-- is "what is broken", not "how many times did it try". The attempt history that
-- matters — first seen, last seen, count, last error — fits in the row. The
-- unique index is what makes recording a failure idempotent, so a replay storm
-- cannot flood the queue.
--
-- payload is COPIED, not just referenced. The FK to events is ON DELETE SET NULL
-- rather than CASCADE: if an event is ever pruned, the failure record must
-- survive with enough context to understand it. A dead-letter queue that loses
-- its evidence when the source is tidied away is not a queue.
--
-- next_attempt_at drives backoff and is the only scheduling state. A worker
-- claims rows WHERE status='pending' AND next_attempt_at <= now(), so "retry
-- later" needs no separate queue and no cron bookkeeping.
--
-- status is deliberately small:
--   pending    — will be retried when next_attempt_at arrives
--   exhausted  — hit max_attempts; needs a human, will not self-retry
--   resolved   — a retry succeeded, or an operator marked it handled
--   ignored    — an operator decided it does not matter (kept, not deleted)
--
-- Nothing hard-deletes. Rows are terminal-stated, because "why did this stop
-- failing" is a question you get asked months later.

CREATE TABLE IF NOT EXISTS failed_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),

  -- What failed. event_id may go NULL if the event is ever pruned; name,
  -- version and payload are copied so the row stays readable regardless.
  event_id         uuid REFERENCES events(id) ON DELETE SET NULL,
  event_name       text NOT NULL,
  event_version    integer NOT NULL DEFAULT 1,
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Which handler. Named, because an event with four handlers that fails in one
  -- of them is a different problem from an event that fails in all four.
  handler_name     text NOT NULL,

  -- Why. error_message is what an operator reads; error_stack is for debugging
  -- and is capped by the writer, not stored unbounded.
  error_message    text NOT NULL,
  error_stack      text,
  error_code       text,

  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 1,
  max_attempts     integer NOT NULL DEFAULT 7,

  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  next_attempt_at  timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  resolution_note  text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT failed_events_status_ck
    CHECK (status IN ('pending', 'exhausted', 'resolved', 'ignored')),
  CONSTRAINT failed_events_attempts_ck
    CHECK (attempts >= 1 AND max_attempts >= 1),
  -- A terminal state must say when it became terminal, so "when did this stop
  -- being a problem" is always answerable.
  CONSTRAINT failed_events_resolved_at_ck
    CHECK ((status IN ('resolved', 'ignored')) = (resolved_at IS NOT NULL))
);

-- The idempotency key. One row per event per handler: recording the same failure
-- again bumps attempts instead of inserting. NULLS NOT DISTINCT so a failure on a
-- pruned event (event_id NULL) still collapses on the same handler rather than
-- inserting a new row each retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_failed_events_unique
  ON failed_events (org_id, event_id, handler_name) NULLS NOT DISTINCT;

-- The worker's claim query: due, pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_failed_events_due
  ON failed_events (org_id, next_attempt_at)
  WHERE status = 'pending';

-- The health screen's query surface: what is broken, grouped and counted.
CREATE INDEX IF NOT EXISTS idx_failed_events_status
  ON failed_events (org_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_events_name
  ON failed_events (org_id, event_name, status);

-- Reuse the repo's existing updated_at trigger function if 001_init defined one;
-- otherwise leave updated_at to the writer. Guarded so this file never depends on
-- the trigger existing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_failed_events_updated_at'
         AND tgrelid = 'public.failed_events'::regclass
    ) THEN
      CREATE TRIGGER trg_failed_events_updated_at
        BEFORE UPDATE ON failed_events
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  ELSE
    RAISE NOTICE '039_failed_events: no set_updated_at() function — updated_at is the writer''s job.';
  END IF;
END $$;

-- A dead-letter row is evidence. Deleting one destroys the only record that the
-- work was owed, so deletes are blocked outright — the terminal states
-- ('resolved', 'ignored') are how a row leaves the operator's queue. Same
-- discipline as 016_ledger_no_delete.sql.
CREATE OR REPLACE FUNCTION failed_events_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'failed_events rows are not deletable — set status to resolved or ignored instead';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_failed_events_no_delete ON failed_events;
CREATE TRIGGER trg_failed_events_no_delete
  BEFORE DELETE ON failed_events
  FOR EACH ROW EXECUTE FUNCTION failed_events_no_delete();

-- v_failed_events_summary — what the health screen reads. One row per
-- (event_name, handler_name, status) with counts and the freshest error, so the
-- screen never has to pull payloads to render a list.
CREATE OR REPLACE VIEW v_failed_events_summary AS
SELECT org_id,
       event_name,
       handler_name,
       status,
       count(*)::int          AS rows,
       sum(attempts)::int     AS total_attempts,
       min(first_seen_at)     AS first_seen_at,
       max(last_seen_at)      AS last_seen_at,
       min(next_attempt_at)   AS next_attempt_at,
       (array_agg(error_message ORDER BY last_seen_at DESC))[1] AS latest_error
  FROM failed_events
 GROUP BY org_id, event_name, handler_name, status;
