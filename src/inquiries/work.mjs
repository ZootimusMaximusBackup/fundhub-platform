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
// TELEMETRY (W1 wiring): call_made and letter_issued are logged to staff_events
// after the inquiry_attempts row commits. Portal and note do not generate
// telemetry (portal has no canonical kind, note is not an action). See
// src/shifts/TELEMETRY-CALLSITES.md.

import { logStaffEvent } from "../shifts/telemetry.mjs";

const ATTEMPT_KINDS = new Set(["call", "letter", "portal", "note"]);
const COUNTING_KINDS = new Set(["call", "letter", "portal"]);

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
 * After commit, fires telemetry for call and letter kinds (fire-and-forget via
 * logStaffEvent, which never throws).
 */
export async function logAttempt(db, { inquiryId, staffId, kind = "call", outcome = null, note = null }) {
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

  // Telemetry fires after commit (fire-and-forget). call_made and letter_issued
  // are staff-attributed. portal and note do not generate telemetry.
  // See src/shifts/TELEMETRY-CALLSITES.md.
  if (kind === "call" || kind === "letter") {
    await logStaffEvent(db, {
      orgId: updated.org_id,
      staffId,
      shiftId: null,
      kind: kind === "call" ? "call_made" : "letter_issued",
      detail: {
        inquiry_id: updated.id,
        client_id: updated.client_id,
        outcome: outcome ?? null,
        attempt_no: updated.call_attempts
      }
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
