-- 081_bank_accounts.sql — one row per bank account under a linked Plaid Item.
--
-- WHY THIS EXISTS. 080 stores the connection. This stores what the connection
-- can see: the individual chequing, savings and credit accounts the client
-- authorised, with their balances. It is the data source under every "what does
-- this client actually have" question the Finance OS asks.
--
-- MONEY IS INTEGER CENTS, IN A bigint, WITH A _cents SUFFIX. Plaid returns
-- balances as floating-point dollars (`"current": 1234.56`). Carrying that into
-- the database as a float, or as a numeric that some later caller reads back as
-- a float, is how a balance becomes 1234.5599999999999 and a funding decision is
-- made on a number that does not equal the bank's. src/commissions/money.mjs
-- exists in this repo because of exactly that rounding, and 054_tradelines.sql
-- already made this call for credit limits. Same call here: cents in the column,
-- dollars only at the boundary, conversion in one place.
--
-- A NULL BALANCE IS A REAL ANSWER AND MUST SURVIVE. Plaid very frequently
-- returns `available: null` — credit cards often have no available figure, and
-- some institutions withhold it entirely. NULL means WE DO NOT KNOW. Zero means
-- THE ACCOUNT HAS NOTHING IN IT. Defaulting the first to the second would tell a
-- funding advisor that a client with an unknown balance has no money, which is
-- both wrong and wrong in the direction that denies someone funding. So: no
-- DEFAULT 0, no NOT NULL, and the CHECK below permits NULL by construction.
-- Note there is deliberately no `>= 0` constraint on the balances: a chequing
-- account can be overdrawn and a credit card's current balance is routinely
-- reported as a negative number. A constraint that rejects reality would make
-- the sync fail on ordinary accounts.
--
-- CURRENCY IS TWO COLUMNS BECAUSE PLAID RETURNS TWO. Plaid gives
-- `iso_currency_code` OR `unofficial_currency_code`, exactly one of them
-- non-null, and the unofficial one exists for things an ISO code cannot name.
-- Collapsing both into a single `currency` column would require deciding which
-- one won, and that decision would be invented rather than reported. Two
-- columns, mapped 1:1 from the provider, and the reader can see which kind of
-- answer it got.
--
-- NOTHING HERE IS DERIVED. No "total balance", no utilisation, no available
-- credit. Each is a function of columns already present, and storing it would
-- create a second answer that goes stale the moment a balance updates. Computed
-- at read time, in one place — the same rule 054_tradelines.sql set.
--
-- WHAT IS NOT IN THIS FILE. No transactions (W7 owns those), no liabilities or
-- card terms (W6), no projections (W8), and NO ACCOUNT NUMBERS. Plaid's
-- balance endpoint does not return a full account or routing number, and nothing
-- may add a column for one here: a table with nowhere to put a bank account
-- number cannot leak a bank account number.
--
-- `mask` IS NOT AN IDENTIFIER. It is the last two to four digits the bank prints
-- on a statement, it is nullable, and two accounts at the same bank can share
-- one. It exists so a human can tell "Chase ••4021" from "Chase ••9917" on a
-- screen. Joining or de-duplicating on it would silently merge two people's
-- accounts; `account_id` is the key, and it is the only key.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The link this account came through. CASCADE: an account has no meaning
  -- without its item, and a client who unlinks a bank expects the accounts to
  -- go with it. The audit trail in 080 is what survives, deliberately.
  plaid_item_id uuid NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,

  -- Plaid's account_id. Stable for the life of the Item and the only safe key
  -- for recognising the same account across successive syncs.
  account_id    text NOT NULL,

  -- Last few digits as the bank prints them. Display only — see the header.
  mask          text,

  -- `name` is what the client calls it ("Everyday Checking"); `official_name`
  -- is the bank's own full product name ("Chase Total Checking®"). Plaid
  -- returns both and they are frequently different. Both nullable: a missing
  -- official_name stays missing rather than being filled in from `name`, which
  -- would fabricate a bank's product naming.
  name           text,
  official_name  text,

  -- Plaid's taxonomy, stored verbatim and NOT constrained to an enum. This is a
  -- deliberate departure from the CHECK constraints elsewhere in this schema:
  -- `type` and `subtype` are a provider-owned vocabulary that Plaid extends
  -- without asking us, and a CHECK here would turn "Plaid added a subtype" into
  -- "every sync for that client now fails". The platform's own classification —
  -- the one the business logic actually branches on — is `entity_kind` in 082,
  -- which IS constrained, because that vocabulary is ours.
  --
  --   type:    depository | credit | loan | investment | brokerage | other
  --   subtype: checking | savings | credit card | money market | ...
  type          text,
  subtype       text,

  -- Balances, integer cents. NULL = unknown; see the header. bigint because a
  -- business account in cents overflows int4 at about $21m, which is not a
  -- ceiling to discover in production.
  current_balance_cents   bigint,
  available_balance_cents bigint,

  -- Exactly one of these is non-null on any account Plaid returns. Mapped 1:1
  -- from the provider rather than collapsed — see the header.
  iso_currency_code        text,
  unofficial_currency_code text,

  -- Plaid's balances.last_updated_datetime: WHEN THE BALANCE WAS TRUE, which is
  -- not when we wrote the row. Many institutions do not supply it, so NULL is
  -- ordinary and must not be backfilled with now() — that would assert the
  -- balance is current when nobody said so. `synced_at` below is our own clock
  -- and answers the different question of when we last asked.
  balance_as_of timestamptz,
  synced_at     timestamptz,

  -- Whether Plaid still returns this account under the item. An account the
  -- client closed disappears from the response; deleting our row would take its
  -- history with it, so it is marked instead. NULL = still present.
  closed_at     timestamptz,

  -- The unparsed account object, verbatim. When a mapping is disputed, this is
  -- what settles it. Written by src/banking/index.mjs, which strips nothing
  -- from it because Plaid's balance response contains no credential — the
  -- access token travels in the request, never in the reply.
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Re-syncing must UPDATE the account, never add a second copy of it. Scoped per
-- org, not globally unique: Plaid account ids are unique within a Plaid client
-- id, and a global constraint would let one org's link block another's.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_org_account
  ON bank_accounts (org_id, account_id);

-- The screen's query: every open account for one client.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_client
  ON bank_accounts (client_id, closed_at NULLS FIRST);

-- The sync's query: everything under one item, so a refresh can mark what
-- vanished without scanning the client's other links.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_item
  ON bank_accounts (plaid_item_id);
