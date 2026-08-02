-- 119_outbound_switch.sql — outbound email stops being a thing nobody can turn on.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM, STATED PLAINLY.
--
-- Twenty-six workflows call sendTemplated(). Every one of them writes a row to
-- `messages` with status='queued'. The dispatcher that drains that queue is
-- built, tested and complete — and NOTHING HAS EVER CALLED IT. Its own header
-- says so: "dispatchDue() runs when something calls it, and today nothing does."
--
-- So every client email this platform has ever composed is sitting in a table.
-- Not blocked, not failed, not rejected — queued, forever, with no way for an
-- operator to see it or do anything about it. A CRM that cannot email is not a
-- CRM, and that is the owner's judgement, in his words: "holy shit, we gotta
-- send out emails. Right? That's kind of like an obvious."
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A TABLE AND NOT AN ENVIRONMENT VARIABLE.
--
-- Sending was previously gated on INNGEST_EVENT_KEY — an env var that also turns
-- on all 47 workflow functions, that only one person can set, that nobody can
-- see the state of from inside the product, and that is per-deployment rather
-- than per-company. Every one of those is wrong for a setting an operator should
-- own. The owner's objection is exactly this: "it's not like the workflow is
-- something that we turn on… it should be an option, the ability to set it up."
--
-- So it is a row, per org, visible and changeable from the CRM:
--
--   outbound_enabled   is this company's outbound mail live
--   daily_send_cap     a ceiling, so a bad loop cannot mail a book in an hour
--   updated_by         who changed it, because this switch moves real mail
--
-- ═══════════════════════════════════════════════════════════════════════════
-- IT DEFAULTS TO **ON**, AND THAT IS DELIBERATE. READ THIS BEFORE CHANGING IT.
--
-- A default of `false` would recreate the exact problem this migration exists to
-- fix: a system that looks like it sends, does not, and gives no sign. Somebody
-- would set up a journey, watch nothing arrive, and have no way to find out why.
--
-- Defaulting to ON is safe because THE REAL CONTROL IS CREDENTIALS, not a flag.
-- With no MAILGUN_SEND_API_KEY the provider returns a failure, the dispatcher
-- records it on the row, and nothing leaves. With no routing row in
-- message_channel_routing the dispatcher never resolves a provider at all. This
-- switch exists so an operator can stop mail that WOULD otherwise go — a pause
-- button, not an ignition key.
--
-- The compliance gate (src/messaging/gate.mjs) still runs on every single
-- message regardless of this setting. It has no override and this does not
-- become one.
--
-- DEPENDS ON: 001_init.sql (orgs), 110_messages_outbound.sql (the queue columns
-- the dispatcher reads), 104_app_role.sql.

CREATE TABLE IF NOT EXISTS messaging_settings (
  org_id           uuid PRIMARY KEY REFERENCES orgs(id),

  -- The pause button. See the header for why this is true by default.
  outbound_enabled boolean NOT NULL DEFAULT true,

  /* A ceiling per day, counted from `messages` rather than from a counter — the
     messages ARE the record of what was sent, and a counter is a second source
     of truth that can disagree with them.

     This is a blast-radius limit, not a business rule. A workflow bug that
     queues in a loop is the realistic failure here, and the difference between
     noticing it at 500 emails and at 50,000 is the difference between an
     apology and a blocked sending domain. */
  daily_send_cap   integer NOT NULL DEFAULT 500 CHECK (daily_send_cap >= 0),

  /* Who to tell when something needs a human — a message the gate held, or the
     cap being hit. Nullable: an org that has not set one simply is not told,
     which is honest, rather than mail going to a guessed address. */
  alert_email      text,

  updated_by       uuid REFERENCES staff(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS messaging_settings_updated_at ON messaging_settings;
CREATE TRIGGER messaging_settings_updated_at
  BEFORE UPDATE ON messaging_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* Every existing org gets a row, rather than the code treating "no row" as a
   third state it has to guess about. src/messaging/outbox.mjs still defaults a
   missing row to enabled, because a company created after this migration must
   not silently stop sending until somebody notices. */
INSERT INTO messaging_settings (org_id)
SELECT id FROM orgs
ON CONFLICT (org_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The one index the drain actually needs.
--
-- 110 added idx_messages_due for the dispatcher's claim query. This one serves
-- the two questions the new outbound screen asks constantly: how many are
-- waiting, and how many have gone out today (for the cap).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_org_status_created
  ON messages (org_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Invoices gain the two columns an emailed invoice needs.
--
-- 017 gave invoices a `status` that includes 'sent', and markSent() flips it —
-- but nothing has ever emailed one, so 'sent' has meant "somebody pressed a
-- button", not "the client received it". These two separate the claim from the
-- fact, which is the same distinction 030 draws for documents.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  -- When the email actually went to a provider. NULL means it never did.
  ADD COLUMN IF NOT EXISTS emailed_at    timestamptz,
  -- The messages row, so "what exactly did we send them" is answerable.
  ADD COLUMN IF NOT EXISTS email_message_id uuid REFERENCES messages(id);

CREATE INDEX IF NOT EXISTS idx_invoices_unemailed
  ON invoices (org_id, status) WHERE status = 'sent' AND emailed_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON messaging_settings TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

COMMENT ON TABLE messaging_settings IS
  'Per-company outbound mail settings. outbound_enabled is a PAUSE button, not an ignition key — the real control is provider credentials. See db/migrations/119_outbound_switch.sql.';
COMMENT ON COLUMN invoices.emailed_at IS
  'When the invoice email reached a provider. status=''sent'' means somebody sent it; this means it actually went.';
