-- 081_bank_accounts.sql — the accounts under a bank connection, and their
-- balances.
--
-- Accounts belong to a plaid_item (080), not to a client directly: one login can
-- carry a checking, two savings and a credit card, and losing that grouping
-- means losing the answer to "which of these dies when they change their bank
-- password".
--
--
-- *** A BALANCE WITHOUT A TIMESTAMP IS A LIE. ***
-- This is the rule this file exists to enforce. Bank balances are stale the
-- moment they are read. A screen that shows "$4,207.19" with no indication of
-- when that was true invites somebody to schedule a payment against a number
-- from nine days ago. So `balance_as_of` is NOT NULL whenever any balance is
-- present, enforced by a CHECK — a row cannot claim a balance and decline to say
-- when it was true.
--
--
-- EVERY BALANCE COLUMN IS NULLABLE AND NULL MEANS UNKNOWN, NEVER ZERO.
-- Plaid does not return every balance for every account type. `available` is
-- routinely absent on savings; `limit` is absent on everything that is not a
-- credit line. The failure to avoid is the obvious one: a NULL available balance
-- rendered as $0.00 tells someone they have no money, and a NULL current balance
-- rendered as $0.00 tells them they have no debt. Both are false statements
-- about a real person's finances, and this repo's standing rule — a missing
-- input yields null, never a guess — applies with full force here.
--
-- MONEY IS INTEGER CENTS, like tradelines (054) and subscriptions (075), and
-- unlike the older numeric(14,2) dollar columns. Balances get summed across
-- accounts and compared against bills; cents in the column, dollars at the
-- boundary.
--
-- SIGNED, NOT ABSOLUTE. Deposit balances are positive. A credit-card balance is
-- a debt and Plaid reports it as a positive number on a `credit` type account,
-- which is a different thing from $500 in a checking account. The `type` column
-- is what disambiguates, and no CHECK forces balances non-negative here: an
-- overdrawn checking account is a real negative balance and refusing it would
-- lose exactly the fact somebody most needs to see.
--
-- ENTITY KIND — the personal/business/unknown split — IS NOT IN THIS FILE. It
-- arrives in 082, which is where the three-state rule is written out.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- ON DELETE CASCADE: disconnecting the login removes the accounts it granted.
  -- Keeping orphaned accounts would leave balances on screen that nothing can
  -- ever refresh, which is the stale-number failure in its most permanent form.
  plaid_item_id uuid NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,

  -- Plaid's account_id. The idempotency key for a refresh.
  account_ref   text NOT NULL,

  -- What the consumer sees in their banking app. `name` is theirs ("Everyday
  -- Checking"), `official_name` is the institution's. Both nullable — an
  -- institution that returns neither is unusual, not impossible.
  name          text,
  official_name text,

  -- Last four of the account number. Display only, exactly like client_cards
  -- (076), and the same CHECK for the same reason: a full account number written
  -- into this column is refused by the database rather than found in a log.
  mask          text CHECK (mask ~ '^[0-9]{4}$'),

  --   depository — checking, savings, money market
  --   credit     — credit card, line of credit
  --   loan       — mortgage, student, auto
  --   investment — brokerage, retirement
  --   other      — Plaid's own catch-all, kept rather than forced into a guess
  type          text NOT NULL DEFAULT 'other'
                CHECK (type IN ('depository', 'credit', 'loan', 'investment', 'other')),

  -- Plaid's subtype ('checking', 'savings', 'credit card'). Free text: the
  -- vocabulary is the vendor's, it changes without notice, and a CHECK here
  -- would turn a new subtype into a failed sync.
  subtype       text,

  -- ALL NULLABLE. NULL = unknown, never 0. See the header.
  --   current   — the balance including pending
  --   available — spendable right now; routinely absent on savings
  --   limit     — the credit line; absent on anything that is not one
  balance_current_cents   bigint,
  balance_available_cents bigint,
  balance_limit_cents     bigint CHECK (balance_limit_cents >= 0),

  currency      text NOT NULL DEFAULT 'USD',

  -- When the balances above were true. See the header — this is the column that
  -- stops a stale number becoming a payment decision.
  balance_as_of timestamptz,

  --   open   — live
  --   closed — the institution closed it; kept for history
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed')),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per account per connection. A refresh updates; it does not accumulate
-- a second copy of the same checking account on every sync.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_item_account
  ON bank_accounts (plaid_item_id, account_ref);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_client
  ON bank_accounts (client_id, status);

-- THE RULE FROM THE HEADER, AS A CONSTRAINT. If any balance is present, the
-- moment it was true must be present too.
ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_balance_needs_asof;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_balance_needs_asof
  CHECK (
    (balance_current_cents IS NULL AND balance_available_cents IS NULL AND balance_limit_cents IS NULL)
    OR balance_as_of IS NOT NULL
  );

COMMENT ON TABLE bank_accounts IS
  'Accounts under a plaid_items connection (080), with balances in integer cents. EVERY balance column is nullable and NULL MEANS UNKNOWN, NEVER ZERO — a NULL available balance rendered as $0.00 tells someone they have no money. A balance may not be stored without balance_as_of. See db/migrations/081_bank_accounts.sql.';

COMMENT ON COLUMN bank_accounts.balance_as_of IS
  'When the balances were true. Required whenever any balance is set, by CHECK. A balance without a timestamp invites a payment scheduled against a nine-day-old number.';

COMMENT ON COLUMN bank_accounts.balance_available_cents IS
  'NULL = unknown, NOT zero. Routinely absent on savings accounts. Rendering NULL as $0.00 is a false statement about a real person finances.';

COMMENT ON COLUMN bank_accounts.mask IS
  'Last four only, display purposes. The CHECK exists so a full account number is refused at write time rather than discovered in a log.';
