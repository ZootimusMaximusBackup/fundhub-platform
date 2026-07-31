-- 075_subscriptions.sql — the recurring plan a client is billed on.
--
-- WHY THIS EXISTS. `transactions` (001_init.sql:152) records that money moved
-- once. Nothing in this schema records that money is SUPPOSED to move again.
-- Every recurring-revenue question — who is active, what renews this month,
-- who lapsed — is currently unanswerable, and the Finance OS screens are being
-- built to ask exactly those.
--
-- THIS IS NOT A BILLING ENGINE AND NOTHING HERE CHARGES ANYONE. There is no
-- scheduler, no outbound fetch, no provider call. Same standing fact as the
-- rest of this repo: `src/adapters/` and `src/lib/` contain no outbound fetch
-- at all. This table RECORDS a subscription that a payment processor is the
-- authority on; it does not create one and cannot collect one. A future
-- reconciler writes rows here from processor webhooks (Commas is the one
-- adapter that exists, src/adapters/commas.mjs), the same way `transactions`
-- is written today.
--
-- MONEY IS INTEGER CENTS. `transactions.amount_paid` is numeric(14,2) dollars
-- and that predates the decision recorded in src/commissions/money.mjs and
-- 054_tradelines.sql: a value that gets multiplied and summed belongs in
-- integer cents, and a subscription amount is multiplied by a term length on
-- every screen that projects revenue. New table, so it starts correct.
--
-- STATUS IS A CLOSED SET, UNLIKE `transactions.status`. The vocabulary here is
-- not the desk's to invent, because the whole point of the column is that
-- 'active' and 'past_due' mean the same thing to every reader. The five states
-- are the ones a processor actually reports.

CREATE TABLE IF NOT EXISTS subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- What they are subscribed to, as the client would recognise it. Free text
  -- and deliberately NOT a FK to `products`: a processor reports a plan name
  -- that may not have a catalog row yet, and refusing the row because the
  -- catalog is behind would lose the subscription, not fix the catalog.
  -- product_id is the optional link for when the two do line up.
  plan_name    text NOT NULL,
  product_id   uuid REFERENCES products(id),

  --   active    — billing normally
  --   past_due  — a charge failed and the processor is retrying
  --   paused    — intentionally suspended, expected to resume
  --   canceled  — ended; will not bill again
  --   trialing  — in a free period, will convert
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'past_due', 'paused', 'canceled', 'trialing')),

  -- Integer cents. NULL means the amount is genuinely unknown — a plan the
  -- processor reported without a price — and must survive as NULL. It is NOT
  -- zero: a subscription that bills $0 and a subscription whose price we could
  -- not read are different facts, and only one of them is safe to show a
  -- client as "free".
  amount_cents bigint CHECK (amount_cents >= 0),
  currency     text NOT NULL DEFAULT 'USD',

  -- How often it bills. NULL for the same reason as amount_cents: unknown.
  interval     text CHECK (interval IN ('weekly', 'monthly', 'quarterly', 'annual')),

  -- The period the client has already paid for. Both nullable — a subscription
  -- imported mid-life may not carry them — and NULL here must never be read as
  -- "today". A screen that renders a missing renewal date as today's date is
  -- telling someone their card is about to be charged when nothing is known.
  current_period_start timestamptz,
  current_period_end   timestamptz,

  -- Set when a cancellation is scheduled but the paid period has not run out.
  -- Distinct from status='canceled', which means it has already ended.
  cancel_at    timestamptz,
  canceled_at  timestamptz,

  started_at   timestamptz,

  -- Who the processor thinks this is. `provider_ref` is the processor's own
  -- subscription id and is the idempotency key for the reconciler below.
  provider     text NOT NULL DEFAULT 'commas',
  provider_ref text,

  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per processor subscription, so replaying a webhook cannot create a
-- second copy of the same subscription and double every revenue projection.
-- Partial, because a hand-entered subscription has no provider_ref and two of
-- those are not provably the same thing — same reasoning as 054's tradelines
-- index and 067's anonymous-response index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_provider_ref
  ON subscriptions (provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_client
  ON subscriptions (client_id, status);

-- Renewal calendars scan forward from now across the whole org.
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
  ON subscriptions (org_id, current_period_end)
  WHERE status IN ('active', 'trialing', 'past_due');

COMMENT ON TABLE subscriptions IS
  'Recurring plans a client is billed on. RECORD ONLY — nothing in this repository charges, schedules or collects anything; a processor is the authority and rows arrive from its webhooks. Money is integer cents. NULL amount_cents / interval / current_period_end mean UNKNOWN and must never be rendered as 0 or as today. See db/migrations/075_subscriptions.sql.';

COMMENT ON COLUMN subscriptions.amount_cents IS
  'Integer cents. NULL = unknown, NOT free. A $0 plan and an unreadable price are different facts.';

COMMENT ON COLUMN subscriptions.current_period_end IS
  'End of the period already paid for. NULL = unknown. Never render NULL as today — that tells a client they are about to be charged when nothing is known.';
