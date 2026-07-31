-- 085_bank_transactions.sql — the transaction ledger behind a connected account.
--
-- WHY IT EXISTS. Recurring bills (086) cannot be detected from balances. The
-- only evidence that a client pays $87.40 to an insurer every month is a list of
-- payments to that insurer, and this is that list.
--
--
-- SIGN CONVENTION, WRITTEN DOWN ONCE BECAUSE GETTING IT WRONG INVERTS EVERY
-- SCREEN. In this table:
--
--     amount_cents < 0  →  MONEY LEFT THE ACCOUNT   (a payment, a bill, a debit)
--     amount_cents > 0  →  MONEY ARRIVED            (a deposit, a refund)
--
-- This is the convention a person reading their own statement expects, and it is
-- NOT the convention Plaid uses — Plaid reports outflows as POSITIVE numbers.
-- The flip therefore happens exactly once, at the adapter boundary, and this
-- comment is here so the next person does not flip it a second time. A
-- double-flipped ledger shows every bill as income and every paycheck as a bill,
-- and every downstream total still adds up, which is why it survives review.
--
-- NO CHECK CONSTRAINS THE SIGN. Both directions are legitimate on every account
-- type, and a constraint would only encode the confusion above as law.
--
--
-- PENDING TRANSACTIONS ARE KEPT AND MARKED. A pending charge is real information
-- — it is money that is about to leave — but it can change amount or vanish
-- entirely. Dropping them loses the near-term picture a cash-flow screen needs;
-- treating them as settled produces a projection built partly on transactions
-- that never happened. So they are stored with `pending = true` and every reader
-- decides deliberately.
--
-- CATEGORY IS THE VENDOR'S AND IS NOT TRUSTED AS A FACT. Aggregator
-- categorisation is a guess with a good marketing department. It is stored
-- because it is useful for grouping, and it is never the basis on which
-- something becomes a bill — 086's detector works on merchant and cadence, not
-- on a category string.

CREATE TABLE IF NOT EXISTS bank_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- The aggregator's transaction id. The idempotency key: a re-sync of an
  -- overlapping window must not double every transaction in it, which would
  -- double every bill total on every screen.
  transaction_ref text NOT NULL,

  -- Signed. See the header. NOT NULL: a transaction whose amount is unknown is
  -- not a transaction, it is a gap, and storing it as one would silently drop
  -- money out of every sum computed over this table.
  amount_cents bigint NOT NULL,
  currency     text NOT NULL DEFAULT 'USD',

  -- When it happened. NOT NULL for the same reason: an undated transaction
  -- cannot participate in a cadence, which is the only thing this table is for.
  posted_date  date NOT NULL,

  -- The raw description off the statement, and the aggregator's cleaned-up
  -- merchant name. BOTH are kept: `name` is what the client will recognise when
  -- they query a bill, `merchant_name` is what the detector groups on, and
  -- collapsing them means one of those two jobs gets done badly.
  name          text,
  merchant_name text,

  -- The vendor's guess. See the header — useful for grouping, never a fact.
  category      text,

  -- See the header. NOT NULL with a default because "we do not know if this
  -- settled" is not a state an aggregator ever reports.
  pending       boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per aggregator transaction. Scoped to the account, because ids are
-- only unique within a connection.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_ref
  ON bank_transactions (bank_account_id, transaction_ref);

-- The detector's read: one client's outflows over a window, oldest first.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_client_date
  ON bank_transactions (client_id, posted_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date
  ON bank_transactions (bank_account_id, posted_date DESC);

-- Grouping by merchant is the detector's hot path; a partial index keeps it off
-- the incoming half of the ledger, which it never looks at.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_merchant
  ON bank_transactions (client_id, lower(merchant_name), posted_date)
  WHERE amount_cents < 0 AND merchant_name IS NOT NULL;

COMMENT ON TABLE bank_transactions IS
  'Transaction ledger behind a connected account, and the only evidence recurring bills (086) can be detected from. SIGN: negative = money LEFT the account, positive = money arrived. This is NOT Plaid convention (Plaid reports outflows as positive); the flip happens once, at the adapter boundary. A double-flipped ledger shows every bill as income and still adds up, which is why it survives review. See db/migrations/085_bank_transactions.sql.';

COMMENT ON COLUMN bank_transactions.amount_cents IS
  'Signed integer cents. NEGATIVE = outflow. NOT NULL: a transaction with an unknown amount is a gap, and storing it would silently drop money out of every sum over this table.';

COMMENT ON COLUMN bank_transactions.pending IS
  'Pending transactions are kept and marked, never dropped and never treated as settled. Dropping loses the near-term picture; treating as settled projects on transactions that may never happen.';

COMMENT ON COLUMN bank_transactions.category IS
  'The aggregator guess. Stored for grouping, never the basis on which something becomes a bill — the detector works on merchant and cadence.';
