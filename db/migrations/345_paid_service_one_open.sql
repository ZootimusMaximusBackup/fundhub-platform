-- 345_paid_service_one_open.sql — one open paid request per client per kind,
-- adjudicated by Postgres instead of by a gap between two statements.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Fee timing: this index is what
-- makes "one press, one charge" true. It charges nothing and reads no card.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT THIS CLOSES. MEASURED, NOT THEORISED.
--
-- 331 shipped two guards: uq_paid_service_requests_idem (a replayed key) and
-- uq_paid_service_requests_round_no (the self-serve counter). The application
-- adds a third, a read of "is anything open for this client".
--
-- All three can be beaten by two presses milliseconds apart, and on
-- 2026-09-05 they were. src/paid-services/round.pg.test.mjs's "two SIMULTANEOUS
-- presses" case wrote TWO rows against a real Postgres, repeatably. The reason:
--
--   press A   reads "nothing open"    reads MAX(round_no)=0 → slot 1   INSERT
--   press B   reads "nothing open"                                     ...
--                                     reads MAX(round_no)=1 → slot 2   INSERT
--
-- B's open-request read happened before A's INSERT, so the read guard saw
-- nothing. B's round_no read happened AFTER it, so B took a different slot —
-- and a different slot means a different derived idempotency key. Two rows.
-- Two hosted checkout links. Two pages a client could pay on for one press of
-- one button.
--
-- Every guard in 331 keys on something the losing press had already changed by
-- the time it read it. The fix is an index that keys on something it CANNOT
-- change: the fact that a request is open at all.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY AN INDEX AND NOT A LOCK, A TRANSACTION, OR A RETRY
--
-- This is the identical problem 090 solved for soft_pull_requests, and it is
-- solved the identical way — uq_soft_pull_requests_one_open, a partial unique
-- index on the open state. Copied rather than reinvented, so there is one
-- pattern in this repository for "a one-tap button a phone network retries"
-- and not two.
--
-- An advisory lock would need the two statements on one pooled connection,
-- which db.query() does not promise. A retry loop would narrow the window and
-- not close it. The index closes it: the loser's INSERT is refused by Postgres,
-- src/paid-services/round.mjs catches the unique violation, re-reads, and hands
-- back the winner's row — the same answer a second press has always got.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SCOPED BY service_kind ON PURPOSE
--
-- 331 is deliberately one table for three services (a dispute round today, a
-- credit pull and a funding application later). A client with a round in
-- progress must still be able to buy a pull. So the constraint is one open
-- request per client PER KIND, not one open request per client.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT COUNTS AS OPEN
--
-- 'quoted', 'awaiting_payment', 'paid', 'staged'. The four states in 331 that
-- are still going somewhere. 'fulfilled', 'failed', 'cancelled' and 'refunded'
-- are finished and hold no slot — so a processor outage, which
-- src/paid-services/round.mjs closes as 'failed', does not lock a client out of
-- ever trying again. That is tested.
--
-- SAFETY. Creates one index. It CANCELS unpaid duplicate rows (see step 1) and
-- DELETES NOTHING — a duplicate becomes 'cancelled' with the reason on the row.
--
-- WHEN THIS MIGRATION REFUSES TO BUILD, EXACTLY.
--
-- After step 1 has run, the index in step 2 fails if and only if one client and
-- service_kind still hold TWO OR MORE rows carrying money — that is, two or
-- more at 'paid' or 'staged'. That is a real double charge and a person has to
-- look at it; a migration must not tidy it away.
--
-- An earlier draft of step 1 was narrower than this comment claimed, and the
-- gap was measured on 2026-09-05: it cancelled a duplicate only when some OTHER
-- row was strictly older, so one older 'quoted' row sitting beside one newer
-- 'paid' row cancelled NOTHING (the 'quoted' row was the oldest, and the 'paid'
-- row was never eligible) and the build failed on a pair that a human did not
-- need to see. Step 1 below is keyed on what the rows ARE rather than on which
-- arrived first: any unpaid row yields to a paid sibling, whatever their order,
-- and unpaid siblings settle among themselves oldest-first as before.

-- ---------------------------------------------------------------------------
-- 1. Stand down any duplicate that already exists.
-- ---------------------------------------------------------------------------
-- Only rows that were NEVER PAID are touched. A row at 'paid' or 'staged' has
-- money against it and is never cancelled by a migration.
--
-- Two rules, in this order:
--   (a) an unpaid row yields to ANY paid sibling, older or newer. Money wins
--       over a quote regardless of who got there first.
--   (b) otherwise the oldest unpaid row is kept and its unpaid siblings yield,
--       which is the shape 090 used.
UPDATE public.paid_service_requests dup
   SET status       = 'cancelled',
       state_reason = 'closed by migration 345: a second open request for this client and service, created by the non-atomic double-press guard in requestRound()',
       resolved_at  = now(),
       updated_at   = now()
 WHERE dup.status IN ('quoted', 'awaiting_payment')
   AND (
     -- (a) a paid sibling exists, in either direction.
     EXISTS (
       SELECT 1 FROM public.paid_service_requests paid
        WHERE paid.client_id    = dup.client_id
          AND paid.service_kind = dup.service_kind
          AND paid.status IN ('paid', 'staged')
     )
     -- (b) an older UNPAID sibling exists.
     OR EXISTS (
       SELECT 1 FROM public.paid_service_requests keep
        WHERE keep.client_id    = dup.client_id
          AND keep.service_kind = dup.service_kind
          AND keep.status IN ('quoted', 'awaiting_payment')
          AND (keep.requested_at, keep.id) < (dup.requested_at, dup.id)
     )
   );

-- ---------------------------------------------------------------------------
-- 2. The guard.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_paid_service_requests_one_open
  ON public.paid_service_requests (client_id, service_kind)
  WHERE status IN ('quoted', 'awaiting_payment', 'paid', 'staged');

COMMENT ON INDEX public.uq_paid_service_requests_one_open IS
  'One open paid request per client per service_kind. This is the guard that makes a double press one row and one hosted checkout link: the read-then-insert guards in src/paid-services/round.mjs can all be beaten by two presses milliseconds apart, and were, against a real Postgres on 2026-09-05. Same shape and same reason as uq_soft_pull_requests_one_open (090). Finished states hold no slot, so a failed request does not lock a client out.';
