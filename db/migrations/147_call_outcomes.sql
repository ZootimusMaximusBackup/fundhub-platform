-- 147_call_outcomes.sql — closer disposition log + marketing flag store.
--
-- Every held sales call needs a row. Cash collected is derived from the
-- payment/transaction record (cash_collected_cents + transaction_id), never
-- typed by the closer. belief_failed is Cole Gordon's seven-belief model —
-- objections are symptoms; the failed belief is the diagnosis.
--
-- call_compliance_flags is schema-only until call recording/transcription
-- exist. Screens must show an honest empty state, not fabricated talk ratios.

CREATE TABLE IF NOT EXISTS call_outcomes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id             uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  task_id              uuid REFERENCES tasks(id) ON DELETE SET NULL,
  booking_ref          text,
  outcome              text NOT NULL,
  belief_failed        text,
  cash_collected_cents integer NOT NULL DEFAULT 0,
  transaction_id       uuid REFERENCES transactions(id) ON DELETE SET NULL,
  recording_url        text,
  duration_seconds     integer,
  notes                text,
  logged_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_outcomes_outcome_ck CHECK (
    outcome IN ('deposit', 'downsell', 'callback', 'no_show', 'not_a_fit')
  ),
  CONSTRAINT call_outcomes_belief_ck CHECK (
    belief_failed IS NULL OR belief_failed IN (
      'pain', 'doubt', 'cost', 'desire', 'money', 'support', 'trust'
    )
  ),
  CONSTRAINT call_outcomes_cash_ck CHECK (cash_collected_cents >= 0),
  CONSTRAINT call_outcomes_duration_ck CHECK (
    duration_seconds IS NULL OR duration_seconds >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS call_outcomes_task_uniq
  ON call_outcomes (org_id, task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS call_outcomes_booking_uniq
  ON call_outcomes (org_id, booking_ref)
  WHERE booking_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_outcomes_org_logged_idx
  ON call_outcomes (org_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS call_outcomes_staff_logged_idx
  ON call_outcomes (org_id, staff_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS call_outcomes_belief_idx
  ON call_outcomes (org_id, belief_failed, logged_at DESC)
  WHERE belief_failed IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_outcomes_client_idx
  ON call_outcomes (client_id, logged_at DESC);

DROP TRIGGER IF EXISTS call_outcomes_set_updated_at ON call_outcomes;
CREATE TRIGGER call_outcomes_set_updated_at
  BEFORE UPDATE ON call_outcomes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE call_outcomes IS
  'Closer call dispositions. cash_collected_cents is derived from transactions, never hand-entered.';
COMMENT ON COLUMN call_outcomes.belief_failed IS
  'Cole Gordon seven-belief diagnosis: pain|doubt|cost|desire|money|support|trust. NULL = none.';
COMMENT ON COLUMN call_outcomes.cash_collected_cents IS
  'Integer cents copied from the linked paid transaction at log time. Not editable.';

-- Marketing routing flags: store only. No outbound send.
CREATE TABLE IF NOT EXISTS marketing_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  flagged_by      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  belief          text NOT NULL,
  lead_source     text,
  setter_label    text,
  outcome_count   integer NOT NULL DEFAULT 0,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_flags_belief_ck CHECK (
    belief IN ('pain', 'doubt', 'cost', 'desire', 'money', 'support', 'trust')
  ),
  CONSTRAINT marketing_flags_count_ck CHECK (outcome_count >= 0),
  CONSTRAINT marketing_flags_period_ck CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS marketing_flags_org_created_idx
  ON marketing_flags (org_id, created_at DESC);

COMMENT ON TABLE marketing_flags IS
  'Objection pattern flagged for marketing routing. Stored only — nothing is sent externally.';

-- Compliance flags from recordings/transcripts. Empty until that pipeline exists.
CREATE TABLE IF NOT EXISTS call_compliance_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  call_outcome_id uuid REFERENCES call_outcomes(id) ON DELETE CASCADE,
  staff_id        uuid REFERENCES staff(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  kind            text NOT NULL,
  phrase          text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  flagged_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_compliance_flags_kind_ck CHECK (
    kind IN (
      'guaranteed_language',
      'quote_before_pull',
      'month14_cliff_missed',
      'recording_disclosure_missed',
      'other'
    )
  )
);

CREATE INDEX IF NOT EXISTS call_compliance_flags_org_idx
  ON call_compliance_flags (org_id, flagged_at DESC);

COMMENT ON TABLE call_compliance_flags IS
  'Flagged phrases and missed disclosures from call recordings. Unused until recording/transcription ships.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON call_outcomes TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_flags TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON call_compliance_flags TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
