// Soft pull requests — recording that a credit file was asked for, and what
// came back.
//
// `crs_results` has always held the answer. This module holds the question:
// why the file was pulled, who asked, when, and whether anything ever came
// back. A pull that was requested and never returned used to leave no trace at
// all — the same absence as a pull nobody ever ran.
//
// *** COMPLIANCE: `reason` IS FREE TEXT AND IS FLAGGED. Permissible purpose
// *** under the FCRA is a coded category. This records the sentence, not the
// *** category, and proves nothing about which one applies. A coded list is not
// *** invented here because there is no source in this repository for what the
// *** categories are. See db/migrations/077_soft_pull_requests.sql.
//
// A REASON IS REQUIRED. That much is enforced everywhere — the column, and
// recordPull() before it. There is no path here that records a pull with no
// stated reason.
//
// REPLAY IS THE DEFAULT, NOT THE EXCEPTION. `diagnostic.paid` is an event on a
// bus that replays. recordPull() is keyed on the source event, so a replayed
// event returns the row it already wrote instead of recording a second pull of
// the same consumer's file. How many times a file was pulled has a legal answer.

const STATUSES = Object.freeze(["requested", "completed", "failed", "cancelled"]);
const SETTLED = Object.freeze(["completed", "failed", "cancelled"]);
const SOURCES = Object.freeze(["workflow", "staff", "client"]);
const SCOPES = Object.freeze(["consumer_only", "consumer_plus_ex_business"]);

export const PULL_STATUSES = STATUSES;
export const PULL_SOURCES = SOURCES;
export const PULL_SCOPES = SCOPES;

const COLUMNS = `
  id, org_id, client_id, status, reason, scope, source, requested_by_staff_id,
  source_event_id, crs_result_id, failure_reason, requested_at, settled_at,
  created_at, updated_at`;

/** isSettled — has this pull stopped being outstanding? Pure. */
export const isSettled = (status) => SETTLED.includes(status);

/**
 * normalizeReason — the reason exactly as given, minus surrounding whitespace.
 *
 * It is NOT normalised further: not lowercased, not mapped onto a category, not
 * truncated. Whoever eventually codes these needs the words that were actually
 * recorded, and a reason that has been tidied is a reason somebody has to
 * un-tidy before they can read it. Empty is refused rather than stored as ''.
 */
export function normalizeReason(reason) {
  const s = reason == null ? "" : String(reason).trim();
  if (!s) {
    throw new TypeError(
      "soft pull: a reason is required — a credit file may not be pulled with no stated purpose"
    );
  }
  return s;
}

/** Refuse a value that is not in the vocabulary, rather than storing it and
 *  letting the CHECK constraint report a constraint name to a caller who cannot
 *  act on one. */
function oneOf(value, allowed, field) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!allowed.includes(s)) {
    throw new TypeError(`soft pull: unknown ${field}: ${JSON.stringify(value)} (known: ${allowed.join(", ")})`);
  }
  return s;
}

/**
 * recordPull — write one request row. Idempotent on (org_id, source_event_id).
 *
 * A replayed event returns the row already written, unchanged. It does not
 * update it: a replay carries the same facts, and re-stamping requested_at
 * would move the clock on "how long has this client been waiting".
 *
 * A request with no source event is not deduped — there is no key to dedupe on,
 * and refusing one would block a staff-initiated pull, which is the case that
 * has an actor and most deserves a row.
 */
export async function recordPull(db, input = {}) {
  const orgId = input.orgId ?? input.org_id;
  const clientId = input.clientId ?? input.client_id;
  if (!orgId) throw new TypeError("recordPull: orgId is required");
  if (!clientId) throw new TypeError("recordPull: clientId is required");

  const reason = normalizeReason(input.reason);
  const source = oneOf(input.source ?? "workflow", SOURCES, "source");
  const scope = oneOf(input.scope ?? null, SCOPES, "scope");
  const staffId = input.requestedByStaffId ?? input.requested_by_staff_id ?? null;
  const sourceEventId = input.sourceEventId ?? input.source_event_id ?? null;

  // Caught here rather than at the CHECK so the message names the problem.
  if (source === "staff" && !staffId) {
    throw new TypeError("recordPull: a staff-initiated pull must name the staff member who asked");
  }

  const res = await db.query(
    `INSERT INTO soft_pull_requests
       (org_id, client_id, status, reason, scope, source, requested_by_staff_id,
        source_event_id, requested_at)
     VALUES ($1, $2, 'requested', $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
     ON CONFLICT (org_id, source_event_id) WHERE source_event_id IS NOT NULL
     DO NOTHING
     RETURNING ${COLUMNS}`,
    [orgId, clientId, reason, scope, source, staffId, sourceEventId, input.requestedAt ?? null]
  );

  if (res.rows[0]) return res.rows[0];

  // DO NOTHING returns no row on conflict, so this is the replay path: read back
  // the row the first delivery wrote. If there is no source event id there was
  // no conflict target, and a missing row means the INSERT genuinely failed.
  if (!sourceEventId) throw new Error("recordPull: the request was not written");
  const existing = await db.query(
    `SELECT ${COLUMNS} FROM soft_pull_requests WHERE org_id = $1 AND source_event_id = $2`,
    [orgId, sourceEventId]
  );
  return existing.rows[0] ?? null;
}

/**
 * getLatestPull — the most recent request for one client, or null.
 *
 * Ordered by requested_at, not created_at: a pull backfilled today for a request
 * made last week describes last week. `null` means this client has never had one
 * requested — it does not mean "no result yet", which is a `requested` row.
 */
export async function getLatestPull(db, { orgId, clientId } = {}) {
  if (!orgId) throw new TypeError("getLatestPull: orgId is required");
  if (!clientId) throw new TypeError("getLatestPull: clientId is required");
  const res = await db.query(
    `SELECT ${COLUMNS} FROM soft_pull_requests
      WHERE org_id = $1 AND client_id = $2
      ORDER BY requested_at DESC, created_at DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  return res.rows[0] ?? null;
}

/** listPulls — the whole history for one client, newest first. The audit read. */
export async function listPulls(db, { orgId, clientId } = {}) {
  if (!orgId) throw new TypeError("listPulls: orgId is required");
  if (!clientId) throw new TypeError("listPulls: clientId is required");
  const res = await db.query(
    `SELECT ${COLUMNS} FROM soft_pull_requests
      WHERE org_id = $1 AND client_id = $2
      ORDER BY requested_at DESC, created_at DESC`,
    [orgId, clientId]
  );
  return res.rows;
}

/**
 * settlePull — move an outstanding request to its outcome.
 *
 * Only a `requested` row is settled. A second call on an already-settled row
 * writes nothing and returns null rather than re-stamping settled_at, because
 * the first settlement is the one that happened.
 *
 * `completed` requires the result it completed with. A completed pull with no
 * crs_result_id would claim an answer exists and give no way to find it.
 */
export async function settlePull(db, { orgId, id, status, crsResultId = null, failureReason = null, at = null } = {}) {
  if (!orgId) throw new TypeError("settlePull: orgId is required");
  if (!id) throw new TypeError("settlePull: id is required");
  if (!isSettled(status)) {
    throw new TypeError(`settlePull: status must be one of ${SETTLED.join(", ")} — got ${JSON.stringify(status)}`);
  }
  if (status === "completed" && !crsResultId) {
    throw new TypeError("settlePull: a completed pull must name the crs_results row it completed with");
  }
  if (status !== "completed" && crsResultId) {
    throw new TypeError("settlePull: only a completed pull may name a result");
  }

  const res = await db.query(
    `UPDATE soft_pull_requests
        SET status = $3,
            crs_result_id = $4,
            failure_reason = $5,
            settled_at = COALESCE($6::timestamptz, now())
      WHERE org_id = $1 AND id = $2 AND status = 'requested'
      RETURNING ${COLUMNS}`,
    [orgId, id, status, crsResultId, failureReason, at]
  );
  return res.rows[0] ?? null;
}
