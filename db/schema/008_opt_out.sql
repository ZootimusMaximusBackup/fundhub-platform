-- 008_opt_out.sql — TCPA opt-out audit log
-- Separate table (not a flag on clients) for immutable audit trail per channel.
-- dnd_sms on clients is a GHL mirror field; this table is the authoritative
-- opt-out record for FundHub's own send path.

CREATE TABLE opt_outs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES clients(id),
  org_id        uuid        NOT NULL,
  channel       text        NOT NULL,          -- 'sms' | 'email' | 'voice'
  opted_out_at  timestamptz NOT NULL DEFAULT now(),
  opted_in_at   timestamptz,                   -- set by START/UNSTOP; NULL = still opted out
  source        text        NOT NULL DEFAULT 'inbound_keyword',  -- 'inbound_keyword' | 'api' | 'manual'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX opt_outs_client_channel ON opt_outs (client_id, channel);
CREATE INDEX opt_outs_org ON opt_outs (org_id);

CREATE TRIGGER opt_outs_updated_at
  BEFORE UPDATE ON opt_outs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
