-- 083_card_liabilities.sql — what a client actually owes on each credit card,
-- as the BANK reports it. Personal and business.
--
-- WHY THIS EXISTS, AND WHY IT IS NOT A THIRD `source` ON `tradelines`.
--
-- 054_tradelines.sql already holds card data, tagged `source IN ('crs',
-- 'manual')`. Adding 'bank' to that CHECK is a two-character migration and it
-- is the wrong one. Four reasons, all of them in the code that exists today:
--
--   1. THE IDENTITY KEY COLLIDES ACROSS NAMESPACES. 054's uniqueness is
--      uq_tradelines_account ON (client_id, account_ref) WHERE account_ref IS
--      NOT NULL (054:97), and `account_ref` there is documented as "Bureau
--      account identifier". A bank aggregator's account id is a different
--      namespace with no relationship to a bureau's. One column serving both
--      means either a false match — two unrelated cards merged into one — or,
--      far more likely, no match at all, which yields TWO ROWS PER PHYSICAL
--      CARD. That is the duplication this repo keeps finding.
--
--   2. upsertTradelines HAS NO PRECEDENCE RULE AND CANNOT BE GIVEN ONE CHEAPLY.
--      src/tradelines/store.mjs DO UPDATE overwrites lender, kind,
--      credit_limit_cents, balance_cents, source, source_ref, raw and as_of
--      unconditionally. With two live sources, whichever ran last would win
--      every column, and `source` would flip back and forth while claiming to
--      say where the current numbers came from. Only `apr` is COALESCEd.
--
--   3. DOUBLE-COUNTING AVAILABLE CREDIT IS A MONEY DEFECT. toCalculatorCards()
--      feeds every open, non-installment row into calcFunding(), which SUMS
--      credit limits. One physical card present as both a 'crs' row and a
--      'bank' row inflates Total Available Credit — the number the closer says
--      out loud on the call.
--
--   4. THE SHAPES DIFFER, ALL-OR-NOTHING. Statement balance, minimum payment,
--      statement close date, payment due date, last4 and is_business are things
--      a bank knows and a bureau file does not. Bolting them onto `tradelines`
--      creates eight columns that are NULL on every existing row and on every
--      future 'crs' or 'manual' row. That is not one table with a new source;
--      it is two tables sharing a primary key.
--
-- SAID OUT LOUD, BECAUSE IT MUST BE: THIS DOES CREATE A SECOND PLACE THAT CAN
-- ANSWER "WHAT DOES THIS CLIENT OWE". Two things keep that from becoming the
-- usual silent drift, and neither is a promise made in a comment:
--
--   * `tradeline_id` below is a real foreign key. When a bank card and a bureau
--     card are known to be the same physical card, the link lives in the
--     schema, not in a read-time guess.
--   * mergeCardView() in src/card-liabilities/index.mjs is a PURE function that
--     takes one tradeline row and one card_liabilities row and returns ONE
--     answer, per field, carrying the provenance of each field. The precedence
--     rule is written once and unit-tested field by field: the bank wins any
--     field the bank actually reported, and a NULL from the bank is not a
--     correction — it never overwrites a value the bureau knew.
--
-- NOTHING AUTOMATICALLY POPULATES tradeline_id. Matching a bank card to a
-- bureau card is a real matching problem — issuers name themselves differently
-- in the two feeds, and last4 is not unique per issuer per client — and
-- guessing at it produces exactly the confident nonsense 054's own header warns
-- about. Until a matcher exists, an unlinked pair is visibly two rows to a
-- human rather than one merged row that is quietly wrong.
--
-- NOTHING HERE IS DERIVED, same rule as 054. No available-credit column, no
-- utilisation column. Both are functions of (limit, balance) and live in
-- src/card-liabilities/index.mjs, computed at read time, in one place. Storing
-- them would create a second answer that goes stale the moment a balance moves.

CREATE TABLE IF NOT EXISTS card_liabilities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- THE ACCOUNT REFERENCE IS NOT A FOREIGN KEY, DELIBERATELY. W5 owns the
  -- accounts table and it does not exist yet: there is no bank_accounts table,
  -- no aggregator code and no adapter anywhere in this repo today. A foreign
  -- key to a table that does not exist aborts this migration. A `uuid` column
  -- with no foreign key would LOOK like a key and enforce nothing, which is the
  -- idx_shifts_open mistake 060 was written to undo — a name doing the arguing
  -- while the DDL promises nothing.
  --
  -- So it is opaque text, exactly as the caller supplies it, and the store
  -- takes accountRef as a parameter. When W5 lands its accounts table, a
  -- FOLLOW-UP migration adds the foreign key. That is a decision somebody
  -- signs, not a debt hidden in a nullable column.
  account_ref  text NOT NULL CHECK (length(account_ref) BETWEEN 1 AND 255),

  -- The same physical card as seen by the soft pull, WHERE THAT IS KNOWN.
  -- NULL is the ordinary state and means "not matched", not "no bureau row".
  -- ON DELETE SET NULL, not CASCADE: deleting a bureau line must not delete the
  -- bank's record of a real debt.
  tradeline_id uuid REFERENCES tradelines(id) ON DELETE SET NULL,

  -- The issuer as the client would recognise it ("Chase Ink Business
  -- Preferred"), matching 054's `lender` convention rather than a bureau
  -- abbreviation.
  issuer       text NOT NULL,

  -- Last four digits, as a STRING. Not an integer: '0042' is a real card ending
  -- and an integer column would store it as 42 and render it as 42. Exactly
  -- four digits or nothing.
  last4        text CHECK (last4 ~ '^[0-9]{4}$'),

  -- IS_BUSINESS IS A CLASSIFICATION WITH THREE STATES, AND NULL IS ONE OF THEM.
  --   true  — a business card
  --   false — a personal card
  --   NULL  — nobody has classified it
  -- No NOT NULL and no DEFAULT, both on purpose. Defaulting to false would make
  -- every unclassified card silently personal, and personal-vs-business changes
  -- who is liable, which product applies and how the balance is underwritten.
  -- An unknown classification must stay visibly unknown.
  is_business  boolean,

  -- MONEY IS INTEGER CENTS. bigint, _cents suffix, same call 054 made and for
  -- the same reason (src/commissions/money.mjs exists because of exactly the
  -- rounding that floats produce when a rate multiplies a balance). Dollars at
  -- the boundary, cents in the column. NULL means UNKNOWN and must survive:
  --
  --   credit_limit_cents      NULL is not 0. A card with no known limit and a
  --                           card with a $0 limit are different facts, and
  --                           utilisation() returns NULL for both rather than
  --                           reporting 0% for either.
  --   balance_cents           what is owed right now.
  --   statement_balance_cents what the last statement said — the figure that
  --                           actually has to be paid to avoid interest, which
  --                           is NOT the current balance.
  --   minimum_payment_cents   the minimum due on that statement.
  credit_limit_cents      bigint CHECK (credit_limit_cents      >= 0),
  balance_cents           bigint CHECK (balance_cents           >= 0),
  statement_balance_cents bigint CHECK (statement_balance_cents >= 0),
  minimum_payment_cents   bigint CHECK (minimum_payment_cents   >= 0),

  -- Annual rates as decimal FRACTIONS: 0.1899 is 18.99%. Not percentages. Same
  -- precedent and the same numeric(6,5) as 054's `apr`, so a rate round-trips
  -- between the two tables without a unit conversion nobody can see.
  --
  -- Three of them because a card quotes three, and they are not
  -- interchangeable: a cash advance at 29.99% priced as if it were the purchase
  -- APR at 18.99% understates the cost of the money by a third. Each is
  -- independently NULL-able, because a feed that reports one and not the others
  -- is ordinary.
  --
  -- These three are the GO-TO rates: what the card charges once no promotion
  -- applies. The promotional rates are separate columns below, because a promo
  -- is not a rate — it is a rate WITH A TERM.
  apr_purchase         numeric(6,5) CHECK (apr_purchase         >= 0 AND apr_purchase         <= 1),
  apr_cash_advance     numeric(6,5) CHECK (apr_cash_advance     >= 0 AND apr_cash_advance     <= 1),
  apr_balance_transfer numeric(6,5) CHECK (apr_balance_transfer >= 0 AND apr_balance_transfer <= 1),

  -- THE 0%-INTRO WINDOW. For a card-stacking business this is not a detail, it
  -- is the product: the whole point of the stack is drawing money at 0% and
  -- repaying it before the window closes. A system that holds the go-to rate
  -- and not the promotional one quotes 18.99% on a card that is currently free
  -- money, and picks the wrong card to draw from.
  --
  -- A PROMO IS A RATE PLUS AN END DATE, AND MODELLING ONLY THE RATE IS THE
  -- DANGEROUS HALF. A bare `apr_promotional` column records a 0% that never
  -- expires, which is the most expensive possible wrong number here. So the
  -- rate and its end date are stored as a pair, per scope, and
  -- src/card-liabilities/index.mjs decides which rate is actually in force on a
  -- given day.
  --
  -- THERE IS NO "REVERTS TO" COLUMN, on purpose. The rate a promotion reverts
  -- to is the go-to rate three lines up. A separate copy of it would be a
  -- second answer to the same question and would drift the first time an issuer
  -- repriced the card.
  --
  -- NO CHECK TIES THE RATE TO THE DATE. "There is a 0% promo and we do not know
  -- when it ends" is a real and common state — a client says so on a call and
  -- the statement is not to hand. Requiring the date would force whoever typed
  -- it to invent one. Instead the ABSENCE is treated as the risk it is:
  -- effectiveApr() refuses to apply a promotion whose expiry is unknown and
  -- quotes the go-to rate, because being wrong in that direction understates a
  -- benefit, while the other direction tells a client their money is free when
  -- it is not.
  --
  -- ONLY TWO SCOPES. Purchases and balance transfers are what issuers actually
  -- promote. Cash advances are not promoted by any card this business works
  -- with, and inventing a column for a promotion that does not exist would
  -- invite somebody to populate it.
  promo_purchase_apr             numeric(6,5)
    CHECK (promo_purchase_apr         >= 0 AND promo_purchase_apr         <= 1),
  promo_purchase_ends_on         date,
  promo_balance_transfer_apr     numeric(6,5)
    CHECK (promo_balance_transfer_apr >= 0 AND promo_balance_transfer_apr <= 1),
  promo_balance_transfer_ends_on date,

  -- Statement cycle. DATE, not timestamptz: a due date is a calendar day the
  -- issuer names, not an instant, and storing it as an instant invents a
  -- timezone the issuer never specified.
  --
  -- BOTH ARE NULLABLE AND A MISSING ONE STAYS NULL. Never today, never
  -- end-of-month, never "close date + 21 days". A guessed due date is worse
  -- than no due date: it looks actionable, and something downstream will
  -- eventually pay against it.
  --
  -- No CHECK relating the two. payment_due_date is normally after
  -- statement_close_date, but "normally" is not "always" — a re-issued
  -- statement, a corrected cycle, or a partial feed all produce legitimate rows
  -- that such a CHECK would reject. A constraint that is sometimes false is a
  -- bug wearing a constraint's clothes.
  statement_close_date date,
  payment_due_date     date,

  -- When this was true, which is not when the row was written — same
  -- distinction 054 draws. A refresh run Monday and stored Wednesday describes
  -- Monday.
  as_of        timestamptz,

  -- The unparsed record, kept verbatim. When a reading is disputed, this
  -- settles it. Also where a field this table does not model — a promotional
  -- rate, a rewards balance — survives instead of being dropped.
  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Set when the card is closed. A closed card has no headroom to draw and no
  -- future due date, but it may still carry a balance somebody owes, so the row
  -- is kept rather than deleted.
  closed_at    timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per card. account_ref is NOT NULL, so this is a plain unique index
-- and not the partial one 054 needed — there is no NULL case to exempt, and
-- therefore no way for two unmatched refreshes to accumulate duplicate rows for
-- the same card. This is the conflict target for upsertCardLiability.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liabilities_account
  ON card_liabilities (client_id, account_ref);

-- The read the endpoint actually issues: every open card for one client.
CREATE INDEX IF NOT EXISTS idx_card_liabilities_client
  ON card_liabilities (client_id)
  WHERE closed_at IS NULL;

-- Finding the bank row for a bureau line, once something links them. Partial,
-- because tradeline_id is NULL on almost every row today.
CREATE INDEX IF NOT EXISTS idx_card_liabilities_tradeline
  ON card_liabilities (tradeline_id)
  WHERE tradeline_id IS NOT NULL;
