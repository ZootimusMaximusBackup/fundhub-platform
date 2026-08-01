-- 110_message_channel_routing.sql — the provider seam the journey runner needs,
-- and the dispatch columns a queued message needs to ever stop being queued.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
--
-- Ticket 8 (the journey runner) is written against Ticket 1, which introduces
-- `message_channel_routing` and a provider interface that twilio, mailgun and
-- ghl-relay each implement. TICKET 1 IS NOT IN THIS REPOSITORY. Grepping for
-- message_channel_routing across db/, src/ and api/ finds nothing, there is no
-- src/messaging/providers/ directory, and there is no dispatcher of any kind:
-- src/workflows/messaging.mjs sendTemplated() INSERTs a row with
-- status='queued' and provider='internal', and nothing in the tree ever reads
-- a queued message again. 'queued' is a terminal state today.
--
-- So this migration builds the SMALLEST seam Ticket 8 cannot exist without,
-- and stops there:
--
--   * the routing table, exactly as Ticket 8 specifies it, because Ticket 8's
--     hard rule is that the memory provider is selected ONLY through this
--     table — "no env var, no if (testing) branch, no flag threaded through
--     the dispatcher"
--   * the columns a dispatch attempt has to write somewhere
--
-- It does NOT create twilio, mailgun or ghl-relay rows, and the two providers
-- that exist alongside it in src/messaging/providers/ are `memory` (appends to
-- an in-process array) and `internal` (leaves the row queued, today's exact
-- behaviour). NEITHER TRANSMITS. CLAUDE.md §12's "Nothing transmits" holds
-- after this migration exactly as it held before it — verified by
-- src/messaging/no-transmit.test.mjs. Wiring a real vendor is Ticket 1's job
-- and wants its own migration.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY 'internal' IS THE DEFAULT AND WHY THE DEFAULT IS SEEDED
--
-- A missing routing row could mean "not configured yet" or "deliberately
-- dark". Those want opposite behaviour, and guessing between them at dispatch
-- time is how a message gets sent that nobody chose to send. So every existing
-- org gets an explicit 'internal' row per channel below: the seam is switched
-- ON with the do-nothing provider, and there is no code path where the absence
-- of a row is read as permission to reach the outside world. resolve() in
-- src/messaging/providers/index.mjs refuses an unrouted channel rather than
-- falling back.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE messages COLUMNS
--
-- messages (001_init.sql:256) has no sent_at, no attempts, no claimed_at, no
-- error column — nothing a dispatcher needs, because there has never been one.
-- Three columns is what the claim loop actually reads and writes; anything
-- more would be speculative. status stays free text (it has no CHECK today and
-- adding one would reject rows the tree already writes), and the values the
-- dispatcher uses are documented on the column instead:
--
--   queued   → written by sendTemplated, waiting for a dispatch attempt
--   sent     → a provider accepted it
--   refused  → the live-mode fence rejected it; a terminal state, never retried
--   failed   → a provider threw
--
-- Scoped by org_id, same convention as message_templates and journeys — this
-- is internal operating configuration, not partner-branded content, so it does
-- not carry partner_id or the partner-isolation RLS from 045.

CREATE TABLE IF NOT EXISTS message_channel_routing (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id),
  channel    text NOT NULL,                     -- sms | email | voice
  provider   text NOT NULL,                     -- memory | internal (twilio | mailgun | ghl-relay are Ticket 1)
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel)
);

-- updated_at, per the 001_init.sql convention.
DROP TRIGGER IF EXISTS trg_message_channel_routing_updated_at ON message_channel_routing;
CREATE TRIGGER trg_message_channel_routing_updated_at
  BEFORE UPDATE ON message_channel_routing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every org, every channel, explicitly dark. See the header: absence is never
-- read as permission, so the row has to exist before dispatch will do anything.
INSERT INTO message_channel_routing (org_id, channel, provider, enabled)
SELECT o.id, c.channel, 'internal', true
  FROM orgs o
  CROSS JOIN (VALUES ('sms'), ('email'), ('voice')) AS c(channel)
 WHERE NOT EXISTS (
   SELECT 1 FROM message_channel_routing r
    WHERE r.org_id = o.id AND r.channel = c.channel
 );

-- Dispatch bookkeeping. See the header for the status vocabulary.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attempts      integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_error    text;

COMMENT ON COLUMN messages.attempts      IS 'dispatch attempts made; incremented at claim, so a crashed attempt still counts';
COMMENT ON COLUMN messages.dispatched_at IS 'when a provider accepted or refused it; NULL while still queued';
COMMENT ON COLUMN messages.last_error    IS 'why the last attempt did not send; the fence writes its refusal reason here';

-- The claim loop selects queued rows for one org in insertion order. Partial,
-- because every other status is uninteresting to it and the queued set is the
-- only part that stays hot.
CREATE INDEX IF NOT EXISTS idx_messages_dispatch_queue
  ON messages (org_id, created_at)
  WHERE status = 'queued';

-- Belt and braces alongside 104's blanket grant + default-privileges, same
-- reasoning 105 and 106 recorded: a grant that already holds is a no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON message_channel_routing TO fundhub_app;
