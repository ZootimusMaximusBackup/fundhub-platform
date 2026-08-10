-- 160_metro2_dispute_engine.sql
-- Metro 2 dispute cases/items/letters/responses + furnisher mail addresses.
-- W2 engine Units 5–6. pipeline_card_id nullable until W3 wires optimization cards.

CREATE TABLE IF NOT EXISTS furnisher_mail_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES orgs(id),
  name          text NOT NULL,
  name_norm     text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city          text NOT NULL,
  state         text NOT NULL,
  zip           text NOT NULL,
  country       text NOT NULL DEFAULT 'US',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name_norm)
);

CREATE TABLE IF NOT EXISTS dispute_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bureau            text NOT NULL CHECK (bureau IN ('EX','EQ','TU')),
  round             text NOT NULL DEFAULT 'R1' CHECK (round IN ('R1','R2','R3','FURNISHER')),
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','awaiting_response','round_complete','closed','stalled','cancelled')),
  pipeline_card_id  uuid,
  response_due_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispute_cases_client_idx ON dispute_cases (org_id, client_id);
CREATE INDEX IF NOT EXISTS dispute_cases_card_idx ON dispute_cases (pipeline_card_id);

CREATE TABLE IF NOT EXISTS dispute_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rule_id         text NOT NULL,
  severity        text NOT NULL,
  field           text,
  creditor        text,
  account_last4   text,
  round           text NOT NULL DEFAULT 'R1' CHECK (round IN ('R1','R2','R3','FURNISHER')),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','sent','verified','deleted','updated','unaddressed','closed','escalated')),
  violation       jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispute_items_case_idx ON dispute_items (case_id, status);

CREATE TABLE IF NOT EXISTS dispute_letters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES orgs(id),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bureau            text NOT NULL,
  round             text NOT NULL,
  status            text NOT NULL DEFAULT 'generated'
                    CHECK (status IN ('generated','variance_failed','ready','sent','delivered','failed')),
  body_text         text NOT NULL,
  fingerprint       text[] NOT NULL DEFAULT '{}',
  pdf_storage_key   text,
  postgrid_letter_id text,
  rule_ids          text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispute_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  raw_text        text,
  parse_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence      numeric(4,3),
  confirmed       boolean NOT NULL DEFAULT false,
  confirmed_at    timestamptz,
  confirmed_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_decision_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  case_id     uuid REFERENCES dispute_cases(id) ON DELETE SET NULL,
  decision    text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  reversible  boolean NOT NULL DEFAULT true,
  reversed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO furnisher_mail_addresses (org_id, name, name_norm, address_line1, city, state, zip)
SELECT NULL, v.name, v.name_norm, v.line1, v.city, v.state, v.zip
FROM (VALUES
  ('Midland Credit Management', 'midland credit management', 'P.O. Box 509176', 'San Diego', 'CA', '92150'),
  ('Portfolio Recovery Associates', 'portfolio recovery associates', 'P.O. Box 12914', 'Norfolk', 'VA', '23541'),
  ('LVNV Funding', 'lvnv funding', 'P.O. Box 10481', 'Greenville', 'SC', '29603'),
  ('Synchrony Bank', 'synchrony bank', 'P.O. Box 965008', 'Orlando', 'FL', '32896'),
  ('Capital One', 'capital one', 'P.O. Box 30281', 'Salt Lake City', 'UT', '84130')
) AS v(name, name_norm, line1, city, state, zip)
WHERE NOT EXISTS (
  SELECT 1 FROM furnisher_mail_addresses f WHERE f.name_norm = v.name_norm AND f.org_id IS NULL
);
