-- 075_subscriptions.sql — the recurring side of the Client Finance OS: what a
-- client is on, what it costs, which instrument pays for it, and every version
-- of that arrangement there has ever been.
--
-- WHY THIS EXISTS. `transactions` (001_init.sql:152) records money that already
-- arrived, one row per payment, keyed on a product STRING. `sales` (011) records
-- a one-off purchase at an agreed price. Neither can answer "what is this client
-- paying us every month, starting when, on whose card" — the question the
-- Finance OS is built around. There is no table in the schema that carries a
-- recurring arrangement, so today the answer lives in the payment processor and
-- nowhere else, and the platform cannot show, bill against, or audit it.
--
--
-- EFFECTIVE DATING, AND WHY A PLAN CHANGE OPENS A ROW INSTEAD OF EDITING ONE.
-- This table follows 013_commission_rules.sql exactly: a change closes the live
-- row (effective_to = the moment of change) and INSERTS a new one. There is no
-- UPDATE path that can restate what a client was paying last month.
--
-- The reason is not tidiness. Every downstream reader of this table — an
-- invoice, a revenue report, a dispute, a chargeback response, a refund
-- calculation — is asking "what were the terms ON A DATE". An UPDATE in place
-- answers that question with today's price for every date in history, silently,
-- and the wrong answer looks exactly like the right one. A regulated
-- consumer-finance product cannot have a price that retroactively changes.
--
-- The database enforces this, it is not left to convention:
--   * `subscriptions_no_overlap` — two versions of one client's subscription can
--     never cover the same instant.
--   * `trg_subscriptions_terms_immutable` — an UPDATE that changes tier,
--     price_cents, currency, effective_from, org_id or client_id RAISES. The
--     columns that legitimately move on a live row (status, cancelled_at,
--     effective_to, the period window, card_id) are left alone.
--
--
-- THERE IS NO TIER PRICE ANYWHERE IN THIS REPOSITORY, AND THIS FILE DOES NOT
-- INVENT ONE. 013_commission_rules.sql:1 states the rule the whole schema is
-- built on: "every rate is a row, there are no rates in code". The tier prices
-- for this product do not exist as rows — not in `products` (010/015, which
-- models one-off purchases with a `default_price` PREFILL and has no recurring
-- concept at all), not in `config_defaults` (052), nowhere. The rebuild plan's
-- addendum, which names the tiers, is not in this repository either.
--
-- So `price_cents` is carried ON THE SUBSCRIPTION and it is NULLABLE, and NULL
-- means "nobody has recorded what this costs" — an unknown that must survive.
-- It is not defaulted to zero. A zero here would be a free subscription that
-- bills nothing and reads as a decision somebody made.
--
-- `tier` is text with NO CHECK LIST. The same call 065_mail_campaigns.sql:89
-- made about outcome tiers: an invented tier list is a guess wearing a
-- constraint, and it fails a legitimate row at 2am rather than a wrong one at
-- design time. When the addendum's tier names are in the repository as rows,
-- a later migration can add the foreign key. It cannot be added honestly now.
--
--
-- THE CARD IS A POINTER, NEVER A NUMBER. `card_id` names a row in
-- `client_cards`, which is created by 076_client_cards.sql and holds A TOKEN
-- REFERENCE ONLY — no PAN, no CVV, ever. There is deliberately no token column
-- on this table: a token in two places is a token that gets rotated in one of
-- them. See 076's header for the storage rules and the constraints that enforce
-- them.
--
-- THE FOREIGN KEY IS ADDED IN 076, NOT HERE, and that is a sequencing fact
-- rather than a preference. db/migrate.mjs applies files in filename order, so
-- 075 runs before `client_cards` exists and cannot reference it. 076 adds
-- `subscriptions_card_fk` as its last statement. Running 075 alone leaves
-- `card_id` unconstrained for exactly one migration.
--
--
-- MONEY IS INTEGER CENTS, bigint, `_cents` suffix, as 054_tradelines.sql:49
-- established for new tables. numeric dollars is the older convention in this
-- schema and it is the wrong one for a value that gets summed across periods
-- and multiplied by a proration fraction. src/commissions/money.mjs is the only
-- place cents becomes dollars; `fromCents` returns a STRING.
--
--
-- WHAT WAS DELIBERATELY NOT DONE (1): NO BILLING RUN, NO CHARGE PATH, NO
-- SCHEDULER. Nothing in this file, and nothing in src/subscriptions/, moves
-- money or talks to a processor. There is no `next_charge_at` a worker could
-- poll and no `active` flag an env var could flip. `current_period_start/end`
-- describe the period the arrangement is IN — written after the fact, the same
-- way 065_mail_campaigns.sql's `dropped` is past tense. Charging a card is a
-- payment-rail change and needs compliance review before a line of it exists.
--
-- WHAT WAS DELIBERATELY NOT DONE (2): NO `supersedes_id` SELF-REFERENCE. The
-- version chain is already recoverable — order one client's rows by
-- effective_from — and a second representation of the same fact can disagree
-- with the first. If a chain pointer is ever wanted it is one additive
-- migration away.
--
-- WHAT WAS DELIBERATELY NOT DONE (3): NO BILLING INTERVAL COLUMN. 'monthly' vs
-- 'annual' is not recorded anywhere in this repository, and the period window
-- carries the actual dates. An `interval` column would have to be populated
-- from a guess, and every read of it would inherit the guess.
--
-- WHAT WAS DELIBERATELY NOT DONE (4): NO PRORATION, NO CREDIT, NO REFUND
-- MODELLING. What a mid-period upgrade owes is a compliance-flagged pricing
-- decision (fee timing), not a schema shape. The effective-dated rows preserve
-- every input such a calculation would need.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for the no-overlap exclusion below

CREATE TABLE IF NOT EXISTS subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The plan the client is on, as the addendum names it. Free text on purpose —
  -- see the header. Normalised to a trimmed, non-empty string by the CHECK so a
  -- stray '  ' cannot become a tier nobody can search for.
  tier         text NOT NULL CHECK (btrim(tier) <> ''),

  --   active     — in force, billing normally.
  --   past_due   — in force, a payment has failed. Access decisions are a
  --                separate question from this flag; this only records the
  --                money state.
  --   cancelled  — the client ended it. Paired with cancelled_at below, in both
  --                directions, by subscriptions_cancel_coherent.
  --
  -- There is no 'superseded' value, and that is deliberate: a row closed by a
  -- plan change is identified by effective_to IS NOT NULL AND cancelled_at IS
  -- NULL. A status value for it would let a row claim to be superseded while
  -- its window is still open.
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'past_due', 'cancelled')),

  -- What this arrangement costs per period, in integer cents.
  -- NULL = NOT RECORDED. It is not zero. See the header: no tier price exists
  -- as a row anywhere in this repository yet.
  price_cents  bigint CHECK (price_cents IS NULL OR price_cents >= 0),
  currency     text NOT NULL DEFAULT 'USD' CHECK (btrim(currency) <> ''),

  -- The payment instrument on file that pays for this. NULL is legitimate: a
  -- subscription can be recorded before a card is attached, and detaching a
  -- card must not delete the arrangement. FK added by 076 — it is composite,
  -- (card_id, client_id), so one client's subscription physically cannot point
  -- at another client's card.
  card_id      uuid,

  -- The processor's own id for this subscription, where one exists. `provider`
  -- matches the transactions convention (001_init.sql:159).
  provider     text NOT NULL DEFAULT 'commas' CHECK (btrim(provider) <> ''),
  provider_ref text,

  -- The period the arrangement is currently in. Both NULL until a period is
  -- known — an unknown period is not a period starting at the epoch.
  current_period_start timestamptz,
  current_period_end   timestamptz,

  -- When the client cancelled. Distinct from effective_to on purpose: a
  -- cancellation requested today commonly runs to the end of the paid period,
  -- so "when they asked" and "when it stopped applying" are different dates and
  -- collapsing them into one column loses the one a dispute turns on.
  cancelled_at timestamptz,

  -- EFFECTIVE DATING. To change a plan: set effective_to on the live row and
  -- INSERT a new row with effective_from = that same instant. Never UPDATE the
  -- tier or the price. The trigger below refuses it.
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,          -- NULL = still in effect

  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),

  -- Both ends or neither, and forward in time. A period that ends before it
  -- starts prices a negative number of days.
  CONSTRAINT subscriptions_period CHECK (
    (current_period_start IS NULL AND current_period_end IS NULL)
    OR (current_period_start IS NOT NULL AND current_period_end IS NOT NULL
        AND current_period_end > current_period_start)
  ),

  -- Cancelled means cancelled, in both directions. Without the reverse half, a
  -- row could carry a cancellation date while still reading as active — which
  -- is the row a billing run would happily charge.
  CONSTRAINT subscriptions_cancel_coherent CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
  )
);

-- The read every screen makes: this client's subscription, newest version
-- first, and the live one is the row with no effective_to.
CREATE INDEX IF NOT EXISTS subscriptions_client_idx
  ON subscriptions (org_id, client_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS subscriptions_live_idx
  ON subscriptions (org_id, client_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS subscriptions_card_idx ON subscriptions (card_id);

-- ---------------------------------------------------------------------------
-- The processor's subscription id, scoped to the org.
--
-- SCOPED PER ORG, NEVER GLOBALLY UNIQUE. A global unique index on provider_ref
-- would let whichever org wrote a given id first hold it against every other
-- org, permanently, with no way to tell the tenants apart. Rule 7 puts org_id
-- on every table for exactly this reason and a global key throws it away.
--
-- LIVE ROWS ONLY, which is the part that is easy to get wrong. A plan change
-- opens a new row while the processor keeps the same subscription id, so the id
-- legitimately repeats down the version chain. Keyed across all rows this index
-- would reject the second version — it would make the effective-dating this
-- table exists for impossible. At most one OPEN version per processor
-- subscription is the invariant that actually holds.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_ref_uq
  ON subscriptions (org_id, provider, provider_ref)
  WHERE provider_ref IS NOT NULL AND effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- No client may hold two subscriptions covering the same instant.
--
-- This is what makes the version chain a chain rather than a pile. Without it,
-- a double-submitted upgrade writes two open rows, both look live, and every
-- reader picks one — a client charged twice, or charged the wrong price, with
-- no error anywhere. A check-then-insert in application code cannot close the
-- window between the SELECT and the INSERT; only the database can.
--
-- '[)' — the closing instant of one version is the opening instant of the next,
-- so a plan change at a single timestamp does not conflict with itself.
--
-- THIS SAYS ONE SUBSCRIPTION PER CLIENT AT A TIME. That is the plain reading of
-- a `tier` column and "changing a plan opens a new row". If a client ever needs
-- two concurrent subscriptions the key gains a column (a product, a rail) — it
-- does not get dropped, because dropping it re-opens the double-billing case.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_no_overlap'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_no_overlap
      EXCLUDE USING gist (
        org_id    WITH =,
        client_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The terms of a row are frozen the moment it is written.
--
-- The no-overlap constraint above stops a SECOND live row appearing. It does
-- nothing about the likelier mistake: `UPDATE subscriptions SET price_cents =
-- ... WHERE id = ...` on the live row, written by someone implementing an
-- upgrade the obvious way. That statement is one line, it succeeds, and it
-- rewrites what the client was paying for every past period at once.
--
-- Effective dating that depends on everybody remembering to open a new row is
-- not effective dating. This trigger is what makes it true.
--
-- WHAT STILL MOVES ON A LIVE ROW, and why each one is not a term:
--   status, cancelled_at   — the money state of the same arrangement
--   effective_to           — closing the row IS the mechanism
--   current_period_*       — the window advances every period
--   card_id                — a client replacing an expired card has not
--                            changed what they are paying
--   provider, provider_ref, notes, updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION
      'subscriptions %: org_id and client_id are immutable — a subscription cannot be moved to another client or org',
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_terms_immutable ON subscriptions;
CREATE TRIGGER trg_subscriptions_terms_immutable
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_terms_immutable();

-- 001_init.sql convention.
DROP TRIGGER IF EXISTS trg_subscriptions_updated ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
