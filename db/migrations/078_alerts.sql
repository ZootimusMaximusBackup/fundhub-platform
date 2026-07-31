-- 078_alerts.sql — the record that the system decided there was something worth
-- saying about a client, and whether a human has dealt with it yet.
--
-- WHY THIS EXISTS. The Finance OS work splits into three questions, and this
-- table answers only the third: (1) what are this client's credit lines —
-- `tradelines`, 054; (2) what would we do about them — the calculators; (3) has
-- something changed that a person should act on. Nothing in the schema held (3).
-- Every "we noticed X" in the platform today is either a `task` (work assigned to
-- staff) or a `message` (something queued to a client). An alert is neither: it
-- is an observation with a severity that may never become either, and forcing it
-- into `tasks` would mean the task list fills up with observations nobody asked
-- for and the real work becomes invisible.
--
-- NOTHING HERE SENDS ANYTHING. Writing an alert row is the whole of what this
-- table does. There is no outbound fetch anywhere in `src/adapters/` or
-- `src/lib/` (AUDIT-FINDINGS.md, "Nothing transmits"), no scheduler, and no
-- delivery path — and none is added by this migration. An alert is a row a screen
-- can read. Turning one into an email or an SMS is a separate decision with a
-- separate compliance answer, and the mail path in `src/mail/` is deliberately
-- inert for exactly that reason.
--
-- THE CONDITIONS THAT RAISE AN ALERT ARE NOT IN THIS FILE AND NOT IN CODE. They
-- are rows in `upsell_trigger_rules` (079). 013_commission_rules.sql opens with
-- "Every rate is a row. There are no rates in code" and the same rule holds here:
-- "utilization dropped below X" is a threshold a person owns, not a constant a
-- developer picked. `kind` on this table carries the rule key that fired, and
-- `payload` carries a frozen snapshot of the thresholds that were in force at the
-- time — so an alert raised last March can still be explained after the rule has
-- been edited, the same way `commission_rules` effective-dating keeps a past
-- payout explicable.
--
-- SEVERITY IS A VOCABULARY, NOT A DECISION. The three values below are a fixed
-- ladder so that a screen can sort and colour them. WHICH severity a given
-- condition raises at is a column on the 079 rule row — a person's call, editable
-- without a deploy. No code in this repository picks a severity.
--
-- ONE OPEN ALERT PER (client, kind). Enforced by a partial unique index rather
-- than by the writer, because the writer is the thing most likely to be replayed:
-- the event bus is at-least-once, and `AUDIT-FINDINGS.md` records two separate
-- money bugs whose root cause was a dedupe guard that was inert (`ON CONFLICT ...
-- WHERE provider_ref IS NOT NULL` against a NULL ref, and a NULL idempotency_key
-- on invoices). Re-raising the same unacknowledged alert must refresh it, not
-- stack a second copy in front of the person reading the list. Acknowledging it
-- releases the slot, so the same condition can legitimately be raised again later.

CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHAT was noticed. For anything raised by the upsell evaluator this is the
  -- `upsell_trigger_rules.rule_key` that fired, so the alert points back at the
  -- row holding the condition. Deliberately NOT a foreign key and deliberately
  -- not a CHECK enum: alerts are a general surface and a producer outside the
  -- upsell rules must be able to write one without a migration. Retiring a rule
  -- must also not orphan or rewrite the alerts it already raised.
  kind         text NOT NULL CHECK (btrim(kind) <> '' AND length(kind) <= 120),

  -- The ladder. See the header: this set is structure; the choice of level per
  -- condition is a row in 079.
  severity     text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

  -- The evidence. Two parts, both required for an alert to be explicable later:
  --   * the metrics that were true when it fired, and
  --   * `rule_snapshot` — the thresholds that were in force, frozen.
  -- Frozen rather than looked up, for the reason `affiliate_referrals` freezes
  -- its rule snapshot at conversion: a threshold edited next month must not
  -- silently restate why an alert fired last month.
  --
  -- No claim text lives here. This is a regulated consumer-finance product and a
  -- customer-facing sentence about a credit outcome is not something a rule
  -- evaluator gets to write; the payload carries numbers and stated reasons, and
  -- whoever renders them owns the wording.
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- WHEN THE OBSERVATION WAS TRUE, which is not necessarily when the row was
  -- written — the same distinction `tradelines.as_of` draws. A monthly report
  -- generated on the 3rd describes the period that ended on the 31st.
  raised_at    timestamptz NOT NULL DEFAULT now(),

  -- NULL means open. There is no 'dismissed' state and no boolean: a timestamp
  -- answers both "is it open" and "when did it stop being open" with one column
  -- that cannot disagree with itself.
  acknowledged_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alerts_ack_after_raise CHECK (
    acknowledged_at IS NULL OR acknowledged_at >= raised_at
  )
);

-- The dedupe guard. Partial on acknowledged_at IS NULL so that acknowledging an
-- alert frees the slot for the same condition to be raised again later, which is
-- the normal case: utilization drops, is acted on, and drops again next quarter.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open
  ON alerts (org_id, client_id, kind)
  WHERE acknowledged_at IS NULL;

-- The screen's query: one client's alerts, newest first.
CREATE INDEX IF NOT EXISTS idx_alerts_client
  ON alerts (org_id, client_id, raised_at DESC);

-- The queue's query: everything still open across the book, worst first.
CREATE INDEX IF NOT EXISTS idx_alerts_open
  ON alerts (org_id, severity, raised_at DESC)
  WHERE acknowledged_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_alerts_updated_at'
                        AND tgrelid = 'public.alerts'::regclass) THEN
    CREATE TRIGGER trg_alerts_updated_at BEFORE UPDATE ON alerts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE alerts IS
  'Observations worth a person''s attention, one row per (client, kind) while open. Written by src/finance/alerts.mjs; the conditions live in upsell_trigger_rules (079), never in code. Nothing in this platform sends an alert anywhere — this table is read, not delivered.';

COMMENT ON COLUMN alerts.payload IS
  'Metrics that were true plus rule_snapshot, the thresholds frozen at raise time. No customer-facing claim text: wording about a credit outcome is a human decision (CLAUDE.md §7).';
