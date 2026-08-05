-- 145_webhook_captures.sql — raw inbound webhook payloads for adapter correction.
--
-- Renumbered at merge from t142_webhook_captures.sql → 145 (main max was 143).
--
-- Capture raw inbound webhook payloads for adapter correction (CF Classic vs 2.0).
CREATE TABLE IF NOT EXISTS webhook_captures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES orgs(id),
  provider    text NOT NULL,
  headers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_body    text NOT NULL,
  parsed      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_captures_provider_idx
  ON webhook_captures (provider, created_at DESC);
