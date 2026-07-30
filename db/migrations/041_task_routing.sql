-- 041_task_routing.sql — give generated work an owner.
--
-- THE GAP. Nineteen workflows insert into `tasks` with assignee = NULL. The
-- column is free text and nothing reads it, so every task those workflows create
-- lands in a table nobody queries by owner: the work is recorded and reaches
-- nobody. There is no way to ask "what does a funding advisor owe today", which
-- is the only question the task list exists to answer.
--
-- Two columns, because assignment happens at two different times:
--
--   assignee_role      who OWNS this class of work — known when the workflow
--                      fires, and the routing the 19 sites have been missing.
--   assignee_staff_id  who has PICKED IT UP — set later, by a person or by the
--                      round-robin in 035_schema_gaps.sql. Nullable forever;
--                      a task with a role and no staff member is the queue.
--
-- Role is text, not an FK to staff_roles: that table is a display catalog whose
-- shape 020_auth.sql explicitly tolerates being foreign (see its long comment),
-- and a hard FK from tasks would make task creation fail on a database whose
-- catalog is in that state. The value is checked instead — the six employee roles
-- only. 'partner', 'client' and 'affiliate' are principal types and must never
-- own internal work, which the CHECK now enforces rather than leaving to callers.
--
-- The existing `assignee` text column is left alone and left unused. Dropping it
-- would break any read that still selects *, and it costs nothing to leave. It is
-- marked dead here so nobody wires it up again by accident.
--
-- IDEMPOTENCY IS NOT CHANGED. 006_tasks_idempotency.sql keys uniqueness on
-- (client_id, source_workflow, body) NULLS NOT DISTINCT, where the 19 sites store
-- the EVENT ID in body. That is per-event dedupe, which is what the standing rule
-- "same event twice = one row" asks for. Re-keying on title instead would make a
-- workflow that legitimately fires twice for one client — a second optimization
-- round, a second inquiry batch — silently create no second task. This migration
-- deliberately keeps the event-scoped key; see src/lib/create-task.mjs.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_role     text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_staff_id uuid;

-- Added separately and guarded so re-running is a no-op even if a previous run
-- got as far as the columns but not the constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_staff_fk'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_assignee_staff_fk
      FOREIGN KEY (assignee_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
  END IF;

  -- Employee roles only. A principal type owning an internal task would put
  -- client-facing work in a partner's or a client's queue.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_role_ck'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_assignee_role_ck
      CHECK (assignee_role IS NULL OR assignee_role IN
        ('owner', 'admin', 'funding_advisor', 'closer', 'inquiry_specialist', 'setter'));
  END IF;
END $$;

COMMENT ON COLUMN tasks.assignee IS
  'DEAD — superseded by assignee_role / assignee_staff_id in 041_task_routing.sql. Never read.';
COMMENT ON COLUMN tasks.assignee_role IS
  'Which employee role owns this work. Set by the workflow that creates the task.';
COMMENT ON COLUMN tasks.assignee_staff_id IS
  'Which staff member picked it up. NULL means still in the role queue.';

-- The index the queue read needs: open work for a role, oldest first. Partial on
-- done = false because that is the only state anyone queues on, and it keeps the
-- index small as completed tasks accumulate.
CREATE INDEX IF NOT EXISTS idx_tasks_role_open
  ON tasks (org_id, assignee_role, created_at)
  WHERE done = false;

-- "What have I personally got open" — the ?mine=1 read.
CREATE INDEX IF NOT EXISTS idx_tasks_mine_open
  ON tasks (org_id, assignee_staff_id, created_at)
  WHERE done = false AND assignee_staff_id IS NOT NULL;

-- v_task_queue_depth — how much open work each role owes, and how much of it
-- nobody has picked up. The number an ops screen leads with.
CREATE OR REPLACE VIEW v_task_queue_depth AS
SELECT org_id,
       assignee_role,
       count(*)::int                                            AS open_tasks,
       count(*) FILTER (WHERE assignee_staff_id IS NULL)::int    AS unclaimed,
       count(*) FILTER (WHERE assignee_staff_id IS NOT NULL)::int AS claimed,
       min(created_at)                                          AS oldest_open_at
  FROM tasks
 WHERE done = false
 GROUP BY org_id, assignee_role;
