-- 080_plaid_items.sql — the Plaid Link Item: one bank connection per client,
-- and the audit trail for every time the platform uses it.
--
-- WHY THIS EXISTS. The Finance OS needs a client's real bank balances. The only
-- sanctioned way to get them is Plaid Link: the client authenticates with their
-- own bank, inside the bank's own flow, and we are handed an opaque token. There
-- is no credential-scraping path and no browser extension in this design, now or
-- later. That is a hard rule and this table is shaped to make the alternative
-- impossible to represent: there is no username column, no password column, and
-- no place to put one.
--
-- THE ACCESS TOKEN IS A CREDENTIAL, AND ONLY CIPHERTEXT LIVES HERE. A Plaid
-- access token is a standing key to a named human's bank account. A database
-- dump, a log line, a stack trace or one careless `SELECT *` in a read endpoint
-- each turn that into an incident that must be reported to the client. So the
-- column is `access_token_enc`, it holds AES-256-GCM output produced by
-- src/banking/index.mjs, and A PLAINTEXT SIBLING COLUMN MUST NEVER BE ADDED. The
-- moment one exists some `SELECT *` will carry it into a JSON response body.
-- Same discipline as 046_ad_platforms.sql's encrypted_access_token, and the same
-- reason.
--
-- THE CIPHERTEXT IS BOUND TO THE CLIENT. src/pii/index.mjs binds an SSN's
-- ciphertext to its client id as additional authenticated data, so a row copied
-- into another client's record FAILS to decrypt instead of silently becoming
-- that person's SSN. A bank token deserves the same protection for the same
-- reason: a bad backfill or a mis-joined UPDATE that hands one client's live
-- bank credential to another client's file is not a bug the database can catch,
-- and every downstream check would pass because the token really is valid. The
-- cipher can catch it. It does.
--
-- ITEM_ID IS SCOPED PER ORG, NOT GLOBALLY UNIQUE. Plaid's item_id is unique
-- within a Plaid client id, and a globally UNIQUE constraint here would mean one
-- org linking an institution could block another org from ever linking it. Every
-- key in this file is (org_id, ...). This has bitten the repo before; it does
-- not bite here.
--
-- STATUS IS NOT DECORATION, IT IS THE REASON A SYNC RETURNED NOTHING. Plaid
-- items rot. A client changes their bank password, the bank's consent window
-- lapses, the client revokes access from inside their banking app. Each of those
-- produces a different, actionable message ("re-link your bank" is not the same
-- instruction as "your consent expired"), and a single boolean would flatten all
-- of them into "broken". The values below are the states the platform must be
-- able to tell apart, and `last_error_code` keeps Plaid's own words so a support
-- conversation is not conducted through our paraphrase of them.
--
-- CONSENT HAS AN EXPIRY AND IT IS A REAL DATE. Under open-banking rules a
-- client's authorisation is time-boxed; Plaid returns `consent_expiration_time`
-- on the item. NULL here means Plaid did not give us one, NOT "never expires".
-- Those are opposite facts and the column must be able to say which it is, so
-- there is no default and no backfill. A NULL that is quietly treated as
-- "forever" is how a platform keeps pulling a person's bank data after they
-- stopped agreeing to it.
--
-- READING SOMEONE'S BANK DATA IS AN EVENT. `plaid_sync_audit` at the bottom of
-- this file is append-only and records who triggered each use of the token,
-- which item it touched, what came back and when. It is written on failure as
-- well as on success — a sync that errored still means somebody asked to read a
-- client's finances, and that attempt is exactly what an audit needs to see.
-- Same reasoning as pii_access_log in 001_init.sql: an access-logged system
-- whose logging is best-effort is an unlogged system with paperwork.

-- ---------------------------------------------------------------------------
-- A. plaid_items — one linked bank connection
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plaid_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Plaid's identifier for this Item. Stable for the life of the link and the
  -- key every Plaid webhook arrives carrying.
  item_id      text NOT NULL,

  -- CIPHERTEXT ONLY. `v1:<iv>:<tag>:<ct>`, base64 parts, AES-256-GCM with the
  -- client id as additional authenticated data — the exact envelope
  -- src/pii/index.mjs uses for an SSN. Written and read only by
  -- src/banking/index.mjs. Never projected by an API response, never logged,
  -- never placed in an error message.
  --
  -- Nullable ON PURPOSE, for one narrow case: an item whose token we have
  -- deliberately destroyed (client withdrew consent, item removed at Plaid).
  -- The row survives so the audit trail still points at something real; the
  -- credential does not. A NOT NULL here would force us to either keep dead
  -- credentials or delete the audit subject.
  access_token_enc text,

  -- The bank, as Plaid names it. `institution_id` is Plaid's stable key;
  -- `institution_name` is what a human recognises and is what a screen shows.
  -- Both nullable: Plaid does not always return institution metadata on
  -- exchange, and an absent name must stay absent rather than become the string
  -- "Unknown Bank" that then gets rendered as though it were the truth.
  institution_id   text,
  institution_name text,

  --   active            — the token works; syncs are expected to succeed.
  --   login_required    — the client's bank credentials changed. Plaid's
  --                       ITEM_LOGIN_REQUIRED. Only the client can fix it, by
  --                       re-linking. Retrying on a schedule cannot help.
  --   pending_expiration — consent is about to lapse. Still usable today.
  --   revoked           — the client turned access off, or we removed the item.
  --                       Terminal. Never retry; ask for a fresh link.
  --   error             — Plaid returned something else. `last_error_code`
  --                       carries Plaid's own code so the case can be triaged
  --                       instead of guessed at.
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','login_required','pending_expiration','revoked','error')),

  -- Plaid's error code and its own message, verbatim. Not our rewording: a
  -- rewritten provider error is a provider error nobody can act on or search
  -- for. Never contains the access token — src/adapters/plaid.mjs scrubs it
  -- before the string can reach this column.
  last_error_code    text,
  last_error_message text,

  -- Plaid's item.consent_expiration_time. NULL MEANS PLAID DID NOT TELL US, and
  -- must never be read as "no expiry" — see the header. No default, deliberately.
  consent_expires_at timestamptz,

  -- When we last successfully pulled balances through this item. NULL means
  -- never, which is a different fact from "long ago" and stays distinguishable.
  last_synced_at     timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-org, NOT global. Re-linking the same institution must update the item
-- rather than accumulate a second live token for the same bank account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plaid_items_org_item
  ON plaid_items (org_id, item_id);

-- The read every screen and every sync does: this client's links, newest first.
CREATE INDEX IF NOT EXISTS idx_plaid_items_client
  ON plaid_items (client_id, created_at DESC);

-- The operator's read: what needs the client's attention right now. Partial,
-- because 'active' is the overwhelming majority and indexing it is wasted work.
CREATE INDEX IF NOT EXISTS idx_plaid_items_attention
  ON plaid_items (org_id, status)
  WHERE status <> 'active';

-- ---------------------------------------------------------------------------
-- B. plaid_sync_audit — every use of the token, attributable
-- ---------------------------------------------------------------------------
--
-- APPEND-ONLY. No status column to flip, no row to update. An audit trail whose
-- rows can be edited answers "what does the system currently claim happened",
-- which is not the question an audit asks.

CREATE TABLE IF NOT EXISTS plaid_sync_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- Nullable: a token exchange that FAILS never produces an item row, and that
  -- attempt is precisely the one an audit wants to see. ON DELETE SET NULL
  -- rather than CASCADE — removing a bank link must not erase the record that
  -- somebody read that client's finances.
  plaid_item_id uuid REFERENCES plaid_items(id) ON DELETE SET NULL,

  -- Kept even when the item row is gone, so the trail still names a person.
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,

  --   exchange       — a public_token was traded for an access token. The moment
  --                    a standing credential came into existence.
  --   accounts_sync  — balances were read.
  action        text NOT NULL CHECK (action IN ('exchange','accounts_sync')),

  -- WHO. The staff id from the session, never a name out of a request body: an
  -- attributable log entry cannot let the caller choose its own attribution.
  -- Text rather than a uuid FK so a future scheduled sync can write the literal
  -- 'system' without inventing a staff row for a machine.
  triggered_by      text NOT NULL,
  triggered_by_kind text NOT NULL DEFAULT 'staff'
                    CHECK (triggered_by_kind IN ('staff','system')),

  -- WHAT CAME BACK.
  outcome       text NOT NULL CHECK (outcome IN ('ok','error')),
  -- How many accounts the call returned. NULL on a failure — zero accounts and
  -- "the call never got that far" are different, and 0 would assert the first.
  account_count integer CHECK (account_count >= 0),
  -- Plaid echoes a request_id on every response, including errors. It is the
  -- only handle Plaid support can act on, so it is stored rather than logged.
  request_id    text,
  error_code    text,
  error_message text,

  -- The redacted shape of the response: account ids, masks, types, whether a
  -- balance was present. NEVER the access token, and never a full account
  -- number — Plaid does not return one on this endpoint and nothing may add it.
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- "Who has read this client's bank data, newest first" — the question an audit
-- actually asks, answered by one index.
CREATE INDEX IF NOT EXISTS idx_plaid_sync_audit_client
  ON plaid_sync_audit (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plaid_sync_audit_item
  ON plaid_sync_audit (plaid_item_id, created_at DESC);

-- Failure triage: every error across the org, newest first.
CREATE INDEX IF NOT EXISTS idx_plaid_sync_audit_errors
  ON plaid_sync_audit (org_id, created_at DESC)
  WHERE outcome = 'error';
