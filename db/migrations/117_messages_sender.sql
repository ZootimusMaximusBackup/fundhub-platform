-- 117_messages_sender.sql — who sent this message, when a person sent it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS.
--
-- Every outbound row in `messages` until now was queued by a workflow. A
-- workflow has no staff member, which is why src/workflows/messaging.mjs's
-- header says its `staffId` seam "is never supplied and no row is ever
-- produced" — there was no staff-initiated send in this codebase to supply one.
--
-- The staff reply inbox is that send. A human types a reply and it goes out, so
-- for the first time a `messages` row has an author, and "who sent this" stops
-- being answerable from the template key. This column records it.
--
-- NULL IS THE NORMAL CASE AND MEANS SOMETHING SPECIFIC: no person sent this —
-- it was a workflow, a webhook, or it is inbound. It does NOT mean "unknown
-- staff member". Every historic row is NULL and correctly so; there is no
-- backfill, because there is no staff member any of them belonged to.
--
-- ON DELETE SET NULL, not CASCADE. Deleting a staff row must never delete the
-- messages they sent to clients — the message is the record of what a consumer
-- was told, and it outlives the employment. Losing it to a staff cleanup would
-- destroy the thing an audit reads.
--
-- NO CHECK TYING THIS TO direction='outbound'. It would be true today and would
-- have to be dropped the moment anything records which employee logged an
-- inbound call, and a constraint that encodes today's only writer is a
-- constraint the second writer has to argue with. The application decides; see
-- src/messaging/compose.mjs, which is the only thing that sets it.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;

-- The inbox's only per-sender question is "what have I sent", which is narrow
-- and rare. The index that actually earns its write cost is the thread read —
-- "every message on this conversation, oldest first" — which today runs against
-- idx_messages_convo (001_init.sql), an index on conversation_id alone. The
-- thread view sorts within that, so the sort key goes in the index too.
--
-- Partial on conversation_id IS NOT NULL: the great majority of historic rows
-- have no thread (nothing wrote conversation_id before src/conversations/store.mjs
-- landed), and they can never match this query.
CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON messages (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- The inbox list joins conversations to their newest message, per org. Without
-- this the "latest message per thread" lateral is a scan of the org's whole
-- message history on every inbox load.
CREATE INDEX IF NOT EXISTS idx_messages_org_created
  ON messages (org_id, created_at DESC);
