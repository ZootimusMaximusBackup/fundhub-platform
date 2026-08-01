-- 106_entities.sql — a client can be more than one wallet.
--
-- Today a client has bank accounts, cards, and holdings, but no way to say
-- "these three accounts are my business, this one card is personal." This adds
-- that grouping layer: `entities`, one-to-many under a client, exactly the way
-- `businesses` (001_init.sql) already groups age/entity_data under a client.
--
-- ADDITIVE, NOT BREAKING. Every new FK is nullable. Existing rows keep working
-- with entity_id = NULL, meaning "not yet assigned to an entity" — the same
-- honest-unknown pattern as 082_bank_account_entity_kind.sql, not a forced
-- guess. Nothing existing is renamed, dropped, or re-typed.
--
-- ENTITIES VS `businesses`. `businesses` already exists and holds
-- age_months/entity_data for a client's company. This migration does not
-- replace it — `entities` is the account-grouping/scoping concept the finance
-- screens need ("which accounts belong together"), while `businesses` remains
-- whatever business-profile data was already being kept. A later migration can
-- link them (entities.business_id) once someone decides that's wanted; doing
-- it here would be inventing a merge nobody asked for.

CREATE TABLE IF NOT EXISTS entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('personal', 'business')),
  name        text NOT NULL,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'entities' AND trigger_name = 'entities_set_updated_at'
  ) THEN
    CREATE TRIGGER entities_set_updated_at
      BEFORE UPDATE ON entities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- One personal entity per client is the common case, not a rule enforced here.
-- Callers create it explicitly (see api/finance/entities.mjs) rather than a
-- trigger auto-creating one, so a client with no entities yet is an honest
-- "not set up," matching the entity_kind_source discipline in 082.

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_entity ON bank_accounts(entity_id);

ALTER TABLE recurring_bills ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
CREATE INDEX IF NOT EXISTS idx_recurring_bills_entity ON recurring_bills(entity_id);

-- tradelines carries the LIVE card figures (credit_limit_cents, balance_cents —
-- src/finance/os-grid.mjs computes the seven-row grid straight off this table)
-- and is what api/finance/liabilities.mjs's add_card writes to. entity_id goes
-- here, not on card_liabilities, which is a separate history/CRS-observation
-- table money-map reads for statement dates and does not hold the figure a
-- roll-up dashboard needs.
ALTER TABLE tradelines ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
CREATE INDEX IF NOT EXISTS idx_tradelines_entity ON tradelines(entity_id);

-- card_liabilities gets it too, additively, so a screen reading a card's
-- CRS-observed history (money-map.html) can filter by entity the same way.
ALTER TABLE card_liabilities ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
CREATE INDEX IF NOT EXISTS idx_card_liabilities_entity ON card_liabilities(entity_id);

-- investment_holdings hangs off bank_accounts (098_investment_holdings.sql),
-- so it inherits entity scoping through bank_accounts.entity_id — no column
-- needed there.
