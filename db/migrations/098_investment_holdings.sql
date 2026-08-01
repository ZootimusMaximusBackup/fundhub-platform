-- 098_investment_holdings.sql — what is actually inside a brokerage account.
--
-- 081 allows account_type = 'investment' and nothing has ever stored a holding,
-- so an investment account has been a name and a balance with nothing behind it.
-- This is the "behind it".
--
-- ONE ROW PER SYMBOL PER ACCOUNT. Two accounts both holding VTI are two rows,
-- because they are two positions with two cost bases and selling one does not
-- touch the other.
--
--
-- *** QUANTITY IS NOT MONEY AND IS NOT CENTS. ***
--
-- Every other amount in this repo is integer cents and this one deliberately is
-- not. A share count is not a currency amount — it is a count that happens to be
-- fractional, and fractional shares are ordinary now (a $50 buy of a $600 stock
-- is 0.08333... shares). numeric(20,8) holds eight decimal places, which covers
-- fractional equities and leaves room for crypto quantities if one ever lands
-- here. Storing it as cents would mean "0.08333 shares" became "8 cents of
-- shares", which is not a thing.
--
-- MONEY HERE IS STILL INTEGER CENTS. cost_basis_cents and current_value_cents
-- follow the same rule as everywhere else. The mixed types in one table are
-- intentional and are the honest modelling: a quantity and a valuation are
-- different kinds of number.
--
--
-- NEGATIVE QUANTITY IS LEGAL AND MEANS A SHORT POSITION. There is no CHECK
-- forcing it positive, for the same reason 081 does not force balances positive:
-- the sign is data, and a constraint that rejects a real position would be
-- "fixed" by clamping, which is a lie about what somebody owns. current_value_
-- cents is unconstrained for the same reason — a short position's value moves
-- against the holder.
--
-- COST BASIS IS CHECKed >= 0. That one is safe. A cost basis is what was paid,
-- and nobody pays a negative amount for a security. A short's proceeds are not a
-- cost basis and do not belong in this column.
--
--
-- NULL MEANS UNKNOWN AND MUST SURVIVE. A holding with a known quantity and an
-- unknown current value is completely ordinary — it means nobody has priced it
-- today. That must reach the screen as an em dash. COALESCEing it to 0 would
-- report the position as worthless, which is the single most misleading thing
-- this table could say.
--
--
-- WHAT THIS TABLE DOES NOT DO — STATED, NOT HIDDEN. It holds the CURRENT position
-- only. Performance against it is the unrealised gain or loss:
-- current_value_cents - cost_basis_cents, which needs no history. A time series —
-- "what was this worth each month last year" — needs a history table shaped like
-- 084_card_liability_history, and that is NOT built here. Anyone who needs a
-- performance CHART rather than a performance NUMBER is looking at a missing
-- table, not a missing column.

CREATE TABLE IF NOT EXISTS investment_holdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The brokerage account this position sits in. CASCADE: a holding with no
  -- account describes nothing.
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- The ticker, as the owner or the provider spells it. NOT NULL because a
  -- position in nothing is not a position — it is the one field that must exist
  -- for the row to mean anything. Stored verbatim and not uppercased by the
  -- database: normalisation is the writer's job, in one place, so that a change
  -- to the rule does not require rewriting stored rows.
  symbol          text NOT NULL,

  -- The human name ("Vanguard Total Stock Market ETF"). NULL means we were not
  -- told. Never fill it with the symbol as a placeholder — a screen showing
  -- "VTI" twice is honest, a screen inventing a fund name is not.
  description     text,

  -- Fractional shares. See the header: this is a count, not cents.
  -- NULL means unknown, which is different from a closed-out zero position.
  quantity        numeric(20,8),

  -- Total paid for the position, integer cents. NULL means unknown — very common
  -- for a hand-entered holding, because people remember what a thing is worth far
  -- more often than what they paid for it. An unknown cost basis makes gain/loss
  -- unanswerable and the screen must say so rather than showing a gain of the
  -- full current value.
  cost_basis_cents    bigint CHECK (cost_basis_cents IS NULL
                        OR cost_basis_cents >= 0),

  -- Market value of the whole position, integer cents. Unconstrained sign; see
  -- the header on shorts.
  current_value_cents bigint,

  -- ISO 4217. NULL means unknown, and an amount whose currency is unknown must
  -- never be added to one whose currency is known — the same rule 081 states.
  currency_code   text,

  -- When the valuation was TRUE, which is not when the row was written. A price
  -- read on Monday and stored on Wednesday describes Monday. NULL means we do not
  -- know how stale it is, which is itself a reason not to rely on it.
  as_of           timestamptz,

  -- 'manual'   — a person typed it in.
  -- 'provider' — read from a banking provider (mock or, one day, real).
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'provider')),

  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per symbol per account, so a re-read updates the position instead of
-- appending a second copy of it. Without this, refreshing a brokerage connection
-- weekly would report the owner's portfolio at fifty-two times its true size —
-- the same failure 086's key exists to prevent for recurring bills.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investment_holdings_account_symbol
  ON investment_holdings (bank_account_id, symbol);

-- The screen's query: every holding in one account, largest position first.
-- NULLS LAST so unpriced holdings sort to the bottom rather than the top, where
-- they would read as the biggest positions.
CREATE INDEX IF NOT EXISTS idx_investment_holdings_account
  ON investment_holdings (bank_account_id, current_value_cents DESC NULLS LAST);

-- Org scope, same as every other table in this thread.
CREATE INDEX IF NOT EXISTS idx_investment_holdings_org
  ON investment_holdings (org_id, client_id);
