// Which shift a piece of work belongs on — one answer, for every telemetry call site.
//
// It lives here rather than in telemetry.mjs on purpose. logStaffEvent() refuses
// to resolve the open shift itself, because doing so inside the writer would
// attach work to a shift the caller never named and would add a round trip to
// every business action whether or not it wanted one. That reasoning holds for
// the writer and not for the callers, who DO want the link — so the resolution
// lives one layer up, in one place, shared by all of them.

import { currentShift } from "./store.mjs";

/**
 * resolveShiftId(db, { staffId, shiftId }) — the shift id to stamp, or null.
 * Never throws.
 *
 * An explicitly passed shiftId WINS, including an explicit null. A caller that
 * already resolved the shift (the HTTP layer does, to decide whether the write
 * is allowed at all) pays no second query, and a caller that says `null` is
 * stating a fact — this work is off the clock — rather than omitting one.
 *
 * Only an ABSENT shiftId triggers the lookup, so a direct caller with no HTTP
 * layer above it still gets the link instead of a null nobody can repair later.
 *
 * null is a legitimate answer, not a failure: somebody worked without clocking
 * in. The event is still written; `staff_events.shift_id` is nullable for
 * exactly this.
 *
 * A failed lookup is null and a log line. Every caller runs this AFTER the work
 * it describes has already been recorded, so losing the shift link is never a
 * reason to fail an action that already happened.
 */
export async function resolveShiftId(db, { staffId, shiftId } = {}) {
  if (shiftId !== undefined) return shiftId ?? null;
  if (!staffId) return null;
  try {
    return (await currentShift(db, { staffId }))?.id ?? null;
  } catch (err) {
    console.error(`[telemetry] open-shift lookup failed, shift_id will be NULL (staff=${staffId}): ${err.message}`);
    return null;
  }
}
