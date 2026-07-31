// Inquiry work — the write path behind the Inquiry Remover dashboard.
//
// The screen already reads the real queue. These are the three things it can do
// to a row and, until now, could not save: log an attempt, mark a removal
// confirmed, and change a status.
//
// THE COUNTER IS DERIVED FROM THE LOG, NOT INCREMENTED ALONGSIDE IT.
// `inquiry_log.call_attempts` and `inquiry_attempts` would drift the first time
// a request was retried — the classic double-count, and here it lands on a
// consumer's dispute record. So the counter is recomputed from the attempt rows
// inside the same transaction that inserts one. Two sources, one write, no
// possible disagreement.
//
// A 'note' IS NOT AN ATTEMPT. Working notes are logged in the same table, for a
// single readable timeline, but do not count toward call_attempts: a desk that
// inflates its attempt count is lying to a bureau, slowly.
//
// THIS IS ALSO THE ONLY STAFF-ATTRIBUTED TELEMETRY WRITER IN THE REPOSITORY.
// `staff_events` (src/shifts/telemetry.mjs) records "this person did this thing,
// at this time, on this shift". Of the five kinds it accepts, exactly two have a
// call site where a named employee completes the action, and both are here:
// a `call` attempt is `call_made`, a `letter` attempt is `letter_issued`. See
// src/shifts/TELEMETRY-CALLSITES.md for the other three (`pull_run`,
// `text_sent`, `file_touched`) and why nothing emits them — they are performed
// by Inngest workflows, which have no staff member to attribute anything to.
//
// THE EMIT IS AFTER THE COMMIT, NEVER INSIDE IT. Two reasons, both one-way:
// telemetry must not be able to roll back the attempt it is describing, and a
// row that says "called" must not exist for a call whose transaction was rolled
// back. logStaffEvent() never throws and never rejects, so the emit cannot fail
// the write it observes — that is its whole design constraint, and
// work.test.mjs injects a database error at the staff_events INSERT to prove
// this function still returns the updated inquiry when telemetry is broken.

import { logStaffEvent } from "../shifts/telemetry.mjs";
import { currentShift } from "../shifts/store.mjs";

const ATTEMPT_KINDS = new Set(["call", "letter", "portal", "note"]);
const COUNTING_KINDS = new Set(["call", "letter", "portal"]);

/* Which attempt kinds have a `staff_events` kind, and which one.
   `portal` and `note` are deliberately absent and MUST STAY absent.

   `portal` — filing through a bureau portal — is a real, counted, staff-performed
   action with no equivalent in EVENT_KINDS. Filing it under `letter_issued`
   because that is the nearest word would make "letters issued" a number nobody
   can trust. It is reported as a gap in docs/workflows/finish-the-build.md
   instead, and whoever owns the telemetry vocabulary decides.

   `note` is not an attempt at all (see the header) and must not become one here
   after this file went to the trouble of keeping it out of call_attempts. */
const TELEMETRY_KIND = Object.freeze({
  call: "call_made",
  letter: "letter_issued"
});

/* Which shift this work belongs on.
 *
 * An explicitly passed shiftId WINS, including an explicit null. The HTTP layer
 * has already resolved the caller's open shift — requireActiveShift() returns
 * the `shifts` row and api/inquiries.mjs passes its id straight down — so the
 * request path costs no extra query. A caller that says `shiftId: null` is
 * stating a fact ("this work is off the clock"), not omitting one, and is taken
 * at its word.
 *
 * Only an ABSENT shiftId triggers the lookup, so a direct caller with no HTTP
 * layer above it still gets the link rather than a null that cannot be repaired
 * later. `null` is a legitimate answer here — somebody working off the clock —
 * and is stored as such rather than refused.
 *
 * A failed lookup is null and a log line, never a throw: this runs after the
 * commit, so the attempt is already recorded, and losing the shift link is not
 * a reason to fail an action that has already happened. */
async function resolveShiftId(db, { staffId, shiftId }) {
  if (shiftId !== undefined) return shiftId ?? null;
  try {
    return (await currentShift(db, { staffId }))?.id ?? null;
  } catch (err) {
    console.error(`[telemetry] open-shift lookup failed, shift_id will be NULL (staff=${staffId}): ${err.message}`);
    return null;
  }
}

export class InquiryWriteError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "InquiryWriteError";
    this.status = status;
  }
}

/**
 * logAttempt — append one attempt and refresh the row's derived state.
 *
 * Transactional because three writes must agree: the attempt row, the
 * recomputed counter, and the attribution columns. A partial apply here would
 * leave a row that claims three attempts with two logged.
 *
 * `shiftId` is optional and only affects telemetry: pass the caller's open
 * shift when it is already known (the HTTP path does), omit it to have the open
 * shift looked up, pass null to state that this work is off the clock. It has
 * no effect on the inquiry write itself.
 */
export async function logAttempt(db, { inquiryId, staffId, kind = "call", outcome = null, note = null, shiftId }) {
  if (!inquiryId) throw new InquiryWriteError("inquiryId is required");
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!ATTEMPT_KINDS.has(kind)) throw new InquiryWriteError(`unknown attempt kind: ${kind}`);

  const updated = await withTransaction(db, async (tx) => {
    const inquiry = (await tx.query(
      `SELECT id, org_id FROM inquiry_log WHERE id = $1 FOR UPDATE`, [inquiryId]
    )).rows[0];
    if (!inquiry) throw new InquiryWriteError("inquiry not found", { status: 404 });

    await tx.query(
      `INSERT INTO inquiry_attempts (org_id, inquiry_id, staff_id, kind, outcome, note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [inquiry.org_id, inquiryId, staffId, kind, outcome, note]
    );

    // Recompute, never increment. See the header.
    const updated = (await tx.query(
      `UPDATE inquiry_log
          SET call_attempts = (
                SELECT count(*) FROM inquiry_attempts
                 WHERE inquiry_id = $1 AND kind IN ('call','letter','portal')
              ),
              -- COALESCE so a note-only touch does not blank an outcome that a
              -- real attempt recorded.
              outcome    = COALESCE($2, outcome),
              worked_by  = $3,
              worked_at  = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [inquiryId, COUNTING_KINDS.has(kind) ? outcome : null, staffId]
    )).rows[0];

    return updated;
  });

  /* AFTER THE COMMIT. See the header. Nothing below this line may throw, and
     nothing below this line may change what is returned. */
  const eventKind = TELEMETRY_KIND[kind];
  if (eventKind) {
    await logStaffEvent(db, {
      /* The org filter comes off the inquiry_log row this function just wrote,
         never off a request body — an org id a caller can choose is an org id a
         caller can lie about. logStaffEvent stores the org from the `staff` row
         itself and uses this only to insist the two agree. */
      orgId:   updated.org_id,
      staffId,
      shiftId: await resolveShiftId(db, { staffId, shiftId }),
      kind:    eventKind,
      detail:  {
        inquiry_id: updated.id,
        client_id:  updated.client_id,
        attempt_kind: kind,
        // NULL survives. The desk may not know the outcome at the moment it
        // logs the attempt, and "unknown" must not be recorded as a result.
        outcome:    outcome ?? null,
        attempt_no: updated.call_attempts ?? null
      }
      /* `note` is deliberately NOT copied in. It is operator free text about a
         consumer's dispute and can carry anything the desk typed; `detail` is a
         telemetry index, not a second copy of the record. The note already
         lives, once, in inquiry_attempts. */
    });
  }

  return updated;
}

/**
 * confirmRemoval — the "mark confirmed" button.
 *
 * Sets confirmed_at (unambiguous) and writes the caller's status text through to
 * the free-text column. It does NOT invent a canonical status string: the screen
 * sends what the desk actually uses, and the default here matches the wording
 * already present in the live data rather than a new vocabulary.
 */
export async function confirmRemoval(db, { inquiryId, staffId, status = "Removed" }) {
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });

  const res = await db.query(
    `UPDATE inquiry_log
        SET status = $3, confirmed_at = now(), worked_by = $2, worked_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [inquiryId, staffId, status]
  );
  if (!res.rows[0]) throw new InquiryWriteError("inquiry not found", { status: 404 });
  return res.rows[0];
}

/**
 * setStatus — free-text status change, attributed.
 *
 * Clears confirmed_at when moving OFF a confirmed state, because a row that
 * carries a confirmation timestamp and a "Pending Removal" status is a row
 * nobody can act on. Reopening is legitimate — bureaus re-report — and the
 * timestamp must follow the reopening rather than outlive it.
 */
export async function setStatus(db, { inquiryId, staffId, status }) {
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!status || !String(status).trim()) throw new InquiryWriteError("status is required");

  const confirmed = /removed|confirmed|deleted/i.test(status);
  const res = await db.query(
    `UPDATE inquiry_log
        SET status = $3,
            confirmed_at = CASE WHEN $4::boolean THEN COALESCE(confirmed_at, now()) ELSE NULL END,
            worked_by = $2, worked_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [inquiryId, staffId, String(status).trim(), confirmed]
  );
  if (!res.rows[0]) throw new InquiryWriteError("inquiry not found", { status: 404 });
  return res.rows[0];
}

/** listAttempts — the expand row's history, newest first. */
export async function listAttempts(db, { inquiryId }) {
  const res = await db.query(
    `SELECT a.id, a.kind, a.outcome, a.note, a.created_at, a.staff_id,
            TRIM(COALESCE(s.name,'')) AS staff_name
       FROM inquiry_attempts a
       LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.inquiry_id = $1
      ORDER BY a.created_at DESC`,
    [inquiryId]
  );
  return res.rows;
}

/* withTransaction — BEGIN/COMMIT around a callback, using a dedicated
   connection. Falls back to running the callback directly when the handle has no
   connect() (the in-memory fake used by the unit tests), so the transactional
   path is not something only a real database can exercise. */
async function withTransaction(db, fn) {
  if (typeof db.connect !== "function") return fn(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
