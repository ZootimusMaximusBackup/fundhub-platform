-- 086_recurring_bills.sql — the recurring outflows detected in
-- `bank_transactions`, with the confidence that they are real and the
-- transactions that prove it.
--
-- *** THIS FILE CONNECTS TO NOTHING, SCHEDULES NOTHING AND REMINDS NOBODY. ***
-- No outbound call, no cron, no job row a worker polls, no activation flag.
-- Projections and reminders are a different workflow (W8) and are not here.
-- Detection itself is PURE code in src/banking/recurring.mjs — no clock, no
-- I/O, `now` passed in as a parameter — and this table is only where its answer
-- is written down.
--
--
-- ============================================================================
-- 1. THE ONE THING THIS TABLE IS FOR: NOT PRETENDING TO KNOW.
-- ============================================================================
--
-- A recurring bill is an INFERENCE. Nobody told us the client pays $54.99 to
-- an internet provider every month; we noticed three similar charges and
-- guessed. The whole value of the row is therefore in how good the guess is,
-- and the whole danger is in a guess being read as a fact. AUDIT-FINDINGS spent
-- its most expensive lessons on precisely this shape of failure — a mint "live"
-- banner over sample data, a KPI tile that says 11 agents are acting on real
-- clients when 2 are. A fabricated bill in a cash-flow projection is the same
-- mistake with money attached.
--
-- So the schema refuses to let the guess be stored as a fact:
--
--   (a) confidence_pct and confidence_label are NOT NULL. There is no way to
--       write a row that does not state how sure it is.
--   (b) next_expected_on is NULLABLE, and the CHECK
--       recurring_bills_next_expected_reason_ck makes NULL and
--       next_expected_unknown_reason MUTUALLY REQUIRED — exactly one of the two
--       is always set. *** A ROW CANNOT SAY "I DO NOT KNOW THE NEXT DATE"
--       WITHOUT SAYING WHY. *** And it cannot hold a plausible-looking date it
--       does not believe, because a caller can always tell the two apart.
--   (c) occurrence_count is NOT NULL with a floor of 2, so "how much evidence"
--       travels with the row and is never inferred from the join table.
--
-- CLAUDE.md's rule, stated in the repo's own words: "Never invent. If
-- information is missing, that absence is the finding." This table is that rule
-- expressed as constraints.
--
-- TWO OCCURRENCES ARE NOT A PATTERN. Two charges thirty days apart are also two
-- charges that happened to be thirty days apart. src/banking/recurring.mjs caps
-- a two-occurrence detection at the 'low' label and REFUSES to emit a next
-- expected date for it; the reason string it writes here is
-- 'two_occurrences_is_a_guess_not_a_cadence'. The database does not enforce
-- that rule (a count and a confidence are independent facts and a CHECK
-- coupling them would be asserting the detector's policy in the schema) but it
-- does make the rule VISIBLE: any reader can run
-- `WHERE occurrence_count = 2 AND next_expected_on IS NOT NULL` and get zero
-- rows for as long as the detector is honest. That query is a live audit of the
-- policy, and src/banking/recurring.pg.test.mjs runs it.
--
--
-- ============================================================================
-- 2. THE SIGN CONVENTION, ENFORCED RATHER THAN DOCUMENTED.
-- ============================================================================
--
-- 085_bank_transactions.sql section 1 is the authority:
--   NEGATIVE amount_cents = money LEFT the account (outflow).
--   POSITIVE amount_cents = money ENTERED the account (inflow).
--
-- A BILL IS AN OUTFLOW. So:
--
--   typical_amount_cents bigint NOT NULL CHECK (typical_amount_cents < 0)
--
-- This is the only place in the banking thread where the convention is enforced
-- by the database rather than described. It exists because getting inflow and
-- outflow backwards does not fail — it silently inverts every cash-flow number
-- downstream, and a client's salary would be stored here as their largest
-- monthly bill. If an ingest ever forgets to negate at the Plaid boundary,
-- THIS CHECK IS WHAT FAILS, loudly, at the first write, instead of a projection
-- quietly reporting that the client's rent is income.
--
-- Storing the amount as a negative number rather than as a positive "bill
-- amount" is deliberate and is the same choice for the same reason: one
-- convention across the whole thread, so a bill can be summed together with a
-- transaction with no CASE and no sign flip in between.
--
--
-- ============================================================================
-- 3. THE EVIDENCE LINK IS A JOIN TABLE, NOT AN ARRAY COLUMN.
-- ============================================================================
--
-- `recurring_bill_transactions` holds one row per (bill, transaction). The
-- obvious alternative — `evidence_transaction_ids uuid[]` on the bill — was
-- rejected:
--
--   1. AN ARRAY CANNOT HAVE A FOREIGN KEY. Postgres will not enforce element
--      references, so deleting a transaction would leave a dangling uuid in the
--      array and the bill would keep claiming evidence that no longer exists.
--      A bill whose proof has silently evaporated is worse than no bill.
--   2. IT CANNOT BE JOINED CHEAPLY the way a human checking a bill by hand
--      needs to ("show me the four charges behind this"), and unnest() in every
--      such query is a trap waiting for someone to forget it.
--   3. AN ARRAY CANNOT BE UNIQUE PER PAIR, so the same transaction could be
--      listed twice as evidence for one bill and inflate the apparent proof.
--      uq_recurring_bill_transactions does exactly that job.
--
-- ON DELETE CASCADE from both sides: purging an account's transactions purges
-- the evidence rows with them (the bill's occurrence_count then no longer
-- matches its evidence, which IS the correct signal that the bill is stale and
-- must be re-detected — it is not silently repaired here). Deleting a bill
-- removes its links and nothing else; the transactions are the record and
-- outlive every inference drawn from them.
--
-- WHY occurrence_count IS STORED AND NOT COUNTED FROM THE JOIN TABLE. They can
-- disagree, and when they do that disagreement is information: occurrence_count
-- is what the DETECTOR saw at detected_as_of, the join table is what SURVIVES
-- today. A derived count would erase the difference. This is the same reasoning
-- 065 gave for mail_campaigns.records_ordered ("NOT a count of mail_universe
-- rows ... the difference between it and what actually loaded is a
-- reconciliation signal worth being able to see").
--
--
-- ============================================================================
-- 4. detected_as_of — THE CLOCK THE ANSWER USED, WRITTEN DOWN.
-- ============================================================================
--
-- src/banking/recurring.mjs takes `now` as a PARAMETER and reads no clock. That
-- is what makes it testable and auditable: the same rows and the same `now`
-- always produce the same answer, on any machine, on any day, forever. That
-- property is worth nothing if the instant is then thrown away, because
-- "is this bill overdue" and "should this have rolled forward" are questions
-- only answerable against the clock the detector was given.
--
-- So `detected_as_of` is NOT NULL and is NOT `DEFAULT now()`. The writer must
-- pass the same `now` it passed the detector. A default would quietly stamp the
-- write time instead of the evaluation time and re-introduce, in the schema, the
-- exact hidden clock the module was written to avoid.
--
-- `created_at`/`updated_at` keep the write time, which is a different fact.
--
--
-- ============================================================================
-- 5. RE-DETECTION UPSERTS. IT DOES NOT ACCUMULATE.
-- ============================================================================
--
-- uq_recurring_bills_account_merchant_cadence on
-- (bank_account_id, merchant_key, cadence) makes a re-run an ON CONFLICT
-- UPDATE. Without it, running detection weekly would leave fifty-two rows for
-- one Netflix subscription and any sum over the table would report a client's
-- outgoings as fifty-two times their true value — the same class of arithmetic
-- failure as the double-counted webhook in AUDIT-FINDINGS, arrived at from the
-- other direction.
--
-- CADENCE IS PART OF THE KEY, not just merchant. A merchant genuinely can bill
-- on two cadences at once (a monthly subscription plus an annual renewal on the
-- same account, which is a common upgrade shape). Keying on merchant alone
-- would make the annual charge overwrite the monthly one every re-run and the
-- client would lose a bill they actually pay.
--
-- merchant_key IS THE NORMALISED NAME, not the raw one. Raw provider strings
-- carry store numbers and reference ids that change every month
-- ("SQ *BLUE BOTTLE 4471" vs "SQ *BLUE BOTTLE 8813"), so keying on raw would
-- defeat the unique index entirely and produce a new "bill" per charge.
-- normaliseMerchant() in src/banking/recurring.mjs produces this value, is pure
-- and is unit-tested. merchant_display keeps a raw example alongside it, because
-- a normalised key is for machines and a human still needs to recognise the
-- merchant.
--
--
-- ============================================================================
-- 6. is_business IS NULLABLE AND NULL IS THE HONEST DEFAULT.
-- ============================================================================
--
-- Nothing in a transaction row says whether a charge is business or personal.
-- The provider does not know, the merchant name does not say, and a category
-- string like "Utilities" is true of both. It is a property of the ACCOUNT (or
-- of a human's judgement), not of the transaction, and this thread does not own
-- the account model — see 085 section 4.
--
-- So the column is three-valued and NULL means UNKNOWN, not false. It is never
-- defaulted, never inferred from a keyword list, and the detector only sets it
-- when the CALLER supplies an account-level fact to set it from; otherwise it
-- returns null and names the reason. Defaulting it to false would be inventing
-- a finance fact about a client's taxes, which is exactly the thing CLAUDE.md
-- forbids and exactly the thing a regulated consumer-finance product cannot do.
--
--
-- ============================================================================
-- 7. WHAT IS NOT HERE.
-- ============================================================================
--
-- No `next_reminder_at`, no `notify` flag, no `projected_balance`, no
-- `is_active` / `enabled` / `paused` boolean. Reminders and projections are W8;
-- a status vocabulary containing a present-tense sending state invites code
-- that tries to advance a row into it (065's header makes the same argument at
-- length, and it applies here for the same reason). A bill that has stopped
-- being paid is expressed by its evidence going stale and its confidence
-- falling on re-detection, not by a boolean somebody has to remember to flip.


-- ---------------------------------------------------------------------------
-- A. recurring_bills — one row per (account, merchant, cadence)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_bills (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES orgs(id),

  -- The account whose outflows these are. NO FOREIGN KEY, for the reason
  -- 085_bank_transactions.sql section 4 sets out at length: the bank_accounts
  -- table is owned by the Plaid-link workflow and does not exist yet. Reported
  -- gap on the shared board, resolved by a LATER migration after an orphan
  -- sweep — never by editing this file, which migrate.mjs would ignore.
  bank_account_id             uuid NOT NULL,

  -- Whose bill it is. SET NULL rather than CASCADE, same as
  -- bank_transactions.client_id: deleting a client must not destroy the record
  -- that the money moved.
  client_id                   uuid REFERENCES clients(id) ON DELETE SET NULL,

  -- The normalised merchant name — the grouping key, produced by
  -- normaliseMerchant() in src/banking/recurring.mjs. Part of the unique key.
  -- See section 5 for why this and not the raw string.
  merchant_key                text NOT NULL,

  -- A raw provider name for this merchant, kept so a human can recognise it.
  -- One representative example, not a list: the raw strings differ per charge
  -- and picking one is enough to identify the merchant to a person.
  merchant_display            text,

  -- weekly / biweekly / monthly / annual. A closed vocabulary because the
  -- detector emits exactly these four and nothing else can be written by
  -- anything that is not the detector — unlike the provider-supplied
  -- vocabularies in 085, which are open because a provider owns them.
  cadence                     text NOT NULL,

  -- *** NEGATIVE. A BILL IS AN OUTFLOW. *** Integer cents, per
  -- src/commissions/money.mjs. The CHECK below is the enforcement point for the
  -- whole thread's sign convention — see section 2.
  --
  -- "Typical", not "last" and not "average": the detector uses the MEDIAN of
  -- the occurrences, because one $300 annual-renewal outlier inside a $12
  -- monthly subscription would drag a mean somewhere neither figure ever was.
  typical_amount_cents        bigint NOT NULL,

  -- When the detector expects the next charge. NULLABLE, and NULL is a real,
  -- frequent and correct answer — see section 1. Exactly one of this and
  -- next_expected_unknown_reason is always set; the CHECK enforces it.
  --
  -- A `date` and not a timestamptz: a bill lands on a day. Predicting an
  -- instant would be false precision.
  next_expected_on            date,

  -- WHY there is no next expected date, when there is none. A stable
  -- snake_case reason string produced by the detector, e.g.
  -- 'two_occurrences_is_a_guess_not_a_cadence' or
  -- 'no_occurrence_in_recent_periods_bill_may_have_ended'. NOT free-form prose:
  -- a caller branches on it, and the same rationale as MailResponseError.code
  -- in src/mail/responses.mjs applies.
  next_expected_unknown_reason text,

  -- How sure the detector is, 0-100.
  --
  -- AN INTEGER PERCENT AND NOT A FLOAT. This repo does not store floats for
  -- anything a decision is made on; a confidence is compared against a
  -- threshold and 0.7000000000000001 > 0.7 is not a conversation anyone should
  -- have to have. 0-100 integers compare exactly, forever.
  --
  -- 100 IS NOT REACHABLE and that is deliberate: the detector clamps at 95,
  -- because nothing inferred from a transaction history is certain. The CHECK
  -- allows 100 anyway rather than encoding the detector's clamp as a schema
  -- rule — the schema bounds what is meaningful, the module owns its policy.
  confidence_pct              integer NOT NULL,

  -- The band, so a reader does not have to know the detector's thresholds.
  --   high   — safe to show to a person as a bill.
  --   medium — safe to show, worth a hedge.
  --   low    — A GUESS. Never present this as a bill. Two occurrences land
  --            here, always, whatever the fit looks like.
  --   none   — no usable cadence at all.
  -- Stored alongside the number rather than derived in every reader, so that
  -- moving a threshold moves it in one place and old rows keep the band they
  -- were actually judged under.
  confidence_label            text NOT NULL,

  -- THREE-VALUED. NULL = UNKNOWN, and unknown is the normal state. NOT false.
  -- Section 6 is the argument. Never inferred from a merchant name.
  is_business                 boolean,

  -- How many transactions the detector saw, at detected_as_of. Stored rather
  -- than counted from the join table on purpose — section 3.
  -- Floor of 2: one charge is not recurring, and a row claiming otherwise is a
  -- bug in the writer.
  occurrence_count            integer NOT NULL,

  -- The window the evidence spans. Both NOT NULL — a detection always has a
  -- first and last occurrence by construction, so NULL here would mean the
  -- writer lost data, not that the fact is unknown.
  first_seen_on               date NOT NULL,
  last_seen_on                date NOT NULL,

  -- THE CLOCK THE ANSWER USED. Deliberately NOT `DEFAULT now()` — section 4.
  detected_as_of              timestamptz NOT NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recurring_bills_cadence_ck
    CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'annual')),

  -- *** THE SIGN CONVENTION, ENFORCED. A BILL IS AN OUTFLOW. ***
  -- If this fails, an ingest forgot to negate at the provider boundary. Fix the
  -- ingest; do not relax this. Section 2.
  CONSTRAINT recurring_bills_outflow_ck
    CHECK (typical_amount_cents < 0),

  -- *** A NULL NEXT DATE MUST CARRY A REASON, AND A KNOWN DATE MUST NOT. ***
  -- Exactly one of the pair, always. This is the constraint that makes "we do
  -- not know" a first-class answer instead of an absence someone will later
  -- fill in with something plausible.
  CONSTRAINT recurring_bills_next_expected_reason_ck
    CHECK ((next_expected_on IS NULL) <> (next_expected_unknown_reason IS NULL)),

  CONSTRAINT recurring_bills_confidence_range_ck
    CHECK (confidence_pct BETWEEN 0 AND 100),

  CONSTRAINT recurring_bills_confidence_label_ck
    CHECK (confidence_label IN ('none', 'low', 'medium', 'high')),

  CONSTRAINT recurring_bills_occurrences_ck
    CHECK (occurrence_count >= 2),

  CONSTRAINT recurring_bills_window_ck
    CHECK (last_seen_on >= first_seen_on),

  CONSTRAINT recurring_bills_merchant_key_ck
    CHECK (btrim(merchant_key) <> ''),

  -- A reason string is branched on, so an empty one is worse than none.
  CONSTRAINT recurring_bills_reason_nonempty_ck
    CHECK (next_expected_unknown_reason IS NULL
           OR btrim(next_expected_unknown_reason) <> '')
);

-- RE-DETECTION UPSERTS RATHER THAN ACCUMULATING. Section 5.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_bills_account_merchant_cadence
  ON recurring_bills (bank_account_id, merchant_key, cadence);

-- The client read: what does this person pay out, biggest first. Ordered by
-- amount ASC because the amounts are negative, so ASC is largest outflow first.
CREATE INDEX IF NOT EXISTS idx_recurring_bills_client
  ON recurring_bills (client_id, typical_amount_cents)
  WHERE client_id IS NOT NULL;

-- The cash-flow read: what is due next, for bills good enough to act on. The
-- partial predicate is the point — it is impossible to accidentally page a
-- low-confidence guess into a projection through this index. A caller that
-- wants the guesses must ask for them by name.
CREATE INDEX IF NOT EXISTS idx_recurring_bills_due_confident
  ON recurring_bills (bank_account_id, next_expected_on)
  WHERE next_expected_on IS NOT NULL
    AND confidence_label IN ('medium', 'high');


-- ---------------------------------------------------------------------------
-- B. recurring_bill_transactions — the evidence, one row per (bill, txn)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_bill_transactions (
  recurring_bill_id     uuid NOT NULL
                          REFERENCES recurring_bills(id) ON DELETE CASCADE,

  -- CASCADE, not SET NULL: an evidence link to a transaction that no longer
  -- exists is not evidence. When these rows go, occurrence_count on the bill
  -- stops matching the surviving evidence, and that mismatch is the signal that
  -- the bill needs re-detecting. Section 3 — it is deliberately not repaired
  -- here by a trigger.
  bank_transaction_id   uuid NOT NULL
                          REFERENCES bank_transactions(id) ON DELETE CASCADE,

  created_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (recurring_bill_id, bank_transaction_id)
);

-- The reverse read: "what did this charge get counted towards?" — which is the
-- question asked when a detected bill looks wrong and someone works backwards
-- from a single transaction on a statement.
CREATE INDEX IF NOT EXISTS idx_recurring_bill_transactions_txn
  ON recurring_bill_transactions (bank_transaction_id);

COMMENT ON TABLE recurring_bills IS
  'Detected recurring OUTFLOWS. typical_amount_cents is NEGATIVE by CHECK (085 sign convention). next_expected_on NULL always carries next_expected_unknown_reason, and vice versa — a detection that is not confident states that it does not know rather than emitting a plausible date.';

COMMENT ON COLUMN recurring_bills.confidence_label IS
  'none/low/medium/high. ''low'' is a GUESS and must never be presented to a person as a bill; a two-occurrence detection is always capped here.';

COMMENT ON COLUMN recurring_bills.is_business IS
  'Three-valued. NULL = UNKNOWN, which is the normal state. Never inferred from a merchant name or category.';

COMMENT ON COLUMN recurring_bills.detected_as_of IS
  'The `now` that was passed into the pure detector, not the write time. Deliberately has no DEFAULT.';
