-- 370_checkout_expiry_and_escalation_fk.sql
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Payment rail (fee timing) and
-- client-facing messaging on a consumer-finance file. NOTHING IN THIS FILE
-- SENDS ANYTHING and nothing in it moves money.
--
-- Two defects, both found by reviewers on round four, both of the same shape:
-- a sentence written in the repository that the database did not actually make
-- true.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART ONE — A CHECKOUT LINK THAT NEVER EXPIRES
--
-- src/nudge/run.mjs classified `payment_in_flight` (a paid_service_requests row
-- at status='awaiting_payment') as a TEMPORARY reason to stop chasing a client,
-- on this stated ground: "a checkout link is out. It expires; then we chase
-- again."
--
-- NOTHING IN THIS CODEBASE EVER EXPIRED IT. Enumerated on 2026-09-06: the table
-- (331) has no expiry column; src/paid-services/checkout.mjs sets no deadline;
-- no file under src/workflows/ so much as names paid_service_requests. The only
-- production code that moved a row off awaiting_payment was the payment webhook
-- (src/paid-services/round.mjs), the short-payment webhook, and closeFailed —
-- which only fires when MINTING the link fails. And docs/journeys/
-- paid-round-actual.md already recorded that the payment handler is not on the
-- live bus, so in the shipped product a row reaching awaiting_payment stays
-- there for ever.
--
-- The consequence was measured on a scratch Postgres 16.14 in this worktree on
-- 2026-09-06, reproducing the reviewers' scenario exactly — 200 clients each
-- holding an awaiting_payment request minted 400 days ago against a waypoint
-- 400 days overdue, plus one freshly overdue live client:
--
--     candidates 200, the live client NOT among them, messages to the live
--     client 0, budget_exhausted true — today, and the same a year later.
--
-- So: A HOLD MUST HAVE AN END, AND THE END MUST BE A FACT IN THE DATA.
--
-- THE NUMBER IS SEVEN DAYS. It is stated once in JavaScript
-- (CHECKOUT_LINK_TTL_DAYS in src/paid-services/link-ttl.mjs, re-exported by
-- src/paid-services/checkout.mjs) and stamped into the column below every time
-- a link is minted. Seven, and not thirty, because
-- the chase ladder it holds up is only nine days long end to end
-- (src/nudge/ladder.mjs: rungs at 0, 2, 5 and 9 days overdue) — a hold longer
-- than the ladder would silence the whole ladder, and the client would come
-- back at the last rung having heard nothing at all. Seven days is also long
-- enough that nobody mid-checkout is interrupted: an invitation nobody has
-- accepted in a week is not a purchase in progress.
--
-- THREE PLACES ENFORCE IT, AND THE COLUMN IS THE ONE THAT MATTERS:
--
--   1. THIS COLUMN. checkout_expires_at, plus a CHECK that a row sitting at
--      awaiting_payment must carry one. A future writer cannot put a request
--      into that state without saying when the invitation dies.
--   2. THE SWEEP. src/paid-services/expire.mjs moves an expired row to
--      'cancelled' with state_reason='checkout_expired', so the row does not
--      sit at awaiting_payment for ever — which was its own bug, independent of
--      the nudge queue. Scheduled hourly by
--      src/workflows/paid-checkout-expiry-sweeper.mjs.
--   3. THE GATE AND THE QUEUE. src/nudge/exits.mjs stops returning
--      payment_in_flight once the stamp has passed, and src/nudge/run.mjs
--      excludes only a LIVE hold from the candidate list. So the fix holds even
--      on a pass where the sweep has not run yet.
--
-- WHY 'cancelled' AND NOT 'failed'. 'failed' means our processor call failed;
-- nothing failed here. 'cancelled' is already in 331's CHECK list, is already
-- outside OPEN_STATUSES in src/paid-services/round.mjs, and therefore frees the
-- client to ask for the same round again — which is exactly right, because the
-- link they were given no longer works. NO MONEY MOVES. A row at
-- awaiting_payment has never been charged (src/paid-services/checkout.mjs: a
-- minted link is an invitation, not a payment), so cancelling it takes nothing
-- from anybody and creates no refund.
--
-- THE BACKFILL IS DELIBERATELY NOT AN ACCUSATION. Existing awaiting_payment
-- rows have no stamp and there is no honest way to invent one, so they are
-- given requested_at + 7 days — the EARLIEST moment the link could have died,
-- because the link is minted at or after requested_at. That errs toward
-- resuming the chase rather than toward silence, which is the direction this
-- whole defect runs the other way.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART TWO — "THE APPLICATION REALLY CANNOT DELETE ONE" WAS STILL NOT TRUE
--
-- Round three revoked UPDATE and DELETE on client_escalations from fundhub_app
-- (368), and that half is real: a direct DELETE raises permission denied. But
-- 368 also declares
--
--     client_id uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE
--
-- and a cascade runs with the privileges of the REFERENCED table's owner, not
-- the deleting role's. fundhub_app holds DELETE on clients. So the application
-- could still destroy an escalation record — by deleting the client.
--
-- The FK becomes ON DELETE RESTRICT. Deleting a client who has an escalation on
-- file is now refused by the database, loudly, error 23503. Two other options
-- were considered and rejected:
--
--   * leave the cascade and only correct the sentence — honest, but it leaves
--     a hole that the next delete path widens silently.
--   * drop the foreign key so the row orphans — the record survives, but a
--     row pointing at a client that no longer exists cannot be read back by
--     anything, so the evidence survives only in the sense that the bytes do.
--
-- WHAT THIS COSTS. Every DELETE FROM clients in the tree was enumerated on
-- 2026-09-06 rather than asserted, because an earlier draft of this comment
-- said "the only production code that deletes a client is the demo cleanup"
-- and that was NOT TRUE. The full list, and why none of them is broken by this:
--
--   * src/demo/simulate-client.mjs and src/demo/platform-seed.mjs — demo
--     cleanup, both restricted to is_demo.
--   * src/verification/fixtures.mjs (wipeClientTree) — the scratch-only e2e
--     harness tearing down its own fixtures. It never runs the nudge sweep and
--     never writes client_escalations (grepped: src/verification/ contains
--     neither string), so the clients it deletes cannot have one on file.
--   * scripts/demo-journey.mjs, scripts/launch-proof-fixtures.mjs,
--     scripts/comprehensive-sandbox-gauntlet.mjs, scripts/purge-sim-data.mjs,
--     scripts/prove-card-stacking-rounds.mjs — hand-run scratch and simulation
--     scripts, not code any request path reaches.
--
-- Privacy erasure redacts rather than deletes (src/privacy/erasure.test.mjs
-- asserts there is no DELETE FROM clients in it).
--
-- THE STANDING RULE, which is the point of the change: anything that deletes a
-- client who HAS an escalation must delete the escalation first, as the OWNER.
-- A human with the keys can. The application cannot.
--
--
-- SAFETY. Additive plus one foreign-key swap. Adds one column, one CHECK, one
-- index, backfills rows that are already stuck, and replaces one FK action.
-- Drops no data. Re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- PART ONE
-- ---------------------------------------------------------------------------

ALTER TABLE public.paid_service_requests
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz;

COMMENT ON COLUMN public.paid_service_requests.checkout_expires_at IS
  'When the hosted checkout link stops being a live invitation. Stamped at mint time from CHECKOUT_LINK_TTL_DAYS (src/paid-services/link-ttl.mjs, 7 days). NULL = no link has been minted for this row. A row at status=''awaiting_payment'' must have one — see paid_service_requests_awaiting_needs_expiry_ck. Past this moment the request is no longer a reason to stop chasing the client about the underlying checklist item, and src/paid-services/expire.mjs moves the row to ''cancelled''.';

-- The backfill runs BEFORE the CHECK, or the CHECK cannot be added.
-- requested_at + 7 days is the earliest the link could have died. NULL
-- requested_at is impossible (NOT NULL DEFAULT now() in 331), but COALESCE to
-- created_at anyway so this cannot leave a row the CHECK then refuses.
UPDATE public.paid_service_requests
   SET checkout_expires_at = COALESCE(requested_at, created_at) + interval '7 days'
 WHERE status = 'awaiting_payment'
   AND checkout_expires_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'paid_service_requests_awaiting_needs_expiry_ck'
       AND conrelid = 'public.paid_service_requests'::regclass
  ) THEN
    ALTER TABLE public.paid_service_requests
      ADD CONSTRAINT paid_service_requests_awaiting_needs_expiry_ck
      CHECK (status <> 'awaiting_payment' OR checkout_expires_at IS NOT NULL);
  END IF;
END $$;

-- The sweep's own lookup: the rows that are out of time, cheaply.
CREATE INDEX IF NOT EXISTS paid_service_requests_awaiting_expiry_idx
  ON public.paid_service_requests (checkout_expires_at)
  WHERE status = 'awaiting_payment';

-- ---------------------------------------------------------------------------
-- PART TWO
-- ---------------------------------------------------------------------------
-- The constraint name is the one Postgres generates for 368's inline
-- REFERENCES: <table>_<column>_fkey. Looked up rather than assumed, so this is
-- written to find it by its columns instead of by that name.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname INTO fk_name
    FROM pg_constraint c
   WHERE c.conrelid = 'public.client_escalations'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'public.clients'::regclass
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.client_escalations DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE public.client_escalations
    ADD CONSTRAINT client_escalations_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;
END $$;

COMMENT ON TABLE public.client_escalations IS
  'One row per client who has aimed legal or complaint language at us. Written once, on first sighting, and never removed, downgraded or expired — UNIQUE (client_id) plus ON CONFLICT DO NOTHING at the only writer (src/nudge/exits.mjs). fundhub_app holds SELECT and INSERT only (368), and since 370 the client_id foreign key is ON DELETE RESTRICT, so the application cannot reach this row by deleting the client either. Its only effect is to stop every chase ladder that client has, permanently. It stores no client words and is not a finding against the client.';
