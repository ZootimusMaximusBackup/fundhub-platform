-- 175_company_brain_threads.sql — Company Brain chat history.
--
-- Board: docs/workflows/company-brain-chat-2026-08-17.md §3.3 / §3.7 (W4).
-- Company Brain answered a question and then forgot it. These two tables are
-- the memory: one row per conversation, one row per turn.
--
-- SCOPE IS THE WHOLE POINT. A thread belongs to ONE org AND ONE staff member.
-- Every read in src/company-brain/threads.mjs filters on both columns, and the
-- index below is ordered to match that filter so it is the cheap path, not the
-- afterthought. Nobody ever reads another person's conversation.
--
-- DEPENDS ON: schema/001_init.sql (orgs, set_updated_at()).

CREATE TABLE IF NOT EXISTS brain_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  -- Deliberately NOT a foreign key to staff(id): a conversation outlives the
  -- account that started it, and losing history on an offboard would be worse
  -- than a dangling id. Reads scope by org_id AND staff_id regardless.
  staff_id    uuid NOT NULL,
  title       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The list query is exactly (org_id, staff_id) ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS brain_threads_org_staff_updated_idx
  ON brain_threads (org_id, staff_id, updated_at DESC);

DROP TRIGGER IF EXISTS brain_threads_set_updated_at ON brain_threads;
CREATE TRIGGER brain_threads_set_updated_at
  BEFORE UPDATE ON brain_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS brain_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  thread_id      uuid NOT NULL REFERENCES brain_threads(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('user', 'assistant')),
  text           text NOT NULL DEFAULT '',
  -- The §3.5 citation array as stored. Empty array, never NULL, so a screen
  -- can map over it without a guard.
  sources        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which engine produced the answer ('model' / 'extractive'). NULL on a user
  -- message, and NULL means unknown — never backfill it to a guess.
  answer_source  text,
  thin           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Transcript read: one thread, oldest first.
CREATE INDEX IF NOT EXISTS brain_messages_thread_created_idx
  ON brain_messages (thread_id, created_at);

COMMENT ON TABLE brain_threads IS
  'Company Brain: one chat conversation. Scoped to one org AND one staff member.';
COMMENT ON COLUMN brain_threads.staff_id IS
  'Owner of the conversation. Every read filters org_id AND staff_id — never another person''s thread.';
COMMENT ON TABLE brain_messages IS
  'Company Brain: one turn of a conversation. sources holds the cited files for an assistant turn.';

-- Supabase often enables RLS with zero policies on a new table, which is a
-- silent deny-all for fundhub_app. Same patch as 109 / 154 / 166 / 171 —
-- a table with RLS on and no policy is the bug 154 exists to clean up, so
-- these ship with the policy attached rather than waiting to be found.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'brain_threads'
  ) THEN
    ALTER TABLE brain_threads ENABLE ROW LEVEL SECURITY;
    CREATE POLICY brain_threads_no_bare_rls ON brain_threads
      USING (true) WITH CHECK (true);
    ALTER TABLE brain_threads FORCE ROW LEVEL SECURITY;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'brain_messages'
  ) THEN
    ALTER TABLE brain_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY brain_messages_no_bare_rls ON brain_messages
      USING (true) WITH CHECK (true);
    ALTER TABLE brain_messages FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_threads TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON brain_messages TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
