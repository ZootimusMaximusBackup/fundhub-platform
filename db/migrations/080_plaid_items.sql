-- 080_plaid_items.sql — one row per bank connection a client has authorised.
--
-- *** COMPLIANCE REVIEW REQUIRED — SOC 2. ***
-- This table is the doorway to a consumer's live bank data. Before any of it is
-- switched on, the controls a bank-data aggregator contractually requires have
-- to actually exist and be evidenced, not merely intended:
--
--   * Access control and least privilege on every read path that touches these
--     rows and the accounts underneath them.
--   * Audit logging of access to consumer financial data. `pii_access_log`
--     (001_init.sql:93) is the existing pattern and there is NO equivalent for
--     bank data yet. That gap is real and is named here rather than assumed.
--   * Encryption at rest and in transit. The access token below is encrypted at
--     rest by src/banking/plaid.mjs; the database's own at-rest encryption is an
--     infrastructure control and is not this file's to claim.
--   * Data retention and deletion — how long balances live, and what a
--     disconnect actually removes. Not decided anywhere yet.
--   * Incident response and vendor management.
--
-- None of that is code, and none of it is done. Building the schema first is
-- correct — you cannot review a control over a table that does not exist — but
-- the schema existing is not the review passing.
--
--
-- WHAT A PLAID ITEM IS. An "Item" is one login at one institution. It can carry
-- many accounts (a checking, two savings, a credit card), which is why accounts
-- live in their own table (081) with a FK back to here rather than being columns
-- on this one.
--
-- THE ACCESS TOKEN IS THE MOST DANGEROUS VALUE IN THIS DATABASE.
-- It is a long-lived credential granting read access to a real person's bank
-- account. It is stored ENCRYPTED, never as plaintext, in `access_token_enc`,
-- by src/banking/plaid.mjs — which follows the pattern already established by
-- src/adplatforms/tokens.mjs and src/pii/index.mjs: AES-256-GCM, key from an
-- environment variable, and the row's own id bound in as additional
-- authenticated data so a token copied into another client's row FAILS to
-- decrypt rather than silently granting access to the wrong person's bank.
--
-- An unset key stops the feature. It never falls back to plaintext. That rule is
-- in the module, not here, but it is the reason this column is bytea-shaped text
-- and not a friendly `access_token`.
--
-- NOTHING HERE CONNECTS TO ANYTHING. There is no outbound fetch in
-- src/adapters/ or src/lib/ and this migration does not add one. src/banking/
-- plaid.mjs is a documented, empty seam. This table is where a connection would
-- be recorded if one were ever made.

CREATE TABLE IF NOT EXISTS plaid_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Plaid's own identifier for the Item. The idempotency key: re-running a link
  -- for the same Item must update this row, not create a second one.
  item_id      text NOT NULL,

  -- ENCRYPTED. See the header. Never selected into a read API, never logged,
  -- never in an error message. Named `_enc` so a SELECT * in a review reads as
  -- obviously sensitive rather than as an ordinary string column.
  access_token_enc text,

  institution_id   text,
  institution_name text,

  --   good         — connected and syncing
  --   login_required — the consumer must re-authenticate
  --   error        — Plaid reported a problem (see error_code)
  --   disconnected — we or they ended it
  -- login_required is separate from error deliberately: it is the normal,
  -- expected end of a connection's life and a screen must be able to say
  -- "reconnect your bank" rather than "something went wrong".
  status       text NOT NULL DEFAULT 'good'
               CHECK (status IN ('good', 'login_required', 'error', 'disconnected')),
  error_code   text,

  -- The consent this connection rests on, and when it ends. Both NULLABLE
  -- because the seam does not capture them yet — a visible gap, exactly like
  -- 077's consent_document_id, and not a passing grade.
  consent_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  consent_expires_at  timestamptz,

  -- When accounts under this item were last refreshed. NULL means never, which
  -- is different from "refreshed and nothing changed", and a screen must not
  -- render a NULL here as "up to date".
  last_synced_at timestamptz,

  linked_at    timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per Plaid Item. Not partial: item_id is NOT NULL and Plaid assigns it,
-- so there is no "we could not tell them apart" case to leave room for.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plaid_items_item_id
  ON plaid_items (item_id);

CREATE INDEX IF NOT EXISTS idx_plaid_items_client
  ON plaid_items (client_id, status);

-- A disconnected item must say when. Otherwise "when did we stop having access
-- to this person's bank" is unanswerable, which is a question a SOC 2 audit and
-- a consumer both ask.
ALTER TABLE plaid_items DROP CONSTRAINT IF EXISTS plaid_items_disconnected_timestamp;
ALTER TABLE plaid_items ADD CONSTRAINT plaid_items_disconnected_timestamp
  CHECK (status <> 'disconnected' OR disconnected_at IS NOT NULL);

COMMENT ON TABLE plaid_items IS
  'One authorised bank connection (a Plaid Item) per row; its accounts live in bank_accounts (081). COMPLIANCE: SOC 2 controls are NOT in place — there is no access log for bank data equivalent to pii_access_log, and retention/deletion is undecided. NOTHING HERE CONNECTS TO ANYTHING; src/banking/plaid.mjs is an empty documented seam. See db/migrations/080_plaid_items.sql.';

COMMENT ON COLUMN plaid_items.access_token_enc IS
  'ENCRYPTED AT REST (AES-256-GCM, key from env, row id as AAD) by src/banking/plaid.mjs. A long-lived credential to a real person bank account: never selected into a read API, never logged, never in an error message. An unset key stops the feature and never falls back to plaintext.';

COMMENT ON COLUMN plaid_items.last_synced_at IS
  'NULL = never synced, which is NOT the same as "synced and unchanged". Never render NULL as up to date.';
