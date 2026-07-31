-- 086_recurring_bills.sql — bills we think are recurring, and how sure we are.
--
--
-- *** EVERY ROW IN THIS TABLE IS A GUESS. THE CONFIDENCE COLUMN IS NOT
-- *** DECORATION AND IT IS NOT OPTIONAL. ***
--
-- Nothing here is reported by a bank. A recurring bill is INFERRED by
-- src/banking/recurring.mjs from a pattern in `bank_transactions` (085): the
-- same merchant, a similar amount, at a regular cadence. That inference is
-- sometimes obvious (twelve identical monthly insurance payments) and sometimes
-- almost worthless (two coffee shop visits three weeks apart).
--
-- Both end up as rows in this table, and THE SCREEN MUST BE ABLE TO TELL THEM
-- APART. That is what `confidence` is for, and it is NOT NULL precisely so a row
-- cannot exist without one. A detected bill rendered with the same weight as a
-- known fact is the failure this whole table is shaped around: somebody plans
-- their month around a $340 "mortgage" the detector assembled out of two
-- coincidences.
--
-- CONFIDENCE IS CAPPED BELOW 1 BY CHECK. There is no such thing as a certain
-- inference from this data — the next occurrence may simply not happen — and a
-- 1.0 in this column would be a lie the schema permitted. If a bill is ever
-- KNOWN rather than inferred (a client confirms it, a biller integration reports
-- it), that is what `confirmed_at` and source='confirmed' are for, and the
-- confidence column stops being the relevant signal.
--
--
-- WHAT NULL MEANS ON THE DATE COLUMNS. `next_expected_date` is NULL whenever the
-- cadence is too weak to project. That is common and it is the honest answer. It
-- is NOT today, NOT last date + 30 days, and a screen must render it as "we do
-- not know when this is next due" rather than picking a plausible day. Same rule
-- as 083's next_payment_due_date, for the same reason: this feeds payment
-- timing.
--
-- AMOUNTS ARE POSITIVE HERE, unlike 085. A bill of $87.40 is stored as 8740, not
-- -8740: this table describes an obligation, not a ledger entry, and "your bill
-- is negative eighty-seven dollars" is not a sentence anybody should read. The
-- CHECK makes the convention enforceable rather than remembered.

CREATE TABLE IF NOT EXISTS recurring_bills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Which account it is paid from. NULLABLE: a bill detected across a client's
  -- whole picture may not belong to one account, and forcing one would be a
  -- guess about a guess.
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,

  -- Who is being paid, as the detector grouped them.
  merchant_name text NOT NULL,

  -- Positive. See the header. NULLABLE because a bill whose amount varies (a
  -- utility) is still a real recurring bill — and rendering a varying bill at
  -- one fixed number would be more wrong than showing no number.
  amount_cents  bigint CHECK (amount_cents > 0),

  -- How much the amount moves between occurrences, in cents. Lets a screen say
  -- "about $120, varies by ~$15" instead of implying a fixed figure. NULL when
  -- there is not enough data to say.
  amount_variance_cents bigint CHECK (amount_variance_cents >= 0),

  --   weekly | biweekly | monthly | quarterly | annual | irregular
  -- 'irregular' is a real, useful answer: money genuinely does leave for the
  -- same merchant repeatedly without a cadence, and calling that 'monthly'
  -- because it is the most common option would be inventing a schedule.
  cadence       text NOT NULL DEFAULT 'irregular'
                CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'irregular')),

  -- The average gap the detector measured, in days. The evidence behind
  -- `cadence`, kept so a reader can judge the label rather than trust it.
  interval_days numeric(6,2) CHECK (interval_days > 0),

  -- *** NOT NULL. See the header. *** 0..0.99 — never 1.
  confidence    numeric(4,3) NOT NULL
                CHECK (confidence >= 0 AND confidence < 1),

  -- How many transactions the inference rests on. The single most useful number
  -- for a human judging a low-confidence row, and the reason it is a column
  -- rather than buried in evidence: "based on 2 payments" is a sentence a screen
  -- should be able to write without parsing jsonb.
  occurrence_count integer NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),

  first_seen_date date,
  last_seen_date  date,

  -- NULL when the cadence is too weak to project. See the header — NOT today,
  -- NOT last + 30.
  next_expected_date date,

  --   detected  — inferred from transactions. A guess.
  --   confirmed — a human confirmed it. Authoritative; the detector must not
  --               overwrite or downgrade it.
  --   manual    — a human entered it directly.
  source        text NOT NULL DEFAULT 'detected'
                CHECK (source IN ('detected', 'confirmed', 'manual')),

  confirmed_at  timestamptz,
  confirmed_by  uuid REFERENCES staff(id),

  --   active   — still recurring
  --   ended    — stopped occurring
  --   dismissed — a human said this is not a bill
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'ended', 'dismissed')),

  -- The transactions and the arithmetic behind the row. A guess nobody can check
  -- is a guess nobody should act on.
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One live row per (client, merchant, cadence). Re-running the detector updates
-- rather than accumulating — the detector is deterministic over a growing window
-- and would otherwise produce a new row on every sync. Partial over live rows so
-- a dismissed bill does not block a genuine recurrence being found later.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_bills_live
  ON recurring_bills (client_id, lower(merchant_name), cadence)
  WHERE status = 'active';

-- The bills view: what is coming up, soonest first. NULLS LAST so an
-- unprojectable bill never heads the list and reads as the most imminent.
CREATE INDEX IF NOT EXISTS idx_recurring_bills_client_next
  ON recurring_bills (client_id, next_expected_date NULLS LAST)
  WHERE status = 'active';

-- A confirmed bill must record who confirmed it and when. Otherwise 'confirmed'
-- is a word rather than a fact, and it outranks the detector on the strength of
-- nothing.
ALTER TABLE recurring_bills DROP CONSTRAINT IF EXISTS recurring_bills_confirmed_provenance;
ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_confirmed_provenance
  CHECK (source <> 'confirmed' OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL));

-- A row that projects a next date must have a cadence to project from.
-- 'irregular' means we could not find one, so a projected date would be
-- arithmetic performed on an admission of ignorance.
ALTER TABLE recurring_bills DROP CONSTRAINT IF EXISTS recurring_bills_projection_needs_cadence;
ALTER TABLE recurring_bills ADD CONSTRAINT recurring_bills_projection_needs_cadence
  CHECK (next_expected_date IS NULL OR cadence <> 'irregular');

COMMENT ON TABLE recurring_bills IS
  'Bills INFERRED from transaction patterns. EVERY ROW IS A GUESS: nothing here is reported by a bank. confidence is NOT NULL and CHECKed below 1, because there is no certain inference from this data and a screen must be able to tell twelve identical insurance payments from two coffee visits three weeks apart. Amounts are POSITIVE here, unlike bank_transactions. See db/migrations/086_recurring_bills.sql.';

COMMENT ON COLUMN recurring_bills.confidence IS
  '0..0.99, NOT NULL, never 1. A detected bill rendered with the weight of a known fact is the failure this table is shaped around — somebody planning their month around a mortgage assembled out of two coincidences.';

COMMENT ON COLUMN recurring_bills.next_expected_date IS
  'NULL when the cadence is too weak to project — common, and the honest answer. NOT today and NOT last_seen + 30. A CHECK forbids projecting from an irregular cadence.';

COMMENT ON COLUMN recurring_bills.cadence IS
  'irregular is a real answer, not a fallback. Money does leave for the same merchant repeatedly with no cadence, and labelling that monthly because it is the commonest option invents a schedule.';
