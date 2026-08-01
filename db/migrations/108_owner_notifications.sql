-- 108_owner_notifications.sql — a queue for texting the OWNER, not the client.
--
-- WHY THIS IS A SEPARATE TABLE FROM `messages`. `messages` (001_init.sql) is
-- shaped entirely around a CLIENT-facing conversation — client_id, a
-- conversation_id, and message_templates' compliance_check_passed gate exist
-- because a sentence about somebody's credit shown to THAT PERSON is a claim
-- needing compliance sign-off (src/alerts/store.mjs's own header: "NOTHING
-- THIS FILE WRITES IS CUSTOMER-FACING"). An owner notification is the opposite
-- case — a staff member being told about their own book of business — and
-- forcing it through the client-facing table and its compliance gate would
-- either misuse client_id (whose staff row is this "client"?) or block every
-- notification behind a sign-off process built for a different problem.
--
-- STILL A QUEUE, NOT A SENDER. Same discipline as `messages.status = 'queued'`
-- everywhere else in this codebase (src/workflows/messaging.mjs — nothing here
-- transmits, no outbound fetch, no SMS provider wired in). `sent_at` stays NULL
-- until a real send path is built and turned on deliberately.
CREATE TABLE IF NOT EXISTS owner_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- Which alert this came from, if it came from one. SET NULL — deleting an
  -- alert must not destroy the record that a notification was queued for it.
  alert_id      uuid REFERENCES alerts(id) ON DELETE SET NULL,
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,

  channel       text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  title         text NOT NULL CHECK (btrim(title) <> ''),
  body          text NOT NULL CHECK (btrim(body) <> ''),

  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at       timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_notifications_org_status
  ON owner_notifications (org_id, status, created_at DESC);

-- One notification per alert. Re-running "evaluate" must not queue the owner a
-- second text for an alert that is still open — that is what
-- alerts.dedupe_key already prevents at the alert layer, and this mirrors it
-- one level up rather than trusting callers to check first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_notifications_alert
  ON owner_notifications (alert_id) WHERE alert_id IS NOT NULL;
