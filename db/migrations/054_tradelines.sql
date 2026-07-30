-- 054_tradelines.sql — credit-card tradelines: the missing data source under the
-- Closer Dashboard's funding calculators.
--
-- WHY THIS EXISTS. `src/calculators/deal-funding.mjs` has been finished and
-- tested since the closer-calculator unit, and it cannot be wired to a screen
-- because nothing in the schema holds what it takes: a per-card lender, credit
-- limit, current balance and APR. HANDOFF.md records the gap and the trap.
--
-- `public.cards` IS NOT THIS TABLE. `cards` is a PIPELINE KANBAN card —
-- (client_id, pipeline_id, stage_id, owner). It has no APR, no limit and no
-- balance, and wiring the waterfall to it would produce confident nonsense. The
-- name collision is why this table is `tradelines` and not `client_cards`.
--
-- SOURCE TAGGING IS NOT DECORATION. Master spec §10 and the addendum's Finance
-- OS both say the same thing: the soft pull IS the card data, with manual entry
-- for the metadata a bureau file does not carry. Those two origins have very
-- different trust levels — a closer must never be unable to tell which number
-- came off the bureau and which one a human typed. `source` carries that, and
-- `source_ref` points back at the crs_results row a pulled line came from.
--
-- NOTHING HERE IS DERIVED. No available-credit column, no utilization column.
-- Both are functions of (limit, balance) and the calculators already compute
-- them; storing them would create a second answer that goes stale the moment a
-- balance updates. Available headroom is max(0, limit - balance), computed at
-- read time, in one place.

CREATE TABLE IF NOT EXISTS tradelines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The lender as the client would recognise it ("Amex Blue Business"), not a
  -- bureau's abbreviation. Bureau files are inconsistent here; the normalizer in
  -- src/tradelines/index.mjs keeps the raw string in `raw` and puts its best
  -- reading in this column.
  lender       text NOT NULL,

  --   revolving  — credit card / charge card. The waterfall's subject.
  --   loc        — line of credit. Draws the same way; kept distinct because
  --                utilization scoring treats it differently.
  --   installment — auto/mortgage/personal. Carried for completeness so a
  --                snapshot round-trips, but EXCLUDED from funding allocation:
  --                you cannot draw against an installment loan.
  kind         text NOT NULL DEFAULT 'revolving'
               CHECK (kind IN ('revolving', 'loc', 'installment')),

  -- Money in cents. Every other money column in this schema is numeric dollars,
  -- and that is the wrong call for values that get multiplied by an APR and
  -- summed across twenty cards — see src/commissions/money.mjs, which exists
  -- because of exactly that rounding. New table, so it starts correct: integer
  -- cents in the column, dollars at the boundary.
  credit_limit_cents   bigint CHECK (credit_limit_cents   >= 0),
  balance_cents        bigint CHECK (balance_cents        >= 0),

  -- Annual rate as a decimal fraction: 0.1899 is 18.99%. NOT a percentage
  -- number. The calculators take fractions (deal-funding's `apr` field), the
  -- screen renders percentages, and the conversion happens once, at the edge.
  apr          numeric(6,5) CHECK (apr >= 0 AND apr <= 1),

  -- NULL is a real answer and must survive. A bureau file that reports a limit
  -- and a balance but no APR is ordinary, and the calculator's contract is that
  -- a missing input yields a null output rather than a guessed one. Defaulting
  -- APR to zero here would silently make an unknown card the cheapest money the
  -- waterfall can find, and it would be drawn first.

  --   crs    — off a soft pull. Authoritative, machine-written.
  --   manual — typed by staff or the client.
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('crs', 'manual')),
  -- For source='crs': the crs_results row this line was read out of.
  source_ref   uuid REFERENCES crs_results(id) ON DELETE SET NULL,

  -- Bureau account identifier where one exists. Used to recognise the same card
  -- across successive pulls instead of accumulating a duplicate per pull.
  account_ref  text,

  -- The unparsed record, kept verbatim. When a normalizer reading is disputed,
  -- this is what settles it.
  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- When the underlying data was true, which is not when we wrote the row. A
  -- pull run on Monday and ingested Wednesday describes Monday's balances.
  as_of        timestamptz,
  closed_at    timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The screen's query: every open line for one client, cheapest money first —
-- which is also the waterfall's draw order.
CREATE INDEX IF NOT EXISTS idx_tradelines_client
  ON tradelines (client_id, apr NULLS LAST);

-- Re-ingesting a pull must update the card, not add a second one. Partial,
-- because account_ref is frequently absent on manual entry and NULLs would
-- otherwise collide into a single allowed row per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tradelines_account
  ON tradelines (client_id, account_ref)
  WHERE account_ref IS NOT NULL;
