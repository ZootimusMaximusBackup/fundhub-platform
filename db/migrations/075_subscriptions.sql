-- 075_subscriptions.sql — a recurring plan a client is on: which product, what
-- it costs each period, when the period runs, and whether it is still running.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- A parallel workflow is landing 077_soft_pull_requests.sql, which carries a
-- `subscription_id uuid` column with NO foreign key and says so in its own
-- header: "the owning table is built by a separate workflow and this migration
-- must apply without it". Its endpoint (api/finance/soft-pull.mjs) takes the
-- value as an opaque uuid and comments "W2 owns subscriptions". Neither file is
-- on main as of this commit, and neither is read, imported or altered here.
--
-- So: every soft pull billed to a plan records a uuid that resolves to nothing.
-- "Which plan was this billed to" is a question the database can hold an answer
-- to and cannot check. This is the table that would answer it.
--
-- THE FOREIGN KEY FROM soft_pull_requests IS NOT ADDED HERE, and must not be.
-- That is another migration's column on another migration's table; referencing
-- it would make this file fail on any database that has not applied 077, which
-- includes every database this branch was tested against. Coupling two parallel
-- builds through the schema breaks whichever applies first. When both have
-- landed, the FK is a third, deliberate migration.
--
-- ---------------------------------------------------------------------------
-- THE PRICE ON THE SUBSCRIPTION IS THE AGREED PRICE, NOT THE PRODUCT'S
-- ---------------------------------------------------------------------------
-- 010_products.sql is explicit: `products.default_price` is a PREFILL ONLY, and
-- the authoritative number is the one frozen onto the sale (011_sales.sql). This
-- table copies that split exactly. `price_cents` is what THIS client agreed to
-- pay each period. Repricing the product changes future sale forms and nothing
-- else — it can never restate what an existing subscriber owes.
--
-- MONEY IS INTEGER CENTS. bigint, matching tradelines (054) and
-- soft_pull_requests (077), for the reason src/commissions/money.mjs exists:
-- a recurring amount gets multiplied by a period count and summed across a book
-- of subscribers, and numeric-dollars rounding shows up in the total. Dollars at
-- the boundary, cents in the column.
--
-- NULL price_cents means UNKNOWN. It does not mean free. A plan recorded before
-- its price is settled has an unknown price; defaulting it to 0 would put "this
-- subscriber owes nothing" into a revenue report that nobody re-checked. The
-- column is nullable with NO default, deliberately.
--
-- ---------------------------------------------------------------------------
-- THE STATE SET IS SMALL ON PURPOSE — AND THERE IS NO 'past_due'
-- ---------------------------------------------------------------------------
-- There is no billing engine, no scheduler and no charge path in this repo, and
-- this migration does not add one. So the only states that exist are the ones
-- something can actually reach:
--
--   draft     — recorded; nothing has started. Every row starts here.
--   active    — the plan is running. NOTHING CHARGES IT. "Active" means the
--               agreement is on foot, not that money moved.
--   paused    — stopped by a human, intended to resume.
--   canceled  — ended by a human. canceled_at is stamped; cancel_reason says why.
--
-- 'past_due' and 'unpaid' are absent because reaching either requires a failed
-- charge, and nothing here can attempt a charge. 077 makes the same call about
-- 'sent' for the same reason: an enum value no code can reach is a promise the
-- schema cannot keep. Adding one alongside a real provider client is a new
-- migration and a deliberate act.
--
-- 'expired' is absent for a different reason: it is DERIVED. A subscription has
-- expired when `ends_at < now()`, which is computed at read time from a column
-- that is already here. 031_invoices.sql dropped 'overdue' on exactly this
-- reasoning, and 054_tradelines.sql refuses derived columns for the same one.
-- A stored 'expired' guarantees a row that is expired in fact and 'active' in
-- the database the moment nothing runs the job that would have flipped it.
--
-- ---------------------------------------------------------------------------
-- PERIOD COLUMNS RECORD; THEY DO NOT ADVANCE
-- ---------------------------------------------------------------------------
-- current_period_start / current_period_end describe the period the plan is IN.
-- Nothing in this build rolls them forward, because rolling them forward is the
-- billing engine's job and the billing engine does not exist. They are NULL
-- until something sets them, and NULL means "no period has been established",
-- not "the period started at the epoch".
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- No provider HTTP client. No charge path. No scheduler. No dunning. No
-- proration. NOTHING TRANSMITS — there is no outbound fetch in src/adapters/ or
-- src/lib/ and this migration does not create a reason to add one.

CREATE TABLE IF NOT EXISTS subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHICH PLAN. There is no `plans` table in this schema and this migration does
  -- not invent one: a plan here IS a product plus a cadence. product_id is NOT
  -- NULL because a subscription to nothing in particular is not a fact anyone
  -- can bill, report on, or explain to a client. Products are never deleted
  -- (010: retiring one sets active=false), so the default RESTRICT is correct —
  -- a delete that would orphan a live subscriber should fail loudly.
  product_id    uuid NOT NULL REFERENCES products(id),

  -- The client-visible label for this plan, when it differs from the product
  -- name ("Credit Monitoring — Monthly"). NULL means UNKNOWN: render the
  -- product's own name. It is NOT a copy of products.name — copying that would
  -- reintroduce exactly the rename corruption 010's alias trigger exists to
  -- prevent.
  plan_label    text,

  --   draft | active | paused | canceled. See the header for why the set stops
  --   there. Rows start at draft; nothing in this build moves them.
  status        text NOT NULL DEFAULT 'draft'
                CONSTRAINT subscriptions_status_check
                CHECK (status IN ('draft', 'active', 'paused', 'canceled')),

  -- MONEY. Integer cents, per billing period, as agreed with THIS client.
  -- NULL = UNKNOWN, never free. No default, deliberately.
  price_cents   bigint
                CONSTRAINT subscriptions_price_cents_check
                CHECK (price_cents IS NULL OR price_cents >= 0),

  -- Matches invoices.currency (017): text, defaulted, not a lookup table. One
  -- currency per subscription; a payment is in its subscription's currency and a
  -- second copy of that fact is a second thing that can disagree.
  currency      text NOT NULL DEFAULT 'USD',

  -- CADENCE. "every 3 months" is (interval='month', count=3). Two columns rather
  -- than one 'quarterly' enum, so a cadence nobody anticipated is arithmetic
  -- instead of a migration.
  billing_interval        text NOT NULL DEFAULT 'month'
                          CONSTRAINT subscriptions_billing_interval_check
                          CHECK (billing_interval IN ('day', 'week', 'month', 'year')),
  billing_interval_count  integer NOT NULL DEFAULT 1
                          CONSTRAINT subscriptions_billing_interval_count_check
                          CHECK (billing_interval_count > 0),

  -- TERM.
  --   started_at — when the plan began. NULL = has not started (a draft).
  --   ends_at    — when the plan is scheduled to stop. NULL here does NOT mean
  --                unknown: it means OPEN-ENDED, running until somebody cancels
  --                it. This is the one nullable column in this table where NULL
  --                is a positive fact, and it is called out because the rest of
  --                this schema reads NULL as "unknown".
  started_at              timestamptz,
  ends_at                 timestamptz,

  -- THE CURRENT PERIOD. Recorded, never advanced by anything in this build.
  -- NULL on both = no period has been established yet.
  current_period_start    timestamptz,
  current_period_end      timestamptz,

  -- Stamped when status becomes 'canceled'; the CHECK below makes the pair
  -- inseparable, so "canceled" can never be a status with no date behind it.
  -- cancel_reason is free text and may be NULL even on a canceled row: an
  -- unrecorded reason is unknown, and forcing a value would only produce
  -- "cancelled" typed into a box to get past a constraint.
  canceled_at             timestamptz,
  cancel_reason           text,

  -- WHICH CARD ON FILE THIS PLAN WOULD BE CHARGED AGAINST.
  -- No foreign key HERE: client_cards is created by 076, which applies after
  -- this file, so a REFERENCES clause in this statement would fail on a fresh
  -- database. 076 adds the constraint once it can see its own table. NULL means
  -- no card is on file for this plan — which, since nothing charges anything, is
  -- the state every row is in today.
  default_card_id         uuid,

  -- Which processor holds the real subscription record, when one ever does.
  -- 'internal' is the honest value while nothing transmits — the same value and
  -- the same reason as soft_pull_requests.provider (077) and the messages rows
  -- sendTemplated writes. No CHECK: naming the allowed processors would decide a
  -- vendor question this repo has not decided anywhere.
  provider                text NOT NULL DEFAULT 'internal',
  -- The provider's id for this subscription. NULL = none, because nothing has
  -- ever been sent to a provider.
  external_ref            text,

  notes                   text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- A period that ends before it starts is a data-entry error that would silently
  -- produce negative-length billing periods in any future engine.
  CONSTRAINT subscriptions_period_order CHECK (
    current_period_start IS NULL OR current_period_end IS NULL
    OR current_period_end > current_period_start
  ),

  -- Same for the term as a whole. >= rather than >, so a same-instant start and
  -- end (a plan cancelled the moment it was created) is representable.
  CONSTRAINT subscriptions_term_order CHECK (
    started_at IS NULL OR ends_at IS NULL OR ends_at >= started_at
  ),

  -- "Canceled" without a date is a row nobody can audit: no one can say when the
  -- client stopped being billable. The two move together or not at all.
  CONSTRAINT subscriptions_canceled_needs_stamp CHECK (
    status <> 'canceled' OR canceled_at IS NOT NULL
  )
);

-- The screen's query: this client's plans, newest first.
CREATE INDEX IF NOT EXISTS idx_subscriptions_client
  ON subscriptions (client_id, created_at DESC);

-- The operations query: everything currently running, per tenant.
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status
  ON subscriptions (org_id, status);

-- ONE ACTIVE PLAN PER CLIENT PER PRODUCT.
-- The failure this prevents is double-billing: two 'active' rows for the same
-- client and the same product, created by a retried signup or a support agent
-- re-entering a plan that was already there, each of which any future engine
-- would charge. Partial on status='active' so the history survives — a client
-- who cancels and later re-subscribes gets a second row, and both stay.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_plan
  ON subscriptions (client_id, product_id)
  WHERE status = 'active';

COMMENT ON TABLE subscriptions IS
  'A recurring plan a client is on: product, agreed price per period in integer cents, cadence, term and status. Nothing in this table charges anything — there is no billing engine. See the file header of db/migrations/075_subscriptions.sql.';
COMMENT ON COLUMN subscriptions.price_cents IS
  'Integer cents, per billing period, as agreed with this client. NULL means UNKNOWN, never free. Not a copy of products.default_price, which is a prefill only (010).';
COMMENT ON COLUMN subscriptions.ends_at IS
  'Scheduled end of the term. NULL means OPEN-ENDED (runs until cancelled), not unknown.';
COMMENT ON COLUMN subscriptions.status IS
  'draft | active | paused | canceled. No past_due (needs a charge path that does not exist) and no expired (derived: ends_at < now()).';
COMMENT ON COLUMN subscriptions.current_period_start IS
  'Start of the period the plan is in. NULL means no period has been established. Nothing in this build advances it.';
COMMENT ON COLUMN subscriptions.current_period_end IS
  'End of the period the plan is in. NULL means no period has been established. Nothing in this build advances it.';
COMMENT ON COLUMN subscriptions.default_card_id IS
  'client_cards.id this plan would be charged against. Foreign key added by 076, which owns that table. NULL means no card on file.';
COMMENT ON COLUMN subscriptions.plan_label IS
  'Client-visible plan name when it differs from the product name. NULL means unknown — render the product name instead.';

-- updated_at, via the trigger 001_init.sql already defines. Guarded on the
-- function existing so this file does not hard-depend on load order, exactly as
-- 051 and 065 do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_subscriptions_updated_at'
                        AND tgrelid = 'subscriptions'::regclass) THEN
    CREATE TRIGGER trg_subscriptions_updated_at
      BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
