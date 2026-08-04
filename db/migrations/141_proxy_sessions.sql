-- 141_proxy_sessions.sql — Audit trail for Oxylabs residential Apply sessions.
--
-- Every Apply launch that opens a geo-targeted residential proxy is logged
-- here — this is the proof of which exit IP an application came from.

CREATE TABLE IF NOT EXISTS proxy_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id         uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  lender_id        uuid REFERENCES lenders(id) ON DELETE SET NULL,
  application_id   uuid REFERENCES applications(id) ON DELETE SET NULL,
  requested_city   text,
  requested_state  text,
  granted_city     text,
  granted_region   text,
  targeting_level  text,          -- 'city' | 'state' | null when failed early
  exit_ip          text,
  sessid           text NOT NULL,
  proxy_username   text,          -- full username string (no password)
  application_url  text,
  status           text NOT NULL DEFAULT 'verifying',
  -- verifying | active | ended | failed | mismatch
  error_code       text,
  error_message    text,
  verification     jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proxy_sessions_status_ck CHECK (
    status IN ('verifying', 'active', 'ended', 'failed', 'mismatch')
  ),
  CONSTRAINT proxy_sessions_level_ck CHECK (
    targeting_level IS NULL OR targeting_level IN ('city', 'state')
  )
);

CREATE INDEX IF NOT EXISTS proxy_sessions_org_started_idx
  ON proxy_sessions (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS proxy_sessions_client_idx
  ON proxy_sessions (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS proxy_sessions_staff_active_idx
  ON proxy_sessions (staff_id, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS proxy_sessions_sessid_idx
  ON proxy_sessions (org_id, sessid);

DROP TRIGGER IF EXISTS proxy_sessions_set_updated_at ON proxy_sessions;
CREATE TRIGGER proxy_sessions_set_updated_at
  BEFORE UPDATE ON proxy_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE proxy_sessions IS
  'Oxylabs residential proxy sessions for lender Apply. Audit trail of exit IP + city.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON proxy_sessions TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
