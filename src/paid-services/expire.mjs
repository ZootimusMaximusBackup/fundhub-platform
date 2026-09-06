// Closing a checkout invitation nobody accepted.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Payment rail and fee timing on a
// consumer-finance file.
//
// NO MONEY MOVES HERE, IN EITHER DIRECTION. A paid_service_requests row at
// status='awaiting_payment' has never been charged — src/paid-services/
// checkout.mjs mints a HOSTED link and says so in its own header: "a minted
// link is NOT a payment. It is an invitation." Closing an unaccepted invitation
// takes nothing from anybody, creates no refund, and touches no card. This file
// imports no processor, no provider and no messaging module, and the only
// column it can write is the status, its reason and the resolution time.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS
//
// Nothing in this repository ever ended an awaiting_payment row. Enumerated on
// 2026-09-06: no expiry column existed on the table (331), checkout.mjs set no
// deadline, and no file under src/workflows/ so much as named
// paid_service_requests. The only production code that moved a row off that
// status was the payment webhook, the short-payment webhook, and closeFailed —
// which only fires when MINTING the link fails. And docs/journeys/
// paid-round-actual.md already records that the payment handler is not on the
// live bus, so in the shipped product a row that reaches awaiting_payment stays
// there for good.
//
// That was its own bug, and it was also load-bearing for something else:
// src/nudge/ held a client's overdue checklist item out of the chase queue for
// as long as "a checkout link is out", on the stated ground that it expires.
// Measured on a scratch Postgres 16.14 on 2026-09-06 — 200 clients holding such
// a request against a waypoint 400 days overdue, plus one freshly overdue live
// client: 200 candidates, the live client not among them, zero messages to
// them, today and a year later.
//
// So a hold now has an end (checkout_expires_at, db/migrations/370, seven days
// from src/paid-services/checkout.mjs) and this file is what actually ends it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY 'cancelled'
//
// 'failed' means our call to the processor failed. Nothing failed here; the
// client simply did not accept the invitation. 'cancelled' is already in 331's
// status list, is already outside OPEN_STATUSES in ./round.mjs, and therefore
// frees the client to ask for the same round again — which is right, because
// the link they were given no longer works.
//
// THE UPDATE IS ITS OWN GUARD. `WHERE status = 'awaiting_payment'` is inside
// the statement, not checked beforehand, so a payment that lands in the same
// instant as this sweep cannot be cancelled out from under itself: whichever
// statement gets there second matches no row. That is the same check-then-write
// hazard src/handlers/money-chain.mjs:396 has and this file is not going to
// repeat.

import { db as defaultDb } from "../db.mjs";

/** Why the row was closed. A fixed code, never the processor's words — the
    same call ./round.mjs makes about state_reason, because api/paid-services
    hands that column straight back to a client principal. */
export const EXPIRED_REASON = "checkout_expired";

/** How many rows one pass will close. Bounded for the same reason
    src/nudge/run.mjs bounds its pass: an unbounded sweep holds a function open
    for as long as the backlog is long. Nothing is lost by stopping early here —
    unlike the nudge queue, a row this pass does not reach is still expired on
    the next one and nothing else is competing for the slot. */
export const DEFAULT_LIMIT = 500;

/**
 * expireStaleCheckouts — close every invitation whose deadline has passed.
 *
 * Returns `{ closed, ids, limit, more }`. `more` is true when the batch filled,
 * so a caller can see that the backlog outran one pass rather than guessing
 * from the count.
 *
 * NEVER THROWS. A sweep that fails must not take a scheduled function down: the
 * next pass is the recovery, and an expired row is still expired. On an error
 * the return carries `error` and `closed: 0` — never a silent zero that reads
 * like a clean sweep.
 *
 * A NULL checkout_expires_at is NOT swept. NULL means unknown (CLAUDE.md §12)
 * and unknown is never a reason to close somebody's request. 370's CHECK makes
 * that state unreachable for a row written from now on, and the same migration
 * backfilled the rows that already existed, so this clause guards a case that
 * should not arise rather than one that does.
 */
export async function expireStaleCheckouts(db = defaultDb, { now = new Date(), limit = DEFAULT_LIMIT } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const n = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  try {
    const { rows } = await db.query(
      `UPDATE paid_service_requests
          SET status = 'cancelled',
              state_reason = $2,
              resolved_at = $1::timestamptz
        WHERE id IN (
                SELECT id FROM paid_service_requests
                 WHERE status = 'awaiting_payment'
                   AND checkout_expires_at IS NOT NULL
                   AND checkout_expires_at <= $1::timestamptz
                   /* IF ANY MONEY IS RECORDED AGAINST THIS ROW, LEAVE IT ALONE.
                      A row at awaiting_payment should have neither — the
                      webhook moves it to 'paid' and stamps both together
                      (331's paid_service_requests_paid_ck). But
                      docs/journeys/paid-round-actual.md records that the
                      payment handler is not on the live bus, so a row that has
                      somehow been stamped without being moved is exactly the
                      row this sweep must not close. Cheap, and it fails on the
                      side of leaving a record alone. */
                   AND paid_at IS NULL
                   AND amount_paid_cents IS NULL
                 ORDER BY checkout_expires_at ASC
                 LIMIT $3
              )
        RETURNING id`,
      [at.toISOString(), EXPIRED_REASON, n]
    );
    return { closed: rows.length, ids: rows.map((r) => r.id), limit: n, more: rows.length >= n };
  } catch (err) {
    console.warn(`[paid-services/expire] sweep failed: ${String(err?.message || err)}`);
    return { closed: 0, ids: [], limit: n, more: false, error: String(err?.message || err).slice(0, 300) };
  }
}

export default expireStaleCheckouts;
