-- 134_chat_widget.sql — messaging extensions for the CRM chat widget.
--
-- Spec: docs/CRM-CHAT-WIDGET-SPEC.md
--
-- Owner calls made by the build session (2026-08-02), documented here so they
-- are not re-litigated:
--   C-1: How-to-use-the-system is its OWN corpus (src/chat/platform-help.mjs),
--        not mixed into Company Brain's Drive store. Different trust boundary.
--   C-2: Staff may message any client in their org (compose already works that
--        way; the widget does not invent an assignment gate).
--   C-3: Widget ships for internal staff + client portal only. Affiliates and
--        white-label partners do not get it in v1.
--
-- AGENT-READY SENDER IDENTITY. Spec §4.3: conversation records must not assume
-- a human sender. sender_kind on messages is staff | client | agent | system.
-- Agent sending stays OFF in application code; the column exists so we never
-- retrofit every message row later.
--
-- STAFF↔STAFF. conversations.client_id stays NOT NULL for client threads (the
-- unique index and every existing reader depend on it). Internal threads are a
-- separate kind with client_id NULL and channel='internal'. A partial unique
-- index keeps one open internal thread per (org, sorted participant pair) via
-- conversation_participants.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_kind text;

UPDATE messages
   SET sender_kind = CASE
     WHEN direction = 'inbound' THEN 'client'
     WHEN sender_staff_id IS NOT NULL THEN 'staff'
     ELSE 'system'
   END
 WHERE sender_kind IS NULL;

ALTER TABLE messages
  ALTER COLUMN sender_kind SET DEFAULT 'system';

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_sender_kind_ck;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_kind_ck
  CHECK (sender_kind IN ('staff', 'client', 'agent', 'system'));

COMMENT ON COLUMN messages.sender_kind IS
  'Who authored the row: staff | client | agent | system. Agent sending is data-model-ready but application-off until a later release. NULL never means unknown after backfill — use system for workflow/webhook rows.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_kind_ck;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_ck
  CHECK (kind IN ('client', 'internal'));

-- Internal threads have no client. Drop NOT NULL only when kind can be internal.
-- Existing rows are kind='client' and keep a real client_id.
ALTER TABLE conversations
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_client_kind_ck;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_client_kind_ck
  CHECK (
    (kind = 'client' AND client_id IS NOT NULL)
    OR (kind = 'internal' AND client_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_convo_participants_staff
  ON conversation_participants (staff_id, conversation_id);

-- Pair key for "the DM between these two staff members". Lexicographically
-- sorted uuid text so (A,B) and (B,A) collide on the same unique index.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS internal_pair_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_internal_pair
  ON conversations (org_id, internal_pair_key)
  WHERE kind = 'internal' AND internal_pair_key IS NOT NULL;

COMMENT ON COLUMN conversations.kind IS
  'client = staff↔client thread (existing shape). internal = staff↔staff DM. Visually distinct in the chat widget so nobody replies thinking it is a client.';

COMMENT ON COLUMN conversations.internal_pair_key IS
  'For kind=internal only: sorted "staffIdA:staffIdB". NULL on client threads.';
