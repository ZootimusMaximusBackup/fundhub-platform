-- 083_card_liabilities.sql — the CURRENT liability position on a card: what is
-- owed right now, what the minimum payment is, and when it is due.
--
-- ===========================================================================
-- HOW THIS DIFFERS FROM `tradelines` (054), AND WHY IT IS NOT A SECOND COPY
-- ===========================================================================
-- `tradelines` describes the CREDIT FACILITY. It answers "what card is this,
-- who is the lender, how big is the line, what does it cost to borrow on it".
-- It is one row per card, upserted by `src/tradelines/store.mjs` on every pull,
-- and it deliberately keeps no history — the newest pull overwrites the older
-- balance. That is correct for a facility: the calculators in
-- `src/calculators/deal-funding.mjs` want today's headroom, not last quarter's.
--
-- `card_liabilities` describes the BILLING POSITION on that facility at a point
-- in time. It answers a completely different question: "what does this client
-- owe, what must they pay, and by when". Six of its measures have no counterpart
-- anywhere in 054 — minimum payment, statement balance, statement date, payment
-- due date, amount past due, and the last payment made. None of those are
-- facility attributes and none of them can be derived from a limit, a balance
-- and an APR.
--
-- Two columns DO overlap 054 on purpose, and the reason is that they are
-- time-varying facts about the position, not restatements of the facility:
--
--   * current_balance_cents — 054's `tradelines.balance_cents` is the ONE
--     current balance, overwritten every pull. Here the same measure is pinned
--     to an as-of date and preserved, which is the entire point of the table.
--   * apr — an intro rate expires. The rate in effect when a statement cut is a
--     property of that statement, and reading it off `tradelines` months later
--     gives the rate in effect today, which is a different number.
--
-- WHAT IS DELIBERATELY NOT COPIED FROM 054: lender, kind, credit_limit_cents,
-- account_ref, closed_at. Those belong to the card, they are reached through
-- `tradeline_id`, and storing them again would create the second-answer problem
-- 054's own header warns about. In particular there is no utilization column
-- and no available-credit column here, for exactly the reason 054 gives.
--
-- ===========================================================================
-- CURRENT vs HISTORY
-- ===========================================================================
-- This table holds exactly ONE row per card: the newest position we know about.
-- The full series lives in `card_liability_history` (084), which is written on
-- the same transaction by `src/liabilities/store.mjs`. History is the source of
-- truth; this table is a projection of its newest row, and it exists so that the
-- ordinary screen read ("what does this client owe on each card") is a plain
-- indexed lookup instead of a per-card sort over a growing series.
--
-- ===========================================================================
-- THE ORDERING KEY IS `as_of`, NOT `created_at`. THIS IS DELIBERATE.
-- ===========================================================================
-- `as_of` is the date the position was TRUE. `created_at` is the date we wrote
-- the row. They diverge constantly: a pull run on Monday and ingested on
-- Wednesday describes Monday. If we ordered on `created_at`, a backfill of an
-- old statement loaded after a newer one would be crowned "current" and the
-- client would be shown a balance that is weeks stale. So: newest `as_of` wins,
-- and the store refuses to let an older `as_of` overwrite a newer one.
--
-- Ties on `as_of` — a bureau restating the same statement date — break by
-- `created_at DESC`, because the later write of the same date is a correction.
--
-- `as_of` is NOT NULL and it is OUR OBSERVATION DATE, not the bureau's
-- statement date. We always know when we looked; worst case it is the timestamp
-- of the pull. The bureau's own statement close date is `statement_date`, which
-- IS nullable, because a file that omits it has genuinely not told us.
--
-- ===========================================================================
-- MONEY IS INTEGER CENTS. NULL IS UNKNOWN AND MUST SURVIVE.
-- ===========================================================================
-- `bigint` cents, matching 054 and `src/commissions/money.mjs`. The live defect
-- this prevents is not hypothetical: `src/affiliates/economics.mjs` computed a
-- commission in floating point and persisted a value one cent short of the exact
-- answer. Cents in the column, dollars only at the boundary.
--
-- Every nullable measure below means UNKNOWN, never zero. A bureau file that
-- omits the minimum payment has an unknown minimum. Defaulting it to 0 would
-- tell a client their card requires no payment this month, which is both wrong
-- and, on a consumer-finance screen, a claim we cannot make.
--
-- ===========================================================================
-- APR IS A DECIMAL FRACTION IN [0,1], ENFORCED IN THE COLUMN
-- ===========================================================================
-- 0.1899 is 18.99%. Never the percentage number. `readApr()` in
-- `src/tradelines/index.mjs` is the ONE reader of a bureau APR field in this
-- repo and this module imports it rather than writing a second one — two
-- readers of one payload is the defect class this codebase keeps finding. The
-- CHECK below is the backstop: even if a caller bypasses the parser entirely,
-- the database refuses 18.99.

CREATE TABLE IF NOT EXISTS card_liabilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The card this position is on. NOT NULL: a liability with no facility behind
  -- it is unattributable, and there is no screen that can show it.
  tradeline_id  uuid NOT NULL REFERENCES tradelines(id) ON DELETE CASCADE,

  -- When this position was true (our observation date). See the ordering note
  -- above. NOT NULL — never unknown.
  as_of         date NOT NULL,

  -- ---- The measures. Every one of these is NULL = UNKNOWN, never 0. ----

  -- What the statement closed at. NULL: the file did not report a statement
  -- balance (common on a soft pull, which often carries only a current balance).
  statement_balance_cents bigint CHECK (statement_balance_cents >= 0),

  -- What is owed as of `as_of`, including activity since the statement cut.
  -- NULL: not reported.
  current_balance_cents   bigint CHECK (current_balance_cents   >= 0),

  -- The contractual minimum due. NULL: NOT REPORTED — which is not the same as
  -- "no payment required" and must never be rendered as $0.
  minimum_payment_cents   bigint CHECK (minimum_payment_cents   >= 0),

  -- Amount currently past due. NULL: not reported. A reported 0 IS meaningful
  -- here (the bureau is affirming the account is current) and is distinct from
  -- NULL, which is why this column is nullable rather than defaulted.
  past_due_cents          bigint CHECK (past_due_cents          >= 0),

  -- The most recent payment the bureau reports. NULL on either column: not
  -- reported. They are independent — a file can give an amount with no date.
  last_payment_cents      bigint CHECK (last_payment_cents      >= 0),
  last_payment_date       date,

  -- The bureau's own dates. NULL on either: the file did not carry it. These
  -- are NOT interchangeable with `as_of` — see the ordering note.
  statement_date          date,
  payment_due_date        date,

  -- The rate in effect for this position, as a decimal fraction. NULL: the file
  -- did not report a rate, or reported one `readApr()` refused to guess at.
  -- A refusal is stored as unknown rather than as a clamped plausible number.
  apr                     numeric(6,5) CHECK (apr >= 0 AND apr <= 1),

  -- Payment standing as reported. NULL = the file did not say, or said something
  -- this repo has not confirmed a meaning for. An unrecognised code is stored as
  -- NULL rather than mapped to 'current', because guessing "current" on a
  -- delinquent account is the expensive direction to be wrong in.
  --   current     — paid as agreed
  --   late_30/60/90/120 — days past due, as reported
  --   charge_off  — creditor has written the balance off
  --   collection  — placed with a collection agency
  payment_status          text CHECK (payment_status IN
                            ('current','late_30','late_60','late_90','late_120',
                             'charge_off','collection')),

  -- Same trust-level tagging as 054: a closer must always be able to tell which
  -- number came off a bureau file and which one a human typed.
  --   crs    — off a soft pull. Machine-written.
  --   manual — typed by staff or the client.
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('crs','manual')),
  source_ref    uuid REFERENCES crs_results(id) ON DELETE SET NULL,

  -- The unparsed record. When a reading is disputed this is what settles it.
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One current position per card. This is the upsert conflict target in
-- src/liabilities/store.mjs — a re-ingest updates the card's position rather
-- than growing a second "current" row, which is the same reasoning as 054's
-- upsert-not-insert rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liabilities_tradeline
  ON card_liabilities (tradeline_id);

-- The screen's query: every card's current position for one client, most
-- urgent first. NULLS LAST because an unknown due date is not an imminent one
-- and must not sort to the top of a list a closer reads out loud.
CREATE INDEX IF NOT EXISTS idx_card_liabilities_client
  ON card_liabilities (client_id, payment_due_date NULLS LAST);
