-- 081_bank_accounts.sql — the individual accounts behind a bank login.
--
-- ONE ROW PER ACCOUNT, MANY PER plaid_items ROW. See 080's header: an Item is a
-- login, an account is a chequing/savings/credit line inside it. Splitting them
-- means revoking a login clears exactly one credential and every account under
-- it goes with it — ON DELETE CASCADE below is doing that work.
--
-- THIS IS NOT tradelines AND NOT bank_transactions. `tradelines` (054) is
-- credit-card data off a soft pull, feeding the funding waterfall. This table is
-- deposit and liability accounts read from a bank connection. They will overlap
-- for credit cards and that is fine — they have different provenance and
-- different trust levels, and a closer must always be able to tell which number
-- came from a bureau file and which came from the bank. Transaction-level rows
-- are deliberately absent: a separate workflow owns `bank_transactions`, and
-- this table must not grow a `transactions jsonb` column in the meantime.
--
-- MONEY IS INTEGER CENTS. src/commissions/money.mjs exists because numeric
-- dollars multiplied and summed produce a report that is off by a penny and a
-- human who stops trusting the system. New table, so it starts correct: bigint
-- cents in the column, dollars only at the edge.
--
-- BALANCES ARE NOT CONSTRAINED NON-NEGATIVE, ON PURPOSE. A chequing account can
-- be overdrawn and a credit card's "available" can go negative when it is over
-- limit. A CHECK (>= 0) here would reject the exact accounts a funding decision
-- most needs to see, and whoever hit it would "fix" it by clamping to zero —
-- which is a lie about a client's finances. The sign is data.
--
-- NULL MEANS UNKNOWN AND MUST SURVIVE. Called out per column below. A NULL
-- balance is "the bank did not tell us", which is a different answer from a zero
-- balance, and the difference decides whether someone gets funded. Nothing may
-- COALESCE these to 0. Distinct again from `entity_kind = 'unknown'` in 082,
-- which is a known-unknown we write down deliberately — see that file.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The login this account came through. NULL means the row was entered by hand
  -- rather than read from a bank connection — a real and expected case, because
  -- nothing in this repo can talk to Plaid yet. It is NOT "we lost the link".
  plaid_item_id  uuid REFERENCES plaid_items(id) ON DELETE CASCADE,

  -- Plaid's per-account identifier. NULL for a hand-entered account. Paired with
  -- plaid_item_id in the unique index below so a re-read updates the account
  -- instead of adding a duplicate every time.
  plaid_account_id text,

  -- What the client would call it ("Business Checking") and, where the bank gave
  -- one, its formal name. NULL on either means we were not told. Never fill
  -- these with a placeholder — a screen showing "Account" is honest, a screen
  -- showing an invented name is not.
  name           text,
  official_name  text,

  -- Last 2-4 digits, the only account-number fragment that may be stored here.
  -- There is no full account number and no routing number column, and neither
  -- may be added to this table: those are payment credentials, they belong
  -- nowhere near a table read by dashboards, and storing them changes what
  -- compliance obligations this system is under. NULL means the bank did not
  -- expose a mask.
  mask           text,

  --   depository — chequing, savings, money market.
  --   credit     — credit card, charge card.
  --   loan       — instalment debt.
  --   investment — brokerage, retirement.
  --   other      — the bank told us something we do not model.
  -- NULL means the bank told us NOTHING about the type. That is distinct from
  -- 'other', which means it told us something unrecognised. Both are real; a
  -- default of 'depository' would quietly turn an unclassified line of credit
  -- into cash on hand, so there is no default.
  account_type   text CHECK (account_type IS NULL OR account_type IN
                   ('depository', 'credit', 'loan', 'investment', 'other')),

  -- The bank's own finer classification, verbatim, unconstrained. Kept raw
  -- because bank vocabularies differ and a CHECK here would reject real data.
  account_subtype text,

  -- ISO 4217, e.g. 'USD'. NULL means unknown — and an amount whose currency is
  -- unknown must never be added to one whose currency is known.
  currency_code  text,

  -- Balances in integer cents. NULL means the bank did not report that figure.
  --   available — spendable right now (deposits) or remaining headroom (credit).
  --   current   — the ledger figure, which lags pending activity.
  --   limit     — the credit line, NULL and meaningless on a deposit account.
  available_balance_cents bigint,
  current_balance_cents   bigint,
  credit_limit_cents      bigint,

  -- When those balances were TRUE, which is not when we wrote the row. A read
  -- taken Monday and stored Wednesday describes Monday. NULL means we do not
  -- know how stale the figures are, which is itself a reason not to rely on them.
  balance_as_of  timestamptz,

  -- The unparsed record as received, kept verbatim. When a reading is disputed
  -- this is what settles it. Never contains a credential — the access token
  -- lives encrypted on plaid_items and is stripped before anything lands here.
  raw            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- NULL means the account is not known to be closed. It is NOT proof it is open.
  closed_at      timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The screen's query: every account for one client, newest first.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_client
  ON bank_accounts (client_id, created_at DESC);

-- Every account under one login, for the revoke/refresh path.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_item
  ON bank_accounts (plaid_item_id)
  WHERE plaid_item_id IS NOT NULL;

-- Re-reading a connection must update each account, not append a copy of it per
-- read. Partial for the same reason as 080's: both columns are NULL on every
-- hand-entered row, and NULLs do not collide in Postgres, so an unpartitioned
-- unique index would let duplicates through anyway while blocking legitimate
-- manual entry.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_plaid
  ON bank_accounts (plaid_item_id, plaid_account_id)
  WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL;
