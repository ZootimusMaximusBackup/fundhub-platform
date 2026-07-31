// Soft pull requests — the read/write pair over 077_soft_pull_requests.
//
// The table is an audit record: "this client's credit was pulled, on this date,
// on this basis, and here is what came back". Two functions are all the screens
// need — one to record a request and move it to its outcome, one to read the
// newest.
//
// NOTHING HERE PULLS ANYTHING. There is no adapter call and no outbound fetch;
// src/adapters/crs.mjs and the C-00 workflow remain the authority on what a pull
// actually is. This module writes down what they did.
//
// THE RULES THIS MODULE ENFORCES, ALL OF THEM REFUSALS:
//   * An unknown status is refused, not coerced to 'requested'.
//   * A completed pull must carry the result it completed with.
//   * A reason nobody gave stays NULL. It is never filled with a default
//     sentence, because `reason` is what a compliance review will read and a
//     manufactured one would be worse than a blank.
//   * An actor nobody named stays NULL. A pull requested by a workflow has no
//     staff member, and inventing one is the failure the repo's headline rule
//     exists to prevent.

const STATUSES = new Set(["requested", "completed", "failed", "canceled"]);
const PULL_TYPES = new Set(["soft", "hard"]);
const SCOPES = new Set(["consumer_only", "consumer_plus_ex_business"]);

export class SoftPullError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "SoftPullError";
    this.status = status;
  }
}

/* Trim to null. An empty string in `reason` would read as "a reason was given
   and it was blank", which is a different claim from "nobody gave one". */
function text(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * recordPull — write one soft-pull request row.
 *
 * Returns the stored row. Every argument except orgId/clientId is optional,
 * because the C-00 path genuinely knows very little at request time: it has an
 * org, a client and a scope, and no actor, no consent document and no provider
 * id. Refusing the row for that would mean the only pull path in the system
 * writes no audit record at all.
 */
export async function recordPull(db, {
  orgId, clientId,
  pullType = "soft",
  scope = "consumer_only",
  status = "requested",
  reason = null,
  consentDocumentId = null,
  requestedBy = null,
  resultId = null,
  provider = "crs",
  providerRef = null,
  failureReason = null,
  raw = {}
} = {}) {
  if (!orgId) throw new SoftPullError("orgId is required");
  if (!clientId) throw new SoftPullError("clientId is required");

  // Refused, not coerced. A pull stored under a status this module invented
  // would be counted by every screen that filters on status.
  if (!PULL_TYPES.has(pullType)) throw new SoftPullError(`unknown pull type: ${pullType}`);
  if (!SCOPES.has(scope)) throw new SoftPullError(`unknown pull scope: ${scope}`);
  if (!STATUSES.has(status)) throw new SoftPullError(`unknown pull status: ${status}`);

  // The database enforces this too (077's completed_has_result CHECK). It is
  // checked here as well so the caller gets a named error instead of a
  // constraint violation, and so the rule survives a stubbed db in a test.
  if (status === "completed" && !resultId) {
    throw new SoftPullError("a completed pull must name the result it completed with");
  }
  if (status !== "completed" && resultId) {
    throw new SoftPullError(`a pull with status ${status} cannot carry a result`);
  }

  const res = await db.query(
    `INSERT INTO soft_pull_requests
       (org_id, client_id, pull_type, scope, status, reason, consent_document_id,
        requested_by, result_id, provider, provider_ref, failure_reason,
        completed_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $5 = 'completed' THEN now() ELSE NULL END, $13)
     RETURNING *`,
    [
      orgId, clientId, pullType, scope, status,
      text(reason), consentDocumentId || null, requestedBy || null,
      resultId || null, provider, text(providerRef), text(failureReason),
      JSON.stringify(raw ?? {})
    ]
  );
  return res.rows[0] ?? null;
}

/**
 * completePull — move a request to its outcome.
 *
 * Separate from recordPull because the result arrives much later, on a
 * different event, and the row it belongs to already exists. Returns null when
 * no such request exists rather than throwing: a result for a pull nobody
 * recorded is a real situation on a database that predates this table, and it
 * is the caller's decision what to do about it.
 */
export async function completePull(db, { id, resultId = null, status = "completed", failureReason = null } = {}) {
  if (!id) throw new SoftPullError("id is required");
  if (!STATUSES.has(status)) throw new SoftPullError(`unknown pull status: ${status}`);
  if (status === "completed" && !resultId) {
    throw new SoftPullError("a completed pull must name the result it completed with");
  }

  const res = await db.query(
    `UPDATE soft_pull_requests
        SET status         = $2,
            result_id      = COALESCE($3, result_id),
            -- COALESCE, not overwrite: a later update that omits the failure
            -- text must not erase why the pull failed.
            failure_reason = COALESCE($4, failure_reason),
            completed_at   = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
            updated_at     = now()
      WHERE id = $1
      RETURNING *`,
    [id, status, resultId || null, text(failureReason)]
  );
  return res.rows[0] ?? null;
}

/**
 * getLatestPull — the newest request for a client, or null.
 *
 * null is a normal answer: most clients have never been pulled. It is NOT an
 * error and must not be rendered as "no pull needed" or as a zero — the screen
 * says "no pull on record", which is what it means.
 *
 * The joined result payload is deliberately NOT returned. A bureau file is the
 * most sensitive object in this database and a "latest pull" summary does not
 * need it; result_id is enough for a caller that genuinely does.
 */
export async function getLatestPull(db, { clientId, pullType = null } = {}) {
  if (!clientId) throw new SoftPullError("clientId is required");
  if (pullType != null && !PULL_TYPES.has(pullType)) {
    throw new SoftPullError(`unknown pull type: ${pullType}`);
  }

  const res = await db.query(
    `SELECT id, org_id, client_id, pull_type, scope, status, reason,
            consent_document_id, requested_by, requested_at, completed_at,
            result_id, provider, provider_ref, failure_reason
       FROM soft_pull_requests
      WHERE client_id = $1
        AND ($2::text IS NULL OR pull_type = $2)
      ORDER BY requested_at DESC, id DESC
      LIMIT 1`,
    [clientId, pullType]
  );
  return res.rows[0] ?? null;
}

/**
 * listPulls — the client's pull history, newest first.
 *
 * The audit answer to "how many times did you pull my credit". Bounded, because
 * an unbounded history read on a shared endpoint is how a summary becomes a
 * firehose.
 */
export async function listPulls(db, { clientId, limit = 50 } = {}) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const n = Number(limit);
  const bounded = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : 50;

  const res = await db.query(
    `SELECT id, pull_type, scope, status, reason, consent_document_id,
            requested_by, requested_at, completed_at, result_id, failure_reason
       FROM soft_pull_requests
      WHERE client_id = $1
      ORDER BY requested_at DESC, id DESC
      LIMIT $2`,
    [clientId, bounded]
  );
  return res.rows;
}
