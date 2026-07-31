-- 080_plaid_items.sql — one row per bank login a client has connected.
--
-- WHAT A "PLAID ITEM" IS. In Plaid's model an Item is ONE set of credentials at
-- ONE financial institution. It is not an account. A client who logs into Chase
-- once and exposes a checking account, a savings account and a Chase credit card
-- has ONE Item and THREE accounts. Getting this wrong — one row per account,
-- with the credential duplicated onto each — would mean a single revoke leaves
-- live copies of a credential behind on sibling rows. Hence: Item here, accounts
-- in 081, one-to-many.
--
-- NOTHING IN THIS REPO TALKS TO PLAID. There is no HTTP client, no webhook
-- route, no scheduler, and none may be added under src/adapters/ or src/lib/ —
-- every adapter in this codebase is an INBOUND PARSER. src/adapters/plaid.mjs
-- holds two documented, EMPTY seams (linkAccount, getAccounts) that say where a
-- real Plaid client would plug in and why it is not here. This table therefore
-- starts, and will stay, empty until a human signs off. That is the intent, not
-- an unfinished state: SOC 2 review is required before any bank credential of a
-- real person is stored, and consent capture is a compliance-flagged area.
--
-- THE ACCESS TOKEN IS A CREDENTIAL AND ONLY CIPHERTEXT EXISTS HERE. A Plaid
-- access_token is long-lived read access to a person's bank account. A database
-- dump, a log line, a stack trace or one `SELECT *` in a read API each turn that
-- into an incident. So there is exactly one token column, it is named
-- `encrypted_access_token`, and a plaintext sibling MUST NEVER be added: the
-- moment one exists some SELECT * carries it into a JSON body. Encryption is
-- AES-256-GCM with THIS ROW'S id as additional authenticated data, following
-- src/adplatforms/tokens.mjs — so a ciphertext copied into another client's row
-- FAILS to decrypt instead of silently granting one client's bank access to
-- another. The database cannot catch a mis-joined UPDATE; the cipher can. An
-- unset PLAID_TOKEN_ENC_KEY stops the feature and never falls back to plaintext.
--
-- WHY NOT REUSE ad_platform_connections. That table is partner-scoped and holds
-- ad-account spend authority. This is client-scoped and holds bank read access.
-- Different owner, different blast radius, different retention answer, different
-- encryption key. One table with a `kind` column would put a person's bank
-- credential one bad WHERE clause away from a partner's ad token.
--
-- NULL MEANS UNKNOWN AND MUST SURVIVE. Every nullable column below says what its
-- NULL means. Note this is DIFFERENT from `entity_kind = 'unknown'` in migration
-- 082. NULL is "we have no record of this and never asked". 'unknown' is a
-- KNOWN-UNKNOWN: a value we deliberately wrote down to say "we asked, or we
-- know we must ask, and the answer is not yet established". The second is a
-- decision we are recording; the first is an absence. Collapsing them would lose
-- the difference between "never looked" and "looked and could not tell".

CREATE TABLE IF NOT EXISTS plaid_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Plaid's own identifier for the Item. NULL means: no real link has ever been
  -- made for this row — which today is every row, because the seams are empty.
  -- It is NOT "Plaid forgot the id"; a linked Item always has one.
  plaid_item_id      text,

  -- Plaid's institution identifier ("ins_56") and the human-readable name we
  -- were told alongside it. NULL on either means we do not know which bank this
  -- is. That is a real state — a link can fail before the institution resolves —
  -- and a screen must say "unknown bank", never guess one.
  plaid_institution_id text,
  institution_name     text,

  -- CIPHERTEXT ONLY. Format `v1:<iv>:<tag>:<ciphertext>`, all base64, written by
  -- src/adapters/plaid.mjs. NULL means no credential is stored — the ordinary
  -- state for a row created before linking, and the state every row is in today.
  -- Never logged, never returned by any API response, never in an error message.
  encrypted_access_token text,

  --   unlinked — the row exists, no credential, no Plaid Item. Today's only state.
  --   pending  — a link flow was started and has not finished.
  --   active   — a credential is stored and Plaid last told us it works.
  --   error    — the credential needs the client to re-authenticate.
  --   revoked  — the client or the bank pulled access. Token must be cleared.
  -- Default is the honest one. A row must never appear connected by default.
  link_state    text NOT NULL DEFAULT 'unlinked'
                CHECK (link_state IN ('unlinked', 'pending', 'active', 'error', 'revoked')),

  -- WHEN THE CLIENT AGREED, not when we wrote the row. NULL means NO CONSENT IS
  -- ON RECORD, and that is the only correct default: consent that defaults to
  -- "given" is not consent. Nothing may read a client's bank data on a row where
  -- this is NULL. This column is compliance-flagged — see docs/compliance/.
  consent_granted_at timestamptz,

  -- What the client actually agreed to expose, as the product described it to
  -- them. Empty array means nothing has been agreed, not "everything".
  consent_scope  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Last failure Plaid reported, kept so a re-auth prompt can be specific.
  -- NULL means no failure has been recorded — not "healthy". Health is
  -- link_state's job; this column only ever explains a bad one.
  last_error_code text,
  last_error_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The screen's query: every bank login for one client.
CREATE INDEX IF NOT EXISTS idx_plaid_items_client
  ON plaid_items (client_id, created_at DESC);

-- Re-running a link for the same Item must update the row, not stack a second
-- credential for the same bank login. Partial, because plaid_item_id is NULL on
-- every row until a real link happens, and NULLs would otherwise be free to
-- collide — Postgres treats them as distinct, so an unpartitioned unique index
-- here would enforce nothing at all where it matters and nothing where it does.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plaid_items_item
  ON plaid_items (org_id, plaid_item_id)
  WHERE plaid_item_id IS NOT NULL;
