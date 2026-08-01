-- 097_account_statement_cycles.sql — when a card's statement closes and when the
-- payment is due, for accounts that did NOT come from a credit report.
--
-- *** WHY THIS IS NOT card_liabilities (083). ***
--
-- 083 already stores statement_date, payment_due_date, minimum_payment_cents and
-- statement_balance_cents. It looks like this table and it is not, because of one
-- column: `tradeline_id uuid NOT NULL`. Every row in 083 hangs off a tradeline,
-- and a tradeline exists only where a soft pull put one there. A credit card the
-- owner typed in by hand has no tradeline, so it cannot have a row in 083, and
-- today it has a due date NOWHERE. That is the gap this file closes.
--
-- Adding a nullable tradeline_id to 083 was the other option and is worse. That
-- column being NOT NULL is what makes `uq_card_liabilities_tradeline` a real
-- key and what lets the CRS ingest path upsert without a coalesce dance. Making
-- it nullable to admit hand-entered rows would weaken a live, compliant path to
-- serve a new one — and the two really do have different provenance and
-- different trust levels, which 081's header already argues at length about the
-- same overlap between `tradelines` and `bank_accounts`.
--
-- SO THERE ARE TWO SOURCES OF A DUE DATE AND THAT IS DELIBERATE. A screen showing
-- one MUST say which table it came from, exactly as the Banking Surface and
-- Finance OS screens name their own source. What it must NOT do is silently
-- prefer one, because "your payment is due on the 4th" from a bureau file that is
-- six weeks old and "the 4th" typed in by the cardholder this morning are
-- different claims with different reliability.
--
--
-- *** A SCHEDULE, NOT A DATE. ***
--
-- 083 stores dates because a bureau file reports dates. A person does not know
-- the date their next statement closes; they know "it closes on the 5th and it is
-- due on the 2nd". So this table stores DAY-OF-MONTH and the next date is
-- COMPUTED, never stored. A stored next_due_date is a value that is correct on
-- the day it is written and silently wrong every day after, and nothing in this
-- repo would recompute it.
--
-- THE MONTH-END RULE, DEFINED ONCE, HERE: a day-of-month past the end of a given
-- month CLAMPS to the last day of that month. A cycle closing on the 31st closes
-- on 28 February, or 29 in a leap year. The rejected alternative is spilling into
-- 1 March, which moves a due date into the next month and would make a payment
-- look on time when it was late. src/banking/statement-cycles.mjs implements this
-- and nothing else may implement it a second time.
--
-- COLLISION NOTE FOR WHOEVER MERGES: migration 091 on the parallel branch adds an
-- "anchor day" to recurring_bills for the same month-end problem. If it chose a
-- different rule, the two must be reconciled into one helper before both ship.
-- Two month-end rules in one product is the defect class this repo keeps finding.
--
--
-- NULL MEANS UNKNOWN AND MUST SURVIVE. Every figure here is nullable and none may
-- be COALESCEd to 0 on the way to a screen. "I do not know this card's minimum
-- payment" and "this card's minimum payment is nothing" are different facts and
-- only one of them means the owner can skip it this month.

CREATE TABLE IF NOT EXISTS account_statement_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The account this cycle describes. CASCADE because a cycle with no account is
  -- not a record of anything — unlike a transaction, which is evidence of money
  -- moving and outlives the account it moved through.
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- Day of the month, 1-31, clamped to month end per the header rule. NULL means
  -- the owner has not told us, which is why the dashboard cannot show a due date
  -- for this card — a state the screen must name rather than leave blank.
  --
  -- There is no CHECK that the account is account_type = 'credit'. A cross-table
  -- CHECK is not expressible here, and a deposit account with a statement cycle
  -- is odd but not wrong. The writer enforces it; see src/banking/accounts.mjs.
  statement_close_day smallint CHECK (statement_close_day IS NULL
                        OR (statement_close_day BETWEEN 1 AND 31)),
  payment_due_day     smallint CHECK (payment_due_day IS NULL
                        OR (payment_due_day BETWEEN 1 AND 31)),

  -- The last statement that actually closed, as a real date. Two jobs: it says
  -- how stale last_statement_balance_cents is, and it gives the cycle computation
  -- a real anchor instead of assuming the schedule has always been kept.
  -- NULL means no statement has been recorded yet.
  last_statement_date date,

  -- The balance on that statement, in integer cents.
  --
  -- NOT CHECKed >= 0, DIVERGING FROM 083 ON PURPOSE. An overpaid card carries a
  -- credit balance, which is negative, and 083's CHECK would reject it. That
  -- CHECK is survivable there because a bureau file rarely reports one; here the
  -- owner is typing his own card in, and a constraint that rejects the true
  -- number forces him to enter a false one. 081's header makes this same argument
  -- for balances and reaches the same answer: the sign is data.
  last_statement_balance_cents bigint,

  -- The minimum due on that statement. CHECKed >= 0 and that one IS right: a
  -- minimum payment is an amount demanded, and a negative demand is not a thing.
  minimum_payment_cents bigint CHECK (minimum_payment_cents IS NULL
                          OR minimum_payment_cents >= 0),

  -- The card's rate, as a FRACTION 0..1 — 0.2499 is 24.99%. Same type and same
  -- CHECK as card_liabilities.apr so the two can be read side by side without a
  -- conversion in between. A form collecting "24.99" must divide by 100;
  -- readApr() at src/tradelines/index.mjs:51 already does it and rejects >100%.
  --
  -- It lives here rather than on bank_accounts because a hand-entered card has
  -- nowhere else to put it, and because a rate belongs with the billing terms it
  -- is charged under.
  apr             numeric(6,5) CHECK (apr IS NULL OR (apr >= 0 AND apr <= 1)),

  -- Where these figures came from. Matches 083's `source` column shape.
  -- 'manual'   — a person typed it in.
  -- 'provider' — read from a banking provider (mock or, one day, real).
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'provider')),

  -- The unparsed record as received, when a provider supplied it. Never holds a
  -- credential: the access token lives encrypted on plaid_items and is stripped
  -- long before anything reaches here.
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One cycle per account. A second row would mean the card has two due dates, and
-- every reader would have to pick one — so the database picks instead: there is
-- only ever one, and a re-read updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_statement_cycles_account
  ON account_statement_cycles (bank_account_id);

-- The dashboard's query: every cycle for one client. Ordered by due day so the
-- screen can render "what is coming up" without sorting in JavaScript.
CREATE INDEX IF NOT EXISTS idx_account_statement_cycles_client
  ON account_statement_cycles (client_id, payment_due_day NULLS LAST);

-- Org scope. Every read in this repo must filter on org_id from the SESSION, and
-- an index makes that filter free rather than something a writer is tempted to
-- drop for speed.
CREATE INDEX IF NOT EXISTS idx_account_statement_cycles_org
  ON account_statement_cycles (org_id, client_id);
