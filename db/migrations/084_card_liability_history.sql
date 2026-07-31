-- 084_card_liability_history.sql — every liability position we have ever
-- observed on a card, kept as a series. The source of truth behind 083.
--
-- WHY A SEPARATE TABLE AND NOT JUST MORE ROWS IN `card_liabilities`.
-- 083 answers "what does this client owe right now", which is the question every
-- screen asks and the only question the funding calculators ask. Keeping that a
-- one-row-per-card lookup means the common read never sorts a growing series.
-- This table answers the rarer question — "how has that moved" — and it is the
-- one that must never lose a row. Splitting them means the hot read stays cheap
-- and the durable record stays complete; 083 is a projection of this table's
-- newest row per card and can be rebuilt from it.
--
-- WHY THE TWO ARE NOT A SECOND ANSWER TO ONE QUESTION.
-- `src/liabilities/store.mjs` writes both inside ONE transaction: append here
-- first, then upsert 083 — and the 083 upsert refuses to move backwards, so a
-- backfilled older statement lands in the series without demoting the current
-- position. There is no code path that writes one and not the other.
--
-- ORDERING KEY: `as_of`, tie-broken by `created_at DESC`. Identical to 083 and
-- for the same reason — `as_of` is when the position was TRUE, `created_at` is
-- when we wrote it, and a Wednesday ingest of a Monday pull describes Monday.
-- `getLiabilityHistory()` returns the series in that order; `getCurrentLiability()`
-- returns its head.
--
-- APPEND-ONLY IN SPIRIT, NOT ENFORCED BY A TRIGGER. The write path only ever
-- appends. There is deliberately no BEFORE DELETE guard of the kind
-- 016_ledger_no_delete.sql puts on `commission_ledger`, because this table is
-- consumer PII on a cascade from `clients` — a client-deletion request has to be
-- able to remove it, and a hard no-delete trigger would abort that cascade.
-- Immutability here is a property of the code, and the pg tests assert it.
--
-- RE-READING THE SAME OBSERVATION IS A CORRECTION, NOT A NEW ROW. The unique
-- index is (tradeline_id, as_of): one observed position per card per day. The
-- same pull ingested twice is one fact, not two, and without this the series
-- would grow a duplicate every time a job retried. A later write of the same
-- as_of overwrites, because the second read of the same date is a restatement.
--
-- MONEY IS INTEGER CENTS. APR IS A DECIMAL FRACTION IN [0,1], with the same
-- column-level CHECK as 083 — the constraint is repeated here rather than
-- assumed, because this table is written directly and would otherwise be the
-- unguarded door into the same data. NULL means UNKNOWN on every nullable
-- measure and must survive; see 083 for the per-column meanings, which are
-- identical.

CREATE TABLE IF NOT EXISTS card_liability_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tradeline_id  uuid NOT NULL REFERENCES tradelines(id) ON DELETE CASCADE,

  -- The 083 row this observation feeds. ON DELETE SET NULL, not CASCADE: if the
  -- current-position projection is ever dropped and rebuilt, the series must
  -- survive that. The series is the source of truth; losing it to a rebuild of
  -- the thing it feeds would be exactly backwards.
  liability_id  uuid REFERENCES card_liabilities(id) ON DELETE SET NULL,

  -- When this position was true (our observation date). NOT NULL — it is the
  -- ordering key, and a series entry that cannot be placed in time is not a
  -- series entry.
  as_of         date NOT NULL,

  -- ---- The measures. NULL = UNKNOWN on every one of them, never 0. ----
  statement_balance_cents bigint CHECK (statement_balance_cents >= 0),
  current_balance_cents   bigint CHECK (current_balance_cents   >= 0),
  minimum_payment_cents   bigint CHECK (minimum_payment_cents   >= 0),
  past_due_cents          bigint CHECK (past_due_cents          >= 0),
  last_payment_cents      bigint CHECK (last_payment_cents      >= 0),
  last_payment_date       date,
  statement_date          date,
  payment_due_date        date,

  -- Decimal fraction: 0.1899 is 18.99%. The CHECK refuses 18.99 outright.
  apr                     numeric(6,5) CHECK (apr >= 0 AND apr <= 1),

  payment_status          text CHECK (payment_status IN
                            ('current','late_30','late_60','late_90','late_120',
                             'charge_off','collection')),

  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('crs','manual')),
  source_ref    uuid REFERENCES crs_results(id) ON DELETE SET NULL,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- No updated_at. A history row is an observation, not a record under
  -- maintenance; the only write that touches an existing row is the same-day
  -- restatement described above, and `created_at` is what breaks that tie.
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One observed position per card per day. Also the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liability_history_asof
  ON card_liability_history (tradeline_id, as_of);

-- The series read: one card, newest first. `created_at DESC` is in the index so
-- the tie-break on a restated as_of is served without a sort.
CREATE INDEX IF NOT EXISTS idx_card_liability_history_series
  ON card_liability_history (tradeline_id, as_of DESC, created_at DESC);

-- The client-wide read, for a screen showing movement across every card at once.
CREATE INDEX IF NOT EXISTS idx_card_liability_history_client
  ON card_liability_history (client_id, as_of DESC);
