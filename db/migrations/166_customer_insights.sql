-- 166_customer_insights.sql — mid check-in + post-funding interview answers.
--
-- Beta: staff save what the customer said. A round.funded handler creates a
-- funding-advisor task to run the Google Meet interview. Recording URLs are
-- stored when we have them; nothing records a call from this table.
--
-- Answers may later feed ads / VSL / landing pages. This migration only stores.
-- COMPLIANCE REVIEW REQUIRED: consent / marketing reuse of customer quotes.

CREATE TABLE IF NOT EXISTS customer_insights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  task_id        uuid REFERENCES tasks(id) ON DELETE SET NULL,
  stage          text NOT NULL,
  channel        text NOT NULL,
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes          text,
  meeting_url    text,
  recording_url  text,
  recorded_by    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_insights_stage_ck CHECK (stage IN ('mid', 'post')),
  CONSTRAINT customer_insights_channel_ck CHECK (
    channel IN ('call', 'ai_reachout', 'google_meet')
  )
);

CREATE INDEX IF NOT EXISTS customer_insights_org_client_idx
  ON customer_insights (org_id, client_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS customer_insights_org_stage_idx
  ON customer_insights (org_id, stage, occurred_at DESC);

DROP TRIGGER IF EXISTS customer_insights_set_updated_at ON customer_insights;
CREATE TRIGGER customer_insights_set_updated_at
  BEFORE UPDATE ON customer_insights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE customer_insights IS
  'Mid check-in and post-funding interview answers. Store only — not published to ads.';
COMMENT ON COLUMN customer_insights.recording_url IS
  'Optional recording link. Nothing in this table starts a recording.';

-- Supabase often enables RLS with zero policies on a new table (deny-all).
-- Same patch as 109 / 154 so fundhub_app can actually write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'customer_insights'
  ) THEN
    ALTER TABLE customer_insights ENABLE ROW LEVEL SECURITY;
    CREATE POLICY customer_insights_no_bare_rls ON customer_insights
      USING (true) WITH CHECK (true);
    ALTER TABLE customer_insights FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON customer_insights TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
