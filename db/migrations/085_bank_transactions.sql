-- 085_bank_transactions.sql — the ledger of what actually moved through a
-- client's bank account, so cash flow can be reasoned about from evidence
-- rather than from a story about the evidence.
--
-- *** THIS FILE CONNECTS TO NOTHING AND FETCHES NOTHING. ***
-- There is no outbound call here, no provider credential, no scheduler and no
-- activation flag. It is a table, its constraints and its indexes. The Plaid
-- (or other provider) transactions call is owned by a different workflow (W5)
-- and lives outside this migration on purpose. Nothing in this file can be
-- switched on to make the platform talk to a bank.
--
--
-- ============================================================================
-- 1. THE SIGN CONVENTION. READ THIS BEFORE WRITING OR READING A ROW.
-- ============================================================================
--
--   *** NEGATIVE amount_cents = MONEY LEFT THE ACCOUNT (an outflow / debit).
--   *** POSITIVE amount_cents = MONEY ENTERED THE ACCOUNT (an inflow / credit).
--   *** ZERO is not accepted. See amount_cents below.
--
-- This is the arithmetic convention: the account balance moves by exactly
-- amount_cents, so SUM(amount_cents) over a window is the net change in cash
-- over that window, with no branch and no CASE expression anywhere. A bill is a
-- negative number. A deposit is a positive number. Net cash flow is a sum.
--
-- *** THIS IS THE OPPOSITE OF PLAID'S LEGACY /transactions/get CONVENTION,
-- *** WHICH REPORTS A PURCHASE AS A POSITIVE NUMBER. That is the single most
-- expensive mistake available in this table, because it does not fail — it
-- silently inverts every downstream cash-flow number, turns every bill into
-- income, and produces a client who looks like they are earning their rent
-- rather than paying it. Any ingest path MUST negate at the boundary, and the
-- boundary is the ingest module, not this table and not the reader.
--
-- The convention is enforced in three places so that it cannot drift:
--   (a) here, by the CHECK that amount_cents <> 0 and the column comment;
--   (b) in db/migrations/086_recurring_bills.sql, whose typical_amount_cents
--       column CHECKs < 0 — a recurring BILL that is not an outflow cannot be
--       stored at all;
--   (c) in src/banking/recurring.mjs, whose header restates it and whose
--       detector EXCLUDES positive rows from bill detection with a named
--       reason rather than taking their absolute value.
-- If a future reader finds those three disagreeing, (a) is the authority.
--
--
-- ============================================================================
-- 2. MONEY IS INTEGER CENTS. NOT numeric, NOT float.
-- ============================================================================
--
-- CLAUDE.md §12 and src/commissions/money.mjs state the rule; 065's header
-- already committed the mail thread to it ("if a real invoice shape turns up it
-- lands in a later migration as integer cents with a `_cents` suffix"). This
-- table is a new table with no legacy numeric column to preserve, so it takes
-- the rule directly: `bigint`, suffixed `_cents`, never rounded on the way in.
--
-- bigint rather than integer because integer tops out at $21.47m and a business
-- account transfer can exceed it. The cost of bigint is nothing; the cost of
-- integer is a wire that will not store.
--
--
-- ============================================================================
-- 3. WHY provider_transaction_id IS NOT NULL, AND WHY THE UNIQUE INDEX IS
--    (bank_account_id, provider_transaction_id) AND NOT PARTIAL.
-- ============================================================================
--
-- AUDIT-FINDINGS records exactly this failure already, in the one place it
-- costs money: "A re-delivered Commas webhook with no event id double-counts
-- money in `transactions`". The adapter set providerRef = null, the dedupe
-- guard was `ON CONFLICT ... WHERE provider_ref IS NOT NULL`, that predicate is
-- inert on NULL, and one $5,000 payment became two rows. 067's header states
-- the general rule it taught: *** YOU CAN ONLY DEDUPE WHAT YOU CAN IDENTIFY. ***
--
-- A bank transaction re-sync is not an edge case, it is the normal operating
-- mode: every provider re-delivers the same 30-day window on every poll. So a
-- row that cannot be identified is refused at the column, not tolerated behind
-- a partial index:
--
--   provider_transaction_id text NOT NULL   -- no id, no row
--   CREATE UNIQUE INDEX uq_bank_transactions_account_provider
--     ON bank_transactions (bank_account_id, provider_transaction_id)
--
-- The index is TOTAL, not partial, precisely because there is no NULL to escape
-- through. This is the same answer src/adapters/lendflow.mjs already gives
-- ("Refuse rather than risk duplicate milestone sends") and the answer
-- commas.mjs failed to give.
--
-- SCOPED PER ACCOUNT, NOT GLOBALLY. Two different institutions can both hand
-- out the id "1". A global unique index would let one bank's id permanently
-- block another's, in a table whose whole point is holding several accounts. It
-- is the same org-scoping reasoning as uq_mail_campaigns_org_key in 065, one
-- level further down: the account, not the org, is what makes a provider id
-- mean one transaction.
--
-- A PENDING ROW AND ITS POSTED SELF ARE ONE ROW, NOT TWO — providers keep the
-- transaction id stable across that transition and change is_pending, so the
-- unique index makes the re-sync an UPDATE. That is the correct behaviour and
-- it is why is_pending is a mutable column rather than part of the key.
--
--
-- ============================================================================
-- 4. THE ACCOUNT REFERENCE HAS NO FOREIGN KEY, AND THAT IS DELIBERATE.
-- ============================================================================
--
-- `bank_account_id uuid NOT NULL` points at a `bank_accounts` table that DOES
-- NOT EXIST IN THIS REPOSITORY TODAY:
--
--   $ grep -rn "bank_account" db/schema db/migrations   -> no matches before this file
--
-- The account/link model is owned by the Plaid-link workflow (W5). This
-- migration is not going to invent it, because two workflows independently
-- inventing the same table is how you end up with two of them — CLAUDE.md §8
-- "Reuse before you build. Two functions doing the same thing is a bug that
-- takes months to surface." Nor is it going to guess at that table's shape in
-- an FK that would then have to be dropped.
--
-- *** THE MISSING FOREIGN KEY IS A REPORTED GAP, NOT AN OVERSIGHT. *** It is
-- recorded on the shared board at docs/workflows/finance-os-banking.md under
-- "## W7". Adding it is a LATER migration (do not edit this one — migrate.mjs
-- keys schema_migrations by `<dir>/<file>` and re-editing an applied file is a
-- silent no-op), and it is a two-step: backfill or delete any orphan rows
-- FIRST, then ADD CONSTRAINT. 065's header worked through the same decision for
-- mail_universe.campaign_id and reached the same answer: a soft link that is
-- honest about being soft beats an FK that breaks the run.
--
-- What IS enforced today: org_id and client_id are real foreign keys, so a row
-- can never escape its tenancy boundary even while the account link is soft.
--
--
-- ============================================================================
-- 5. TWO DATES, BECAUSE A BANK HAS TWO.
-- ============================================================================
--
-- authorized_on — when the card was swiped / the transfer was instructed.
-- posted_on     — when the bank settled it and it hit the balance.
--
-- They differ by one to three days routinely, and a cadence computed off a
-- mixture of the two wobbles by exactly that much — which is enough to turn a
-- clean monthly bill into an irregular one. src/banking/recurring.mjs therefore
-- picks ONE (posted_on) and says so, rather than coalescing silently.
--
-- Both are `date` and not `timestamptz`. A bank posts on a day, in the bank's
-- own timezone, and it does not tell you which one. Storing an instant would be
-- false precision — the same reasoning 065 gave for mail_campaigns.batch_date.
--
-- NEITHER IS DEFAULTED AND NEITHER IS BACKFILLED. NULL means "the provider did
-- not tell us", which is a real state: a pending card authorisation genuinely
-- has no posted date yet. CLAUDE.md's rule holds — the absence is the finding.
-- The only thing asserted is that a row must carry at least one of them
-- (bank_transactions_has_a_date_ck) and that a row claiming to be settled must
-- carry the settled date (bank_transactions_posted_date_ck), because "did this
-- clear, and when" is the question this table exists to answer.
--
--
-- ============================================================================
-- 6. WHY NOT `public.transactions` (001_init.sql:152).
-- ============================================================================
--
-- `transactions` is the PLATFORM's money: what a client paid FUNDHUB, written
-- by the Commas payment adapter, carrying kind/amount/provider_ref against a
-- client. It has no account, no merchant, no pending state and no bank.
-- Overloading it would mean a client's Netflix subscription and their $3,000
-- deposit to this business sharing a table, and every existing reader of
-- `transactions` (the dashboard, v_client_ar_balance, the commission basis)
-- silently gaining rows that are not revenue. That is the exact name-collision
-- trap 054_tradelines.sql documented for `cards` and 065 documented for
-- `campaigns`, and it is resolved the same way: a distinctly named table.
--
-- Nothing in this migration reads, writes or alters `transactions`.


-- ---------------------------------------------------------------------------
-- A. bank_transactions — one row per transaction, per account, forever
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),

  -- The account this moved through. NO FOREIGN KEY — see section 4 above. The
  -- table it will point at is owned by the Plaid-link workflow and does not
  -- exist yet; the FK lands in a later migration after an orphan sweep.
  bank_account_id          uuid NOT NULL,

  -- Whose account it is. Nullable because an account may be linked before it is
  -- attached to a client record, and because deleting a client must not destroy
  -- the evidence that the money moved — hence SET NULL rather than CASCADE, the
  -- same choice mail_responses.client_id made in 065.
  client_id                uuid REFERENCES clients(id) ON DELETE SET NULL,

  -- *** SIGN CONVENTION — SECTION 1 ABOVE IS THE AUTHORITY. ***
  -- NEGATIVE = money LEFT the account (outflow / debit / a bill).
  -- POSITIVE = money ENTERED the account (inflow / credit / a deposit).
  -- The balance moves by exactly this, so SUM() over a window is net cash flow.
  -- Plaid's legacy convention is the opposite; ingest MUST negate at the
  -- boundary.
  --
  -- Integer cents (src/commissions/money.mjs), never numeric, never float.
  --
  -- NOT NULL, and NOT zero. This is the one column where "unknown" cannot be
  -- carried as NULL, because the amount IS the row: a transaction with no
  -- amount records that something happened, in a table whose only purpose is
  -- recording how much. An ingest that receives no amount must REFUSE the row
  -- and report it, not write a placeholder — writing 0 would be exactly the
  -- "never default an unknown amount" mistake, dressed up as data. Zero is
  -- rejected for the same reason: a zero-cent movement is either a provider
  -- artefact or a parse failure, and it can never be a bill.
  amount_cents             bigint NOT NULL,

  -- When the bank settled it. NULL = not settled yet (or the provider did not
  -- say). Never defaulted, never backfilled with the authorised date — see
  -- section 5. This is the date src/banking/recurring.mjs computes cadence from.
  posted_on                date,

  -- When it was authorised / instructed. NULL = the provider did not say.
  authorized_on            date,

  -- What the provider called the counterparty, VERBATIM. Not normalised, not
  -- title-cased, not cleaned. "SQ *BLUE BOTTLE 4471 OAKLAND CA" is kept exactly
  -- as it arrived, for the same reason tradelines.raw and bank_inbox.raw are
  -- kept: when a normalised reading is disputed, this is what settles it.
  -- Normalisation is normaliseMerchant() in src/banking/recurring.mjs, is pure,
  -- and is versioned in code where it can be tested — not baked into a column
  -- here where changing it would need a migration and a backfill.
  -- NULL = the provider sent no name. That happens, and it must survive.
  merchant_name            text,

  -- The provider's own category string, verbatim, for the same reason. NOT a
  -- closed vocabulary and deliberately no CHECK: every provider has its own
  -- taxonomy, they change them, and asserting a list nobody in this repo has
  -- defined would reject real data. Same reasoning as mail_responses.outcome_tier
  -- in 065. NULL = uncategorised, which is common and is not an error.
  category                 text,

  -- Has the bank settled it? A pending row can change amount, change date, or
  -- vanish entirely when the merchant releases the hold. src/banking/recurring.mjs
  -- EXCLUDES pending rows from bill detection with a named reason, because a
  -- hold that later re-posts would otherwise be counted as two occurrences and
  -- manufacture a cadence out of one purchase.
  -- Mutable, and deliberately NOT part of the unique key: the provider keeps the
  -- transaction id stable across pending -> posted, so a re-sync UPDATEs this
  -- row rather than inserting a second one. See section 3.
  is_pending               boolean NOT NULL DEFAULT false,

  -- The provider's identifier for this transaction. NOT NULL: no id, no row.
  -- Section 3 is the argument; AUDIT-FINDINGS' double-counted $5,000 payment is
  -- the evidence.
  provider_transaction_id  text NOT NULL,

  -- Which provider said so ('plaid', 'mx', 'finicity', ...). Free text with a
  -- non-empty CHECK only: naming the providers this repo has not integrated
  -- yet would be inventing a vocabulary. It exists so that a future second
  -- provider does not silently share an id namespace with the first.
  provider                 text NOT NULL DEFAULT 'plaid',

  -- The unparsed provider payload, kept verbatim. Same rationale as
  -- tradelines.raw, bank_inbox.raw and mail_responses.raw: when a parsed
  -- reading is disputed, this is what settles it — including, specifically,
  -- which sign the provider used before ingest negated it.
  raw                      jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Zero is a parse failure or a provider artefact, never a real movement.
  CONSTRAINT bank_transactions_amount_nonzero_ck
    CHECK (amount_cents <> 0),

  -- A transaction with no date at all cannot be placed in time, and this table
  -- exists to place money in time.
  CONSTRAINT bank_transactions_has_a_date_ck
    CHECK (posted_on IS NOT NULL OR authorized_on IS NOT NULL),

  -- A row that claims to have settled must say when it settled. Without this,
  -- "has this cleared, and when" has no reliable answer — and cadence detection
  -- would silently skip settled rows for want of a date.
  CONSTRAINT bank_transactions_posted_date_ck
    CHECK (is_pending OR posted_on IS NOT NULL),

  -- Settlement cannot precede authorisation. A row where it does is a parse
  -- error (a swapped pair), and a swapped pair shifts every cadence it touches.
  CONSTRAINT bank_transactions_date_order_ck
    CHECK (posted_on IS NULL OR authorized_on IS NULL OR posted_on >= authorized_on),

  CONSTRAINT bank_transactions_provider_txn_id_ck
    CHECK (btrim(provider_transaction_id) <> ''),
  CONSTRAINT bank_transactions_provider_ck
    CHECK (btrim(provider) <> '')
);

-- THE DEDUPE RULE. Total, not partial, because provider_transaction_id is
-- NOT NULL and there is therefore no NULL to escape through. A re-sync of the
-- same 30-day window is an ON CONFLICT UPDATE, not a second row. Section 3.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_account_provider
  ON bank_transactions (bank_account_id, provider_transaction_id);

-- The detector's read: every settled transaction for one account, oldest first,
-- which is the exact order src/banking/recurring.mjs wants its input in.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_posted
  ON bank_transactions (bank_account_id, posted_on);

-- The client cash-flow read: everything that moved for one client over a
-- window, newest first.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_client_posted
  ON bank_transactions (client_id, posted_on DESC)
  WHERE client_id IS NOT NULL;

-- The merchant read, which is how a human checks a detected bill by hand.
-- Case-insensitive because providers are inconsistent about case within the
-- same merchant across months.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_merchant
  ON bank_transactions (bank_account_id, lower(merchant_name))
  WHERE merchant_name IS NOT NULL;

COMMENT ON TABLE bank_transactions IS
  'Bank ledger, one row per provider transaction per account. amount_cents: NEGATIVE = money left the account (outflow), POSITIVE = money entered (inflow). Integer cents. Plaid''s legacy convention is the OPPOSITE — ingest must negate at the boundary.';

COMMENT ON COLUMN bank_transactions.amount_cents IS
  'Integer cents. NEGATIVE = outflow (money left the account), POSITIVE = inflow. Never zero. SUM() over a window is net cash flow.';

COMMENT ON COLUMN bank_transactions.bank_account_id IS
  'Account reference. No FK yet — the bank_accounts table is owned by the Plaid-link workflow and does not exist in this repo. Reported gap, see docs/workflows/finance-os-banking.md.';
