-- 276_subscription_billing.sql — the recurring billing rail: a next-charge
-- column, and the ledger that makes charging a card twice impossible.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). This file is a payment-rail and
-- fee-timing change. It adds the schedule money is asked for and the record of
-- every attempt to take it. NOTHING IN THIS FILE CHARGES ANYTHING — the code
-- that would call a processor is src/subscriptions/charger.mjs, which ships
-- with no processor registered and refuses to run unless one is (see below).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
--
-- 075_subscriptions.sql records the arrangement — tier, price, card, period —
-- and says so at length in its own header: "NO BILLING RUN, NO CHARGE PATH, NO
-- SCHEDULER. ... There is no `next_charge_at` a worker could poll". 271 added
-- partner_id and repeated the same note. So today a client or a partner can sit
-- `status='active'` on a priced plan that has never billed and never will, and
-- nothing in the platform can tell the difference between that and one that is
-- paid up.
--
-- This file adds the two columns a scheduler needs and the ledger the scheduler
-- writes through. 075's own reason for leaving them out was that charging a
-- card "needs compliance review before a line of it exists" — the review label
-- is at the top of this file and at the top of every module that reads it.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT COMMAS CAN ACTUALLY DO, WHICH IS WHAT DECIDED THE DESIGN
--
-- The whole confirmed outbound surface for this processor is two calls:
--
--   GET  /payments/:id          src/payments/commas-api.mjs getPayment()
--                               Read one payment we already know the id of.
--   POST /checkout-sessions     src/payments/commas-api.mjs createCheckoutSession()
--                               Mint a payment LINK for a human to click.
--                               The only `type` this repo has ever sent is
--                               "onetime_non_reusable".
--
-- There is NO create-subscription call, NO cancel-subscription call, and NO
-- merchant-initiated "charge this stored token" call anywhere in the adapter.
-- src/adapters/commas.mjs parses inbound subscription-shaped webhook events,
-- but parsing an event they might send is not the same as being able to ask
-- them for a recurring charge. `client_cards` holds a processor token and
-- nothing in this repository has ever charged one.
--
-- So Commas exposes no subscription primitive we can rely on, and the honest
-- design is OUR OWN SCHEDULER creating one charge per cycle against a stored
-- instrument. That is what this file supports. It also means the charge call
-- itself is a seam with nothing behind it yet: inventing a POST /charges
-- because a processor probably has one is exactly the guess that ends with
-- money moving in a way nobody can explain.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ONE THING THIS MUST MAKE IMPOSSIBLE: CHARGING THE SAME PERIOD TWICE
--
-- A sweeper runs on a clock. It gets replayed. Two of them overlap when one
-- pass runs long. A retry after a crash cannot tell whether the crash happened
-- before or after the processor took the money. Every one of those is a double
-- charge if the only thing stopping it is a check in JavaScript, because a
-- check in JavaScript cannot close the window between its SELECT and its call.
--
-- `subscription_charges` closes it in the database instead:
--
--   UNIQUE (subscription_id, period_start)
--
-- One row per subscription per billing period, forever. The sweeper CLAIMS a
-- period by inserting that row BEFORE it calls a processor, and the insert is
-- what decides who wins. A second sweeper — a replay, a concurrent pass, a
-- restarted container — conflicts, gets zero rows back, and never makes the
-- call. There is no code path that charges without holding the row.
--
-- The ON CONFLICT clause the sweeper uses re-claims a row ONLY when it is
-- `failed`, under the attempt ceiling, and past its backoff. It therefore
-- cannot re-claim a row that is:
--   'succeeded'  — that period is paid. The sweeper's job is now to advance the
--                  subscription window, which costs nothing and takes no money.
--   'in_flight'  — a previous attempt called the processor and never came back.
--                  WE DO NOT KNOW WHETHER THE MONEY MOVED. Retrying here is the
--                  one action that can actually take it twice, so the row is
--                  left alone and reported for a human to reconcile against
--                  GET /payments/:id. A stuck row is a support ticket; a second
--                  charge is a chargeback and a compliance incident.
--   'abandoned'  — retries exhausted. The subscription is past_due and dunning
--                  is a human decision, not a louder loop.
--
--
-- WHY THE PERIOD, NOT A UUID, IS THE IDEMPOTENCY ANCHOR. The same call
-- src/adapters/commas.mjs makes about `data.payment_id` versus the envelope
-- `id`: a per-attempt key makes two attempts look like two different charges,
-- which is precisely the thing being prevented. `idempotency_key` is stored as
-- well — it is what a processor would be handed — but the constraint that
-- decides is the period, because the period is the fact.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL STILL MEANS UNKNOWN (CLAUDE.md §12)
--
-- `next_charge_at` NULL  = this arrangement is not on a billing schedule. It is
--                          not "due now" and it is not "due at the epoch". The
--                          sweeper's WHERE clause skips it entirely, so every
--                          subscription that exists today — all of which have
--                          no schedule — stays exactly as unbilled as it is
--                          now. Turning billing on for a row is an explicit
--                          write, never a migration side effect.
-- `billing_interval` NULL = nobody recorded whether this repeats monthly or
--                          annually. 075 refused to invent this column from a
--                          guess and this file does not invent the VALUES
--                          either: the column is added empty and a row is not
--                          billable until somebody sets it.
-- `price_cents` NULL     = 075's rule, unchanged. An unrecorded price is not a
--                          free plan and is never charged.
--
-- BACKFILL: NONE. Not one existing row is touched. There is no UPDATE in this
-- file and no DEFAULT that would write one.
--
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- 1. NO PARTNER INSTRUMENT. 271 added `subscriptions_partner_card_chk`
--    (partner_id IS NULL OR card_id IS NULL) because there is no partner card
--    table in this repository. That is unchanged and deliberate: a partner
--    subscription today has no instrument, so the sweeper can never charge one.
--    It selects partner rows, finds no instrument, and SKIPS — it does not
--    fail them, because burning a retry and flipping a partner to past_due for
--    a gap in our own schema would be blaming the customer for our missing
--    table. Recorded as a finding, not filled in with a guess.
-- 2. NO REFUND OR PRORATION MODEL. Same call 075 made. A reversal is RECORDED
--    (`reversed_at`) and never recovered — owner-set: a post-payment reversal
--    is FundHub's loss. There is no clawback column because there is no
--    clawback.
-- 3. NO RLS. `subscriptions` carries none (checked against the schema), and a
--    child table locked differently from its parent is the drift
--    src/security/rls-shape.test.mjs exists to catch.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of an existing row,
-- nothing revoked. A new file rather than an edit of 075 or 271, because
-- db/migrate.mjs keys schema_migrations by '<dir>/<file>' and editing an
-- applied migration is a silent no-op (CLAUDE.md §12).

-- ---------------------------------------------------------------------------
-- 1. The schedule.
-- ---------------------------------------------------------------------------

-- WHEN THE NEXT CHARGE IS DUE, and simultaneously WHERE THE NEXT PERIOD STARTS.
-- One column carrying both is not overloading: charging in advance means the
-- money for [T, T+interval) is asked for at T, so "when do we ask" and "what
-- are we buying" are the same instant. Two columns could disagree, and the one
-- that disagreed would decide what the customer paid for.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS next_charge_at timestamptz;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval text;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_chk;

-- Two values, and no more, because those are the two the pricing menu actually
-- sells (docs/specs/W6-pricing-menu.md: monthly add-ons; Lead Flow is per
-- booked call and is therefore NOT a subscription — it is a usage sale and does
-- not belong on this rail at all). A third value arrives with the product that
-- needs it.
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_chk
  CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'annual'));

-- A schedule with no cadence cannot advance: the sweeper would charge for a
-- period whose end it cannot compute. Refuse the half-configured row at write
-- time rather than discovering it at 3 a.m. in a cron.
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_schedule_coherent_chk;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_schedule_coherent_chk
  CHECK (next_charge_at IS NULL OR billing_interval IS NOT NULL);

-- The sweeper's only read. Partial so it stays the size of the billable set
-- rather than the size of the table — today that is zero rows.
CREATE INDEX IF NOT EXISTS subscriptions_due_idx
  ON subscriptions (next_charge_at)
  WHERE next_charge_at IS NOT NULL AND effective_to IS NULL;

COMMENT ON COLUMN subscriptions.next_charge_at IS
  'When the next charge is due, and the start of the period that charge buys. NULL = not on a billing schedule; the sweeper skips it. Moves freely (it is not a term).';
COMMENT ON COLUMN subscriptions.billing_interval IS
  'monthly | annual. NULL = nobody recorded a cadence, so the row is not billable. Frozen once set — it is a term, see trg_subscriptions_terms_immutable.';

-- ---------------------------------------------------------------------------
-- 2. billing_interval is a TERM, and terms are frozen.
--
-- 271's body verbatim, with billing_interval added to the same check. Replacing
-- the function is enough — trg_subscriptions_terms_immutable binds it by name.
--
-- WHY IT IS A TERM AND next_charge_at IS NOT. Moving a monthly plan to annual
-- changes what the customer pays over a year while `price_cents` stays the
-- same, so an UPDATE would restate history exactly the way an UPDATE of the
-- price would — the failure 075 built this trigger to stop. Changing the
-- cadence closes the row and opens a new one, like every other term change.
-- `next_charge_at` is the opposite: it MUST move, every single period, and it
-- restates nothing about the past.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    RAISE EXCEPTION
      'subscriptions %: org_id, client_id and partner_id are immutable — a subscription cannot be moved to another client, partner or org',
      OLD.id;
  END IF;

  IF NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION
      'subscriptions %: tier, price and effective_from are immutable — close this row (effective_to) and INSERT the new terms',
      OLD.id;
  END IF;

  -- Setting a cadence for the first time is configuration, not a restatement:
  -- NULL -> 'monthly' is how billing gets switched on for a row that predates
  -- this migration. Changing one cadence to another is a term change.
  IF OLD.billing_interval IS NOT NULL
     AND NEW.billing_interval IS DISTINCT FROM OLD.billing_interval THEN
    RAISE EXCEPTION
      'subscriptions %: billing_interval is immutable once set — close this row (effective_to) and INSERT the new terms',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. The ledger. One row per subscription per period, and that is the whole
--    anti-double-charge mechanism.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  -- ON DELETE CASCADE matches client_id on `subscriptions` (075) and partner_id
  -- (271). Consistency inside the family beats a private preference.
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  -- What we would hand a processor as its idempotency header. Recorded, but it
  -- is NOT what adjudicates — the period below is. See the header.
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),

  -- The period this money buys. period_start is the subscription's
  -- next_charge_at at the moment of the claim.
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,

  -- Integer cents, `_cents` suffix, as 054/075 established. Strictly positive:
  -- a zero-amount charge is not a charge, and NULL price_cents means unknown
  -- and is never billed, so neither can ever reach this table.
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL CHECK (btrim(currency) <> ''),

  --   in_flight  — claimed; a processor call is out or died mid-call. NEVER
  --                retried automatically. See the header.
  --   succeeded  — the money moved. Terminal.
  --   failed     — this attempt did not take. Retryable until the ceiling.
  --   abandoned  — the ceiling was reached. Terminal. Subscription is past_due.
  status          text NOT NULL DEFAULT 'in_flight'
                  CHECK (status IN ('in_flight', 'succeeded', 'failed', 'abandoned')),

  attempt         int NOT NULL DEFAULT 1 CHECK (attempt >= 1),

  provider        text NOT NULL DEFAULT 'commas' CHECK (btrim(provider) <> ''),
  provider_ref    text,

  -- Why it did not take. A short machine code plus the sentence a human reads.
  failure_code    text,
  failure_reason  text,
  next_retry_at   timestamptz,

  charged_at      timestamptz,

  -- A REVERSAL IS RECORDED AND NEVER RECOVERED (owner-set). A chargeback, a
  -- refund or a bank reversal after the fact is FundHub's loss; there is no
  -- clawback column here because there is no clawback anywhere in this product.
  -- Marking a charge reversed does NOT re-open its period: the period was sold,
  -- and re-charging it is the double charge this whole table prevents.
  reversed_at     timestamptz,
  reversal_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_charges_period CHECK (period_end > period_start),

  -- Both or neither. A succeeded charge with no time on it cannot be matched to
  -- a payout, and a charged_at on a failed row reads as money that moved.
  CONSTRAINT subscription_charges_charged_coherent CHECK (
    (status = 'succeeded') = (charged_at IS NOT NULL)
  ),

  -- Only money that moved can come back.
  CONSTRAINT subscription_charges_reversal_coherent CHECK (
    reversed_at IS NULL OR status = 'succeeded'
  )
);

-- ***************************************************************************
-- THE CONSTRAINT THIS ENTIRE MIGRATION IS FOR.
--
-- One charge row per subscription per period. A replayed sweep, a concurrent
-- pass and a restarted container all collide here, and the loser gets zero rows
-- back from its claim and never calls a processor.
--
-- If this is ever dropped, the platform can charge a partner twice.
-- ***************************************************************************
CREATE UNIQUE INDEX IF NOT EXISTS subscription_charges_period_uq
  ON subscription_charges (subscription_id, period_start);

-- The key as a processor would see it, unique inside a tenant. Scoped per org
-- for the reason 075 gives about provider_ref: a global key lets whichever org
-- wrote a value first hold it against every other org.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_charges_key_uq
  ON subscription_charges (org_id, subscription_id, idempotency_key);

-- The audit read: what did we try to take off this subscription, and when.
CREATE INDEX IF NOT EXISTS subscription_charges_sub_idx
  ON subscription_charges (org_id, subscription_id, period_start DESC);

-- The operations read: what is stuck, and what is owed a retry.
CREATE INDEX IF NOT EXISTS subscription_charges_open_idx
  ON subscription_charges (org_id, status, next_retry_at)
  WHERE status IN ('in_flight', 'failed');

DROP TRIGGER IF EXISTS trg_subscription_charges_updated ON subscription_charges;
CREATE TRIGGER trg_subscription_charges_updated BEFORE UPDATE ON subscription_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_charges IS
  'One row per subscription per billing period. The UNIQUE (subscription_id, period_start) index is what makes a replayed billing sweep structurally unable to charge the same period twice: the sweeper claims the row before calling a processor and never calls without it.';
