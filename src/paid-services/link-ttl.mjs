// How long a hosted checkout link stays a live invitation. One number, one
// file, no dependencies.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Fee timing on a consumer-finance
// file. This module imports nothing, transmits nothing and touches no money; it
// is two constants and one date calculation.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT IS ITS OWN FILE AND NOT A CONSTANT IN checkout.mjs
//
// Two places need the number and one of them must not see the processor.
// src/nudge/exits.mjs is the exit gate for client messaging: CLAUDE.md §12 puts
// outbound transmission inside src/messaging/providers/ and nowhere else, and a
// test asserts that nothing under src/nudge/ imports one. checkout.mjs imports
// ../payments/commas-api.mjs. So the gate imports this instead, and the number
// still exists exactly once.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY SEVEN DAYS
//
// The premise this closes was false for as long as it was written down.
// src/nudge/run.mjs held a client's overdue checklist item out of the chase
// queue because "a checkout link is out. It expires; then we chase again."
// NOTHING IN THIS REPOSITORY EVER EXPIRED ONE — enumerated 2026-09-06: no
// expiry column on paid_service_requests (331), no deadline set at mint, and no
// file under src/workflows/ that even names the table. Measured on a scratch
// Postgres 16.14: 200 clients holding such a request against a waypoint 400
// days overdue, plus one freshly overdue live client — 200 candidates, the live
// one not among them, zero messages to them, that day and a year later.
//
// SEVEN, and not thirty: the ladder this hold suspends runs 0, 2, 5 and 9 days
// overdue (src/nudge/ladder.mjs), so a hold longer than nine days would swallow
// the whole ladder and the client would surface at the final rung having heard
// nothing at all. Seven is also comfortably longer than any real checkout — an
// invitation nobody has accepted in a week is not a purchase in progress.
//
// Enforced in four places, and the first is the one that matters:
//   1. paid_service_requests.checkout_expires_at, plus a CHECK that a row at
//      status='awaiting_payment' carries one (db/migrations/370).
//   2. Stamped at mint time — src/paid-services/round.mjs.
//   3. Swept — src/paid-services/expire.mjs closes the row when it passes,
//      hourly, via src/workflows/paid-checkout-expiry-sweeper.mjs.
//   4. Honoured by the chase gate and the chase queue — src/nudge/exits.mjs and
//      src/nudge/run.mjs — so the fix holds on a pass where 3 has not run yet.

/** Days a minted hosted checkout link stays a live invitation. */
export const CHECKOUT_LINK_TTL_DAYS = 7;

/** The same span in milliseconds, for date arithmetic. */
export const CHECKOUT_LINK_TTL_MS = CHECKOUT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * checkoutExpiresAt(now) → the Date a link minted at `now` stops being live.
 *
 * A plain millisecond addition rather than calendar arithmetic, for the same
 * reason src/nudge/run.mjs uses hour intervals in SQL: seven days here means
 * seven exact days, not "the same clock time a week later", which moves across
 * a daylight-saving boundary.
 *
 * Returns null for an unreadable clock rather than guessing. The caller then
 * has no stamp, and 370's CHECK refuses the row instead of letting an unbounded
 * hold through.
 */
export function checkoutExpiresAt(now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + CHECKOUT_LINK_TTL_MS);
}

export default { CHECKOUT_LINK_TTL_DAYS, CHECKOUT_LINK_TTL_MS, checkoutExpiresAt };
