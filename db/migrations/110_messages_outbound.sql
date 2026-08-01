-- 110_messages_outbound.sql — the dispatcher's half of the messages table,
-- plus the per-org channel→provider routing table.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `messages` ALREADY EXISTS. THIS ADDS TO IT.
--
-- db/schema/001_init.sql:256 creates it, and src/workflows/messaging.mjs has
-- been writing rows into it (status='queued', provider='internal') since the
-- workflow engine landed. A second table would not just be duplication — the
-- ON CONFLICT (org_id, provider_ref) idempotency index from 004 lives on the
-- existing one, and a dispatcher reading a different table would re-send every
-- message the workflows already queued.
--
-- So the outbound dispatcher runs on the table that is already there, with the
-- columns below added. Every ADD COLUMN is IF NOT EXISTS: this migration is
-- safe to re-run, and safe against a database where someone added one of these
-- by hand.
--
-- WHAT EXISTS ALREADY AND IS NOT RESTATED HERE:
--   org_id, client_id, conversation_id, direction, channel, template_key,
--   rendered_body, provider, provider_ref, status, compliance_check_passed,
--   created_at, updated_at
--
-- NOTE ON provider_ref vs provider_message_id — they are NOT the same field and
-- collapsing them would break idempotency. `provider_ref` is OURS: synthesised
-- before the send (`workflow:<template>:<event>`) and carrying the unique index
-- that makes a replayed event a no-op. `provider_message_id` is THEIRS: handed
-- back by Mailgun or the relay after they accept it, unknown until then, and
-- the only handle we have for a later delivery receipt or bounce.

-- ── the dispatcher's columns ────────────────────────────────────────────────

-- When this message becomes due. NULL means "as soon as the dispatcher sees
-- it" — that is the shape every existing queued row is already in, which is why
-- this is nullable rather than DEFAULT now(). Backfilling it to now() would
-- take the several-thousand rows already sitting queued and declare them all
-- due at migration time.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Delivery attempts made. Drives retry backoff and the give-up threshold.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- The provider's error text from the most recent failure. Operator-facing, and
-- the only place a "why is this stuck" question can be answered from.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_error text;

-- The provider's own identifier, returned on acceptance. See the note above.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id text;

-- Why the compliance gate refused this message, and when.
--
-- THESE ARE WRITTEN, NEVER CLEARED. A blocked message is an audit record: it
-- says we held a message back and names the reason. Nothing in the dispatcher
-- may null these out to make a row sendable again — the correct way to send
-- after a block is a NEW row that passes the gate on its own merits.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

-- The dispatcher's only hot query: "what is queued, outbound, and due now".
-- Partial on the status/direction pair so the index stays roughly the size of
-- the backlog rather than the size of all history — messages is append-mostly
-- and the sent rows vastly outnumber the queued ones.
--
-- scheduled_at NULLS FIRST because NULL means "due immediately" here, so the
-- ordering the dispatcher wants and the ordering the index provides are the
-- same one.
CREATE INDEX IF NOT EXISTS idx_messages_due
  ON messages (org_id, scheduled_at NULLS FIRST)
  WHERE direction = 'outbound' AND status = 'queued';

-- ── channel routing ─────────────────────────────────────────────────────────
--
-- Which provider carries which channel, per org. The cutover moves SMS onto a
-- GHL relay while email goes direct to Mailgun, and the two dates are not the
-- same date — hence a row per channel rather than one provider per org.
--
-- `enabled` is the kill switch: false stops that channel for that org without
-- a deploy and without deleting the routing (which would lose what it was
-- pointed at). A dispatcher that finds no row, or a disabled one, MUST NOT fall
-- back to a default provider — no route is a hold, not a licence to guess.
CREATE TABLE IF NOT EXISTS message_channel_routing (
  org_id     uuid        NOT NULL REFERENCES orgs(id),
  channel    text        NOT NULL,
  provider   text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, channel)
);

-- updated_at maintained by the same trigger every other table here uses
-- (001_init.sql:21), so "when did routing last change" is answerable without
-- the writer having to remember to set it. Guarded because CREATE TRIGGER has
-- no IF NOT EXISTS and this migration must survive a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'message_channel_routing_updated_at'
       AND tgrelid = 'message_channel_routing'::regclass
  ) THEN
    CREATE TRIGGER message_channel_routing_updated_at
      BEFORE UPDATE ON message_channel_routing
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Seed: one row per channel per org, for every org that exists now.
--
-- ON CONFLICT DO NOTHING, not DO UPDATE. If an operator has already repointed a
-- channel, this migration re-running must not drag it back to the default —
-- that would silently undo a live cutover decision.
INSERT INTO message_channel_routing (org_id, channel, provider)
SELECT o.id, v.channel, v.provider
  FROM orgs o
  CROSS JOIN (VALUES
    ('email', 'mailgun'),
    ('sms',   'ghl_relay')
  ) AS v(channel, provider)
ON CONFLICT (org_id, channel) DO NOTHING;

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- 104_app_role.sql grants "ALL TABLES IN SCHEMA public", which is a snapshot at
-- the moment it ran, not a standing rule — a table created afterwards is not
-- covered by it. 104 also sets ALTER DEFAULT PRIVILEGES, which covers tables
-- created by the same role that ran it, but 105_login_path_grants.sql exists
-- precisely because that combination has already been observed to miss a table
-- and take the login path down. This is one idempotent line against repeating
-- that; granting a privilege that is already held is a no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON message_channel_routing TO fundhub_app;

-- DELIBERATELY NO ROW LEVEL SECURITY ON THIS TABLE.
--
-- Only the nineteen partner-isolated tables from 045/046/047/049/050 carry RLS
-- in this codebase; everything else is protected by the grants above plus
-- application-level org scoping. 109_no_bare_rls.sql documents what happens
-- when RLS is switched on without a policy attached: Postgres denies every row
-- to every ordinary role, which surfaced as a total login outage. Enabling it
-- here for tidiness, without a partner column to isolate on, would recreate
-- exactly that. Org scoping for routing lookups belongs in the WHERE clause,
-- where the rest of this repo puts it.
