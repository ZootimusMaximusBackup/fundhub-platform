// The checkout expiry sweeper — the clock that ends an invitation nobody took.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Payment rail and fee timing.
//
// NOTHING HERE MOVES MONEY AND NOTHING HERE SENDS. It calls one function,
// src/paid-services/expire.mjs, which changes a status column and nothing else.
// No processor, no provider, no template, no client message.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A CLOCK AND NOT AN EVENT
//
// "The client did not pay" is not an event. Nobody does anything, a deadline
// passes, and the row sits there. Absence never fires — the same argument
// message-dispatch-sweeper.mjs makes for a text deferred overnight and
// waypoint-nudge-sweeper.mjs makes for a checklist item going quietly late.
//
// Before this existed, nothing in the repository ever ended an
// awaiting_payment row: the payment webhook could, and docs/journeys/
// paid-round-actual.md records that the payment handler is not on the live bus.
// So the invitation was permanent, and src/nudge/ was suspending a client's
// whole chase ladder behind it.
//
// HOURLY. The deadline itself is seven days out (src/paid-services/
// checkout.mjs), so the only thing a faster clock buys is closing a row at
// 09:05 instead of 09:59, and the only thing a slower one costs is the same
// minutes on the chase that resumes afterwards. Hourly matches the nudge
// sweeper it feeds, which means the two never disagree by more than one pass.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { expireStaleCheckouts } from "../paid-services/expire.mjs";

/** Top of every hour. See the header for why not faster. */
export const SWEEP_CRON = "0 * * * *";

export const SOURCE_WORKFLOW = "paid-checkout-expiry-sweeper";

/** sweep — one pass. `db` and the clock are arguments so the tests drive it
    without Inngest and without a scheduler.

    Never throws: expireStaleCheckouts() catches and returns a shape carrying
    `error`. A pass that fails must not take the scheduled function down,
    because the next pass is the recovery — an expired invitation is still
    expired. */
export async function sweep(conn = db, { now = new Date() } = {}) {
  const result = await expireStaleCheckouts(conn, { now });
  if (result.error) {
    console.warn(`[paid-checkout-expiry-sweeper] pass failed: ${result.error}`);
  } else if (result.more) {
    console.warn(
      `[paid-checkout-expiry-sweeper] batch full: ${result.closed} of ${result.limit} closed, ` +
      `more expired requests remain for the next pass`
    );
  }
  return result;
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so "every registered workflow is callable" stays true
   rather than this one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome
   for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const paidCheckoutExpirySweeper = inngest.createFunction(
  { id: "paid-checkout-expiry-sweeper", name: "Paid checkout expiry sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
