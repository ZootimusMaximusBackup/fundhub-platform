-- 266_backfill_message_threads.sql — put the messages already sent onto threads,
-- so the people they were sent to appear on the Messaging screen.
--
-- WHAT WAS BROKEN. api/read/inbox.mjs — the staff Messaging list — reads
-- `conversations`. Only the two inbound webhook handlers ever wrote a thread;
-- every outbound workflow send (welcome email, welcome text, appointment
-- reminders), every contract email and every invoice email wrote a `messages`
-- row with conversation_id NULL. So a client the company had already texted
-- twice had no row on that screen at all, and searching their name found
-- nothing. Measured on production 2026-08-27: 600 of 844 message rows carried
-- no thread, across 51 clients, 15 of whom were invisible on Messaging.
--
-- The writers are fixed in the same change (src/conversations/store.mjs holds
-- the shared threader now). This file is the rows that already exist — without
-- it the fix only applies to messages sent from today onward, and everybody
-- already in the database stays hidden.
--
-- NOTHING IS DELETED AND NO MESSAGE MOVES. A thread is created where one is
-- missing, and a message that has no thread is pointed at the one for its own
-- client and channel. A message that already has a thread is not touched.

-- One thread per (client, channel), which is what uq_conversations_client_channel
-- has always required. last_pulse_at is the newest unthreaded message on that
-- pair, GREATEST-ed against any pulse already there so an existing thread's
-- clock can only move forward — the same rule upsertConversation applies.
--
-- org_id comes from the client record rather than from the message, so the
-- GROUP BY yields exactly one row per (client_id, channel) and the upsert
-- cannot try to touch the same row twice.
INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
SELECT cl.org_id, m.client_id, m.channel, MAX(m.created_at)
  FROM messages m
  JOIN clients cl ON cl.id = m.client_id
 WHERE m.conversation_id IS NULL
   -- A demo row is seeded with its own thread already; it is not this backfill's
   -- business to put demo traffic in the real inbox.
   AND m.is_demo IS NOT TRUE
 GROUP BY cl.org_id, m.client_id, m.channel
ON CONFLICT (client_id, channel) DO UPDATE
   SET last_pulse_at = GREATEST(EXCLUDED.last_pulse_at, conversations.last_pulse_at),
       updated_at    = now();

-- Point the orphans at their thread. The org must match on both sides, exactly
-- as linkMessage() requires: a message filed under another company's thread is
-- one consumer's correspondence showing up on another's screen, which is a
-- disclosure and not a display bug. A row that cannot satisfy the join keeps
-- its NULL, honestly.
--
-- An inbound text from a number nobody recognises has no client_id and so has
-- no thread to join. That is the correct state, not a gap — see the note at the
-- top of src/conversations/store.mjs.
UPDATE messages m
   SET conversation_id = c.id,
       updated_at = now()
  FROM conversations c
 WHERE m.conversation_id IS NULL
   AND m.client_id IS NOT NULL
   AND m.is_demo IS NOT TRUE
   AND c.client_id = m.client_id
   AND c.channel   = m.channel
   AND c.org_id    = m.org_id;
