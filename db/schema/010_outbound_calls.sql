-- outbound_calls: records every Bland AI call dispatch so the completed-call
-- webhook can resolve callId → clientId without it in the Bland payload.
CREATE TABLE IF NOT EXISTS outbound_calls (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL,
  client_id   UUID        NOT NULL REFERENCES clients(id),
  call_id     TEXT        NOT NULL UNIQUE,
  kind        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'initiated',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_calls_call_id_idx ON outbound_calls(call_id);
CREATE INDEX IF NOT EXISTS outbound_calls_client_id_idx ON outbound_calls(client_id);
