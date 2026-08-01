// The message dispatch sweeper — the thing that would call the dispatcher on a
// schedule, if it were switched on.
//
// ═══════════════════════════════════════════════════════════════════════════
// IT IS NOT SWITCHED ON, AND DEFINING IT DID NOT SWITCH IT ON.
//
// This file exports an Inngest function. That is a definition, not a running
// job. Two separate things stand between it and a real send:
//
//   1. It is deliberately NOT in src/workflows/index.mjs. That array is what
//      netlify/functions/inngest.mjs serves, so a function missing from it is
//      never registered with Inngest and is never invoked by anything. There is
//      a test below asserting it stays absent — if someone adds it, that test
//      fails and says why.
//   2. INNGEST_EVENT_KEY is unset, and CLAUDE.md §11 names turning it on as one
//      of the three things to ask the owner about first.
//
// So the wiring is written and reviewable, and the switch is a separate,
// deliberate act by a human. W5 on the cutover board is that act; it is marked
// blocked on purpose.
//
//
// WHY A SWEEPER AND NOT AN EVENT HANDLER.
//
// Reacting to message.queued would dispatch each message the instant it was
// written, which sounds better and is worse:
//
//   * A message with a future scheduled_at is not due yet, so most of those
//     reactions would have nothing to do.
//   * A text deferred overnight has no new event to wake it. Something has to
//     come back and look.
//   * A retryable provider failure is the same shape — the message goes back on
//     the queue with no event attached to it.
//
// A backlog that drains on a clock handles all three with one mechanism. This is
// the one place in this repo where polling is the right answer rather than the
// lazy one: n-06's header explains why a nightly scan is the wrong port of a GHL
// workflow trigger, and that reasoning is about business rules firing on a
// timer, not about a delivery queue draining.
//
//
// EVERY PASS IS BOUNDED. One pass claims at most DEFAULT_BATCH messages and
// dispatches them one at a time. It does not loop until the queue is empty: an
// unbounded drain holds a function open for as long as the backlog is long, and
// a backlog that cannot be worked through in one pass is worked through in the
// next one. Nothing is lost by stopping early — an unclaimed message is still
// queued and still due.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { dispatchDue, DEFAULT_BATCH } from "../messaging/dispatch.mjs";

/** How often a pass would run once this is registered. Every five minutes: the
    quiet-hours window opens on the hour, and a text held overnight should go out
    within a few minutes of 11:00 rather than up to an hour after it. */
export const SWEEP_CRON = "*/5 * * * *";

export const SOURCE_WORKFLOW = "message-dispatch-sweeper";

/* sweep — one pass. Pure enough to test directly: `db` and the batch size are
   arguments, so the tests drive it without Inngest and without a scheduler.

   Never throws. A pass that fails must not take the scheduled function down with
   it, because the next pass is the recovery: every message it did not finish is
   still queued and still due. The error is returned so a caller can log it. */
export async function sweep(db, options = {}) {
  const { limit = DEFAULT_BATCH, ...rest } = options;
  try {
    const result = await dispatchDue(db, { ...rest, limit });
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      claimed: 0,
      results: [],
      counts: {},
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* The scheduled definition. NOT exported from src/workflows/index.mjs, so
   nothing registers it and nothing runs it. See the header. */
export const messageDispatchSweeper = inngest.createFunction(
  { id: "message-dispatch-sweeper", name: "Message dispatch sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
