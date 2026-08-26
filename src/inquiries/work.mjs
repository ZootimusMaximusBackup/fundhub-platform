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

import { db as sharedDb, pool } from "../db.mjs";
import { logStaffEvent } from "../shifts/telemetry.mjs";
import { resolveShiftId } from "../shifts/attribution.mjs";
import { emit } from "../events/bus.mjs";

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
export async function logAttempt(db, { inquiryId, staffId, orgId, kind = "call", outcome = null, note = null, shiftId }) {
  if (!inquiryId) throw new InquiryWriteError("inquiryId is required");
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!orgId) throw new InquiryWriteError("orgId is required", { status: 403 });
  if (!ATTEMPT_KINDS.has(kind)) throw new InquiryWriteError(`unknown attempt kind: ${kind}`);

  const updated = await withTransaction(db, async (tx) => {
    const inquiry = (await tx.query(
      `SELECT id, org_id FROM inquiry_log WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [inquiryId, orgId]
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
        WHERE id = $1 AND org_id = $4
        RETURNING *`,
      [inquiryId, COUNTING_KINDS.has(kind) ? outcome : null, staffId, orgId]
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
export async function confirmRemoval(db, { inquiryId, staffId, orgId, status = "Removed" }) {
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!orgId) throw new InquiryWriteError("orgId is required", { status: 403 });

  const res = await db.query(
    `UPDATE inquiry_log
        SET status = $3,
            confirmed_at = now(),
            cleared_at = COALESCE(cleared_at, now()),
            is_open = false,
            worked_by = $2, worked_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $4
      RETURNING *`,
    [inquiryId, staffId, status, orgId]
  );
  if (!res.rows[0]) throw new InquiryWriteError("inquiry not found", { status: 404 });
  const row = res.rows[0];
  // Emit inquiry.removed only when a linked case has no open inquiries left.
  // A lone inquiry_log row (no case) does not speak for the whole client file —
  // use POST /api/inquiry-cases mark_cleared for that.
  if (row.case_id) {
    const open = await db.query(
      `SELECT COUNT(*)::int AS n FROM inquiry_log WHERE case_id = $1 AND is_open = true`,
      [row.case_id]
    );
    const remaining = open.rows[0]?.n || 0;
    if (remaining === 0) {
      // case_status is the inquiry_case_status ENUM (db/migrations/140_inquiry_ops.sql):
      // Queued | Scheduled | In Progress | Completed | Escalated | Blocked | Canceled.
      // 'Cleared' and 'Closed' are NOT members. Writing them raised 22P02
      // (invalid input value for enum) which threw before the emit below ever ran,
      // so confirming the last open inquiry on a case 500'd every time. The
      // finished state is 'Completed' — same mapping the sibling path already uses
      // (src/inquiry-removal/cases.mjs). The WHERE list is isActiveCaseStatus()
      // narrowed to the members this enum actually has.
      await db.query(
        `UPDATE inquiry_removal_cases SET
            case_status = 'Completed'::inquiry_case_status,
            cleared_at = COALESCE(cleared_at, now()),
            completed_at = COALESCE(completed_at, now()),
            open_inquiry_count = 0,
            master_call_state = 'completed',
            updated_at = now()
          WHERE id = $1
            AND case_status IN ('Queued','Scheduled','In Progress','Escalated','Blocked')`,
        [row.case_id]
      );
      await emit(db, "inquiry.removed", {
        source: "inquiry-remover-desk",
        inquiryId: row.id,
        caseId: row.case_id,
        staffId
      }, { clientId: row.client_id, orgId: row.org_id,
           idempotencyKey: `inquiry-log:${row.id}:case-cleared` });
    } else {
      await db.query(
        `UPDATE inquiry_removal_cases SET
            open_inquiry_count = $2::int,
            updated_at = now()
          WHERE id = $1`,
        [row.case_id, remaining]
      );
    }
  }
  return row;
}

/**
 * setStatus — free-text status change, attributed.
 *
 * Clears confirmed_at when moving OFF a confirmed state, because a row that
 * carries a confirmation timestamp and a "Pending Removal" status is a row
 * nobody can act on. Reopening is legitimate — bureaus re-report — and the
 * timestamp must follow the reopening rather than outlive it.
 */
export async function setStatus(db, { inquiryId, staffId, orgId, status }) {
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!orgId) throw new InquiryWriteError("orgId is required", { status: 403 });
  if (!status || !String(status).trim()) throw new InquiryWriteError("status is required");

  const confirmed = /removed|confirmed|deleted|cleared/i.test(status);
  const res = await db.query(
    `UPDATE inquiry_log
        SET status = $3,
            confirmed_at = CASE WHEN $4::boolean THEN COALESCE(confirmed_at, now()) ELSE NULL END,
            worked_by = $2, worked_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $5
      RETURNING *`,
    [inquiryId, staffId, String(status).trim(), confirmed, orgId]
  );
  if (!res.rows[0]) throw new InquiryWriteError("inquiry not found", { status: 404 });
  return res.rows[0];
}

/** Staff-typed expected creditor name. Actual bureau string stays on inquiry_name. */
export async function setExpectedName(db, { inquiryId, staffId, orgId, expectedName }) {
  if (!staffId) throw new InquiryWriteError("staffId is required", { status: 401 });
  if (!orgId) throw new InquiryWriteError("orgId is required", { status: 403 });
  const name = String(expectedName || "").trim();
  if (!name) throw new InquiryWriteError("expected name is required");

  const res = await db.query(
    `UPDATE inquiry_log
        SET expected_name = $3,
            worked_by = $2, worked_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $4
      RETURNING *`,
    [inquiryId, staffId, name.slice(0, 200), orgId]
  );
  if (!res.rows[0]) throw new InquiryWriteError("inquiry not found", { status: 404 });
  return res.rows[0];
}

/** listAttempts — the expand row's history, newest first. Org from the session. */
export async function listAttempts(db, { inquiryId, orgId }) {
  if (!orgId) throw new InquiryWriteError("orgId is required", { status: 403 });
  const res = await db.query(
    `SELECT a.id, a.kind, a.outcome, a.note, a.created_at, a.staff_id,
            TRIM(COALESCE(s.name,'')) AS staff_name
       FROM inquiry_attempts a
       JOIN inquiry_log il ON il.id = a.inquiry_id AND il.org_id = $2
       LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.inquiry_id = $1 AND a.org_id = $2
      ORDER BY a.created_at DESC`,
    [inquiryId, orgId]
  );
  return res.rows;
}

/* withTransaction — BEGIN/COMMIT around a callback, using a dedicated
   connection. A real transaction, which took catching to get right.

   The broken probe `if (typeof db.connect !== "function")` was always true for
   the shared handle (db = { query }, no connect), so writes ran unprotected with
   autocommit in production. Fixed by checking db.connect directly, reaching for
   pool() if db is the shared singleton, and only then falling back to inline
   execution for a plain fake in a unit test. See src/finance/soft-pulls.mjs:502. */
async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
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
