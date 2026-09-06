-- 331_paid_service_requests.sql — one row per "do it for me", priced as a
-- receipt rather than as a number.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). This file is a fee-timing and
-- payment-rail change: it records what a client is asked to pay for a
-- self-serve dispute round and when. NOTHING IN THIS FILE CHARGES ANYTHING.
-- There is no processor call, no scheduler, no activation flag, and no stored
-- token is readable from here. Same posture as 077 for soft pulls and 276 for
-- subscriptions.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY ONE TABLE AND NOT THREE
--
-- The first paid service is a dispute round. A credit pull and a funding
-- application are next and are the same shape: a client asks, we price it, they
-- pay a hosted checkout link, a human does the work, and the request records
-- what came out. Three tables would mean three idempotency guards, three sets
-- of state coherence checks, and three places to get the money wrong.
--
-- So: `service_kind` names the work, `price_components` carries the receipt,
-- and `produced_kind` + `produced_ref` say what came out. Adding the third
-- service is a widened CHECK, not a new table.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PRICING IS STORED AS COMPONENTS, NOT AS A TOTAL
--
-- Owner-set: $100 flat per round covering all three bureaus, +$10 when a
-- creditor letter is required, +$20 when CFPB and state AG are required.
--
-- Storing 13000 and nothing else makes two things impossible: itemising the
-- receipt a client asks for six months later, and changing the price list
-- without silently restating what somebody already paid. So `price_components`
-- holds the line items —
--
--   [{"code":"round_base","label":"Dispute round, all three bureaus",
--     "quantity":1,"unit_cents":10000,"amount_cents":10000},
--    {"code":"creditor_letter","label":"Creditor letter",
--     "quantity":1,"unit_cents":1000,"amount_cents":1000}]
--
-- — and `price_total_cents` must EQUAL their sum. That is enforced in the
-- database by `fundhub_price_components_total()` below, not by the module that
-- usually writes the row. A receipt whose lines do not add up to its total is
-- the single worst thing this table could store, so it is refused at write
-- time.
--
-- The component CODES are a convention, deliberately not a CHECK: the codes are
-- stable and the amounts are not, and pinning the codes in a constraint would
-- make adding a line item a migration for no safety gained. The shape IS
-- pinned: every element must be an object with a `code` and an integer
-- `amount_cents`, or the total function returns NULL and the CHECK fails.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A PAID ROUND DOES NOT CONSUME A PURCHASED ROUND. TWO COUNTERS, NO LINK.
--
-- Owner-set. `repair_programs.rounds_cap` (250) counts what the client bought
-- with their program — 2 on the $200 trial, 6 on a full program. A round bought
-- here is extra and is counted separately, by `round_no` on this table.
--
-- There is NO column on this table referencing repair_programs, and this file
-- adds no column to repair_programs. That is the enforcement: the two counters
-- cannot be conflated by a join that does not exist. `round_no` is unique per
-- client among dispute-round requests, so the self-serve counter is a real,
-- readable sequence rather than a COUNT(*) that a cancelled row would skew.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY: A DOUBLE PRESS IS ONE ROW
--
-- The proven pattern in this repository, copied rather than reinvented:
-- `events(org_id, idempotency_key)` partial unique (db/schema/001_init.sql:377),
-- and `uq_soft_pull_requests_idem` (077), which is the same index on the same
-- problem — a one-tap button on a phone that the network retries.
--
-- Partial, because NULL is a legitimate "nothing to key on" for a request made
-- from a console, and a plain unique index would let NULLs multiply while
-- pretending to guard.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN (CLAUDE.md §12)
--
--   price_total_cents NULL — not yet priced. NOT free. A CHECK refuses 0, so a
--     zero can never be read as either.
--   amount_paid_cents NULL — no payment has been recorded. NOT "paid nothing".
--   round_no NULL — this request is not a dispute round.
--   produced_ref NULL — nothing has come out of it yet.
--
-- MAILING INVARIANT, RESPECTED. src/metro2/delivery/send.mjs:3 and
-- api/repair/send.mjs:3 both forbid mailing from payment.received. That is why
-- 'staged' exists as a state between 'paid' and 'fulfilled': payment stages the
-- round as ready to mail, and a human staff member still presses send. Nothing
-- in this file routes around that.
--
-- SAFETY. Additive. Creates one function and one table, touches no existing
-- row, drops nothing. Re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- 1. The receipt adds up, or the row does not get written.
-- ---------------------------------------------------------------------------
-- Returns the sum of the line items in cents, or NULL when the array is not a
-- well-formed list of line items. NULL then fails the CHECK below, so a
-- malformed receipt is refused rather than silently summing to something
-- smaller than it should. IMMUTABLE so it may be used in a constraint.
CREATE OR REPLACE FUNCTION public.fundhub_price_components_total(components jsonb)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(COALESCE(components, '[]'::jsonb)) <> 'array' THEN NULL
    WHEN EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(components, '[]'::jsonb)) AS e
       WHERE jsonb_typeof(e) <> 'object'
          OR e->>'code' IS NULL
          OR e->>'code' !~ '[^[:space:]]'
          OR jsonb_typeof(e->'amount_cents') <> 'number'
          -- integer cents only. 10000.5 is not a number of cents.
          OR (e->>'amount_cents') !~ '^-?[0-9]+$'
    ) THEN NULL
    ELSE (
      SELECT COALESCE(SUM((e->>'amount_cents')::bigint), 0)
        FROM jsonb_array_elements(COALESCE(components, '[]'::jsonb)) AS e
    )
  END
$fn$;

COMMENT ON FUNCTION public.fundhub_price_components_total(jsonb) IS
  'Sum of a price_components array in integer cents, or NULL if the array is not a well-formed list of {code, amount_cents} line items. Used by paid_service_requests_total_ck so a receipt can never disagree with its own lines.';

-- ---------------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paid_service_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Which waypoint the client bought their way past, when the request came from
  -- one. ON DELETE SET NULL: rebuilding a client's checklist must never erase
  -- the record that money was asked for.
  waypoint_id   uuid REFERENCES public.client_waypoints(id) ON DELETE SET NULL,

  service_kind  text NOT NULL
                CONSTRAINT paid_service_requests_kind_ck
                CHECK (service_kind IN ('dispute_round', 'credit_pull', 'funding_application')),

  -- WHO ASKED. Same structure as soft_pull_requests (077): a kind, one foreign
  -- key per kind, and a CHECK that they agree. Collapsing the two principals
  -- into one text column would lose the foreign key, which is the only thing
  -- that makes the attribution checkable later.
  requested_by_kind       text NOT NULL
                          CONSTRAINT paid_service_requests_by_kind_ck
                          CHECK (requested_by_kind IN ('client', 'staff')),
  requested_by_account_id uuid REFERENCES accounts(id),
  requested_by_staff_id   uuid REFERENCES staff(id),

  status        text NOT NULL DEFAULT 'quoted'
                CONSTRAINT paid_service_requests_status_ck
                CHECK (status IN (
                  'quoted',            -- priced, nothing owed yet
                  'awaiting_payment',  -- a hosted checkout link is out
                  'paid',              -- money recorded
                  'staged',            -- work prepared, waiting on a human to send
                  'fulfilled',         -- done, and produced_kind says what came out
                  'failed',
                  'cancelled',
                  'refunded'
                )),
  state_reason  text,

  -- ── The receipt ──────────────────────────────────────────────────────────
  price_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_total_cents bigint
                CONSTRAINT paid_service_requests_total_positive_ck
                CHECK (price_total_cents IS NULL OR price_total_cents > 0),
  currency      text NOT NULL DEFAULT 'USD'
                CONSTRAINT paid_service_requests_currency_ck CHECK (currency = 'USD'),

  -- ── The money ────────────────────────────────────────────────────────────
  -- A hosted checkout link is the only rail this repository can actually use:
  -- nothing here can charge a stored token (src/subscriptions/charger.mjs:25).
  checkout_url  text,
  -- The processor's id for the payment. text, not uuid — it is theirs, not ours.
  payment_ref   text,
  amount_paid_cents bigint
                CONSTRAINT paid_service_requests_paid_amount_ck
                CHECK (amount_paid_cents IS NULL OR amount_paid_cents >= 0),
  paid_at       timestamptz,

  -- ── The second counter (see header) ──────────────────────────────────────
  round_no      int
                CONSTRAINT paid_service_requests_round_no_ck
                CHECK (round_no IS NULL OR round_no > 0),

  -- ── What it produced ─────────────────────────────────────────────────────
  -- produced_ref carries NO foreign key on purpose: the table it points at
  -- depends on produced_kind, and a funding application has no table in this
  -- repository yet. Same call 077 made for subscription_id. An FK arrives with
  -- a later migration that can see the owning table.
  produced_kind text
                CONSTRAINT paid_service_requests_produced_kind_ck
                CHECK (produced_kind IS NULL
                       OR produced_kind IN ('dispute_case', 'crs_result', 'funding_application')),
  produced_ref  uuid,
  -- Anything the outcome needs that is not a single row id — letter ids, a
  -- bureau breakdown, a refusal detail.
  produced      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Caller-supplied replay guard. See header.
  idempotency_key text,

  requested_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Exactly one requester, and it must be the kind the row claims.
  CONSTRAINT paid_service_requests_requester_ck CHECK (
    (requested_by_kind = 'client'
       AND requested_by_account_id IS NOT NULL AND requested_by_staff_id IS NULL)
    OR
    (requested_by_kind = 'staff'
       AND requested_by_staff_id IS NOT NULL AND requested_by_account_id IS NULL)
  ),

  -- The receipt adds up. NULL total = not priced yet and no lines to disagree
  -- with; any stored total must equal the sum of its lines.
  --
  -- IS NOT DISTINCT FROM, NOT `=`. A CHECK constraint PASSES when it evaluates
  -- to NULL, and the total function returns NULL for a malformed line item — so
  -- with a plain `=` a receipt containing a line with no code would sail
  -- straight through the very check written to catch it. Measured: the first
  -- version of this file used `=` and src/waypoints/store.pg.test.mjs stored
  -- the malformed row without complaint.
  CONSTRAINT paid_service_requests_total_ck CHECK (
    price_total_cents IS NULL
    OR price_total_cents IS NOT DISTINCT FROM public.fundhub_price_components_total(price_components)
  ),

  -- Lines with no total is a receipt with no bottom line.
  CONSTRAINT paid_service_requests_lines_need_total_ck CHECK (
    price_components = '[]'::jsonb OR price_total_cents IS NOT NULL
  ),

  -- Money recorded and the timestamp for it move together, in both directions.
  CONSTRAINT paid_service_requests_paid_ck CHECK (
    (paid_at IS NULL AND amount_paid_cents IS NULL)
    OR (paid_at IS NOT NULL AND amount_paid_cents IS NOT NULL)
  ),

  -- A request that has reached 'paid' or beyond must say what was paid. Without
  -- this the state and the money can disagree, and the state is what a screen
  -- reads.
  CONSTRAINT paid_service_requests_paid_state_ck CHECK (
    status NOT IN ('paid', 'staged', 'fulfilled', 'refunded')
    OR paid_at IS NOT NULL
  ),

  -- A finished request has an end time; an open one does not.
  CONSTRAINT paid_service_requests_resolved_ck CHECK (
    (status IN ('fulfilled', 'failed', 'cancelled', 'refunded') AND resolved_at IS NOT NULL)
    OR (status NOT IN ('fulfilled', 'failed', 'cancelled', 'refunded') AND resolved_at IS NULL)
  ),

  -- A fulfilled request must say what it produced. "We did the thing" with no
  -- record of what the thing was is the row that makes a refund argument
  -- unanswerable.
  CONSTRAINT paid_service_requests_fulfilled_ck CHECK (
    status <> 'fulfilled' OR produced_kind IS NOT NULL
  ),

  -- A pointer with nothing saying what it points at is unreadable.
  CONSTRAINT paid_service_requests_produced_ref_ck CHECK (
    produced_ref IS NULL OR produced_kind IS NOT NULL
  ),

  -- Only a dispute round takes a place in the self-serve round sequence.
  CONSTRAINT paid_service_requests_round_no_kind_ck CHECK (
    round_no IS NULL OR service_kind = 'dispute_round'
  )
);

-- One client's request history, newest first. The receipt read.
CREATE INDEX IF NOT EXISTS paid_service_requests_client_idx
  ON public.paid_service_requests (client_id, requested_at DESC);

-- "What is still open" across the org, without scanning history.
CREATE INDEX IF NOT EXISTS paid_service_requests_open_idx
  ON public.paid_service_requests (org_id, requested_at DESC)
  WHERE status IN ('quoted', 'awaiting_payment', 'paid', 'staged');

-- Which waypoint a request came from, for the portal's per-waypoint state.
CREATE INDEX IF NOT EXISTS paid_service_requests_waypoint_idx
  ON public.paid_service_requests (waypoint_id)
  WHERE waypoint_id IS NOT NULL;

-- A double press is one row. Partial, matching idx_events_idem and
-- uq_soft_pull_requests_idem: NULL is a legitimate "nothing to key on".
CREATE UNIQUE INDEX IF NOT EXISTS uq_paid_service_requests_idem
  ON public.paid_service_requests (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The self-serve round counter is a real sequence, not a COUNT(*).
CREATE UNIQUE INDEX IF NOT EXISTS uq_paid_service_requests_round_no
  ON public.paid_service_requests (client_id, round_no)
  WHERE round_no IS NOT NULL;

COMMENT ON TABLE public.paid_service_requests IS
  'One row per client "do it for me" request — a self-serve dispute round today, a credit pull or a funding application later. Records the priced line items, the payment, and what the work produced. A round bought here does NOT consume repair_programs.rounds_cap: there is deliberately no column joining the two counters.';
COMMENT ON COLUMN public.paid_service_requests.price_components IS
  'Receipt line items: [{code, label, quantity, unit_cents, amount_cents}]. Owner-set codes: round_base 10000, creditor_letter 1000, escalation_filings 2000. Must sum to price_total_cents (paid_service_requests_total_ck).';
COMMENT ON COLUMN public.paid_service_requests.price_total_cents IS
  'Integer cents. NULL = not priced yet, which is not free; 0 is refused by CHECK. Must equal the sum of price_components.';
COMMENT ON COLUMN public.paid_service_requests.round_no IS
  'The self-serve round sequence for this client, independent of repair_programs.rounds_cap. NULL = this request is not a dispute round.';
COMMENT ON COLUMN public.paid_service_requests.status IS
  'quoted → awaiting_payment → paid → staged → fulfilled, plus failed / cancelled / refunded. staged exists because payment stages a round as ready to mail and a human still presses send (src/metro2/delivery/send.mjs:3).';

-- ---------------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_paid_service_requests_updated ON public.paid_service_requests;
    CREATE TRIGGER trg_paid_service_requests_updated
      BEFORE UPDATE ON public.paid_service_requests
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Row-level security — the same shape repair_programs (250) carries
-- ---------------------------------------------------------------------------
ALTER TABLE public.paid_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_service_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'paid_service_requests'
       AND policyname = 'paid_service_requests_app_all'
  ) THEN
    CREATE POLICY paid_service_requests_app_all ON public.paid_service_requests
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.paid_service_requests TO fundhub_app;
    GRANT EXECUTE ON FUNCTION public.fundhub_price_components_total(jsonb) TO fundhub_app;
  END IF;
END $$;
