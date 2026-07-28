-- 006 — unique constraint for task idempotency.
-- Prevents duplicate tasks on Inngest replay. Pairs with ON CONFLICT DO NOTHING on all inserts.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_idempotency_idx ON tasks(client_id, source_workflow, body) NULLS NOT DISTINCT;
