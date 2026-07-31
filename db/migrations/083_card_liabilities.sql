-- 083_card_liabilities.sql — what a credit card actually costs and when it is
-- due.
--
-- WHY THIS IS NOT `tradelines` (054) AND NOT `bank_accounts` (081).
--
--   tradelines      — a credit line read off a BUREAU SOFT PULL. Limits,
--                     balances, APR. It is a snapshot of what the bureau
--                     reported, and bureaus report a card's balance as of
--                     whenever the issuer last furnished it — often 30+ days
--                     stale, and never with a due date.
--   bank_accounts   — the ACCOUNT, from the bank connection. Name, mask, type,
--                     current balance.
--   card_liabilities— the TERMS AND THE CALENDAR on a connected credit account:
--                     statement balance, minimum payment, WHEN IT IS DUE.
--
-- The due date is the reason this table exists. Nothing else in this schema
-- holds one, and a payment-timing screen without a due date has nothing to say.
--
--
-- *** A DUE DATE THAT IS NOT KNOWN IS NULL, AND NULL IS NOT TODAY. ***
-- This is the rule that matters most here and it is worth stating before the
-- columns. Every date and every amount below is nullable, because Plaid returns
-- them inconsistently across issuers — `next_payment_due_date` is routinely
-- absent, `minimum_payment_amount` more so. The failure to avoid is a screen
-- that renders a missing due date as today, or as the 15th, or as "soon". That
-- is not a display bug: it is telling somebody when to move their money, on
-- the strength of a value nobody ever supplied.
--
-- APR IS A FRACTION IN [0,1]. 0.1899 is 18.99%. NOT a percentage number. This
-- matches tradelines.apr (054) exactly and for the same reason: one conversion,
-- at the edge, in src/tradelines/index.mjs's readApr(), which refuses an
-- ambiguous value rather than clamping it. Two different APR conventions in one
-- schema is a bug that surfaces as a client being quoted the wrong interest.
--
-- MONEY IS INTEGER CENTS, like 054, 075 and 081.
--
-- ONE ROW PER ACCOUNT — THE CURRENT PICTURE. History is 084. This split is
-- deliberate: the screens read "what is due now" constantly and "how has this
-- changed" rarely, and a single append-only table would make the common read a
-- window function over an unbounded set.

CREATE TABLE IF NOT EXISTS card_liabilities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The account these terms belong to. CASCADE for the same reason as 081:
  -- disconnecting the bank must not leave a due date on screen that nothing can
  -- ever refresh.
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- ALL NULLABLE. NULL = unknown, never 0 and never today. See the header.
  last_statement_balance_cents bigint,
  last_statement_issue_date    date,
  minimum_payment_cents        bigint CHECK (minimum_payment_cents >= 0),

  -- THE COLUMN THIS TABLE EXISTS FOR. NULL is common and must survive as NULL
  -- all the way to the screen.
  next_payment_due_date        date,

  last_payment_amount_cents    bigint,
  last_payment_date            date,

  -- Plaid's own flag. NULLABLE on purpose: false and "we do not know" are
  -- different answers, and a three-state boolean is the honest shape. A NULL
  -- rendered as "not overdue" is a reassurance nobody earned.
  is_overdue                   boolean,

  -- The headline rate, as a fraction in [0,1]. The full per-balance-type APR
  -- breakdown Plaid returns lives in `aprs` below, because a card commonly has
  -- three (purchase, cash advance, balance transfer) and flattening them to one
  -- number loses the one the client is actually being charged.
  apr                          numeric(6,5) CHECK (apr >= 0 AND apr <= 1),

  -- [{ type, apr, balanceSubjectToAprCents, interestChargeAmountCents }]
  -- jsonb rather than a child table: it is read whole, written whole, never
  -- queried across clients, and a child table would add a join to every read of
  -- the common case for no gain.
  aprs                         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- When this snapshot was true. Same rule as bank_accounts.balance_as_of, and
  -- enforced the same way below: terms without a timestamp cannot be aged, and
  -- a stale minimum payment is a wrong number somebody pays.
  as_of                        timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One current row per account. A refresh updates it; it does not accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liabilities_account
  ON card_liabilities (bank_account_id);

-- The payment-timing read: everything due for one client, soonest first. NULLs
-- last, because an unknown due date must never sort ahead of a real one and be
-- read as the most urgent thing on the screen.
CREATE INDEX IF NOT EXISTS idx_card_liabilities_client_due
  ON card_liabilities (client_id, next_payment_due_date NULLS LAST);

-- Terms cannot be stored without the moment they were true.
ALTER TABLE card_liabilities DROP CONSTRAINT IF EXISTS card_liabilities_needs_asof;
ALTER TABLE card_liabilities ADD CONSTRAINT card_liabilities_needs_asof
  CHECK (
    (last_statement_balance_cents IS NULL AND minimum_payment_cents IS NULL
     AND next_payment_due_date IS NULL AND apr IS NULL)
    OR as_of IS NOT NULL
  );

COMMENT ON TABLE card_liabilities IS
  'Terms and calendar on a connected credit account: statement balance, minimum payment, and the due date nothing else in this schema holds. Distinct from tradelines (054, a bureau snapshot with no due date) and bank_accounts (081, the account itself). EVERY date and amount is nullable; NULL means unknown and NEVER today or zero. APR is a fraction in [0,1]. See db/migrations/083_card_liabilities.sql.';

COMMENT ON COLUMN card_liabilities.next_payment_due_date IS
  'NULL = unknown, and unknown is NOT today, NOT the 15th and NOT "soon". Rendering a missing due date as a date tells somebody when to move their money on a value nobody supplied.';

COMMENT ON COLUMN card_liabilities.is_overdue IS
  'Three-state on purpose: true, false, and NULL for unknown. A NULL rendered as "not overdue" is a reassurance nobody earned.';

COMMENT ON COLUMN card_liabilities.apr IS
  'Fraction in [0,1] — 0.1899 is 18.99%. Same convention as tradelines.apr (054). Two APR conventions in one schema surfaces as a client quoted the wrong interest.';
