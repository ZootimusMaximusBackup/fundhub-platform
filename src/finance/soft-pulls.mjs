// Soft pulls — the on-demand path. A client whose file is already open needs an
// updated credit picture; somebody taps once; a request is recorded; when an
// answer arrives it lands through the ingest path that already exists.
//
// *** NOTHING HERE TRANSMITS. ***
// There is no outbound `fetch()` in src/adapters/ or src/lib/ and this module
// does not add one. requestSoftPull() writes a row with status='queued' and
// stops, exactly as sendTemplated() (src/workflows/messaging.mjs) writes a
// `messages` row with provider='internal', status='queued' and stops. The
// provider call is a named, documented seam below — see PROVIDER SEAM. Nobody
// should read "queued" as "sent"; today it means "recorded, and nobody has asked
// a bureau anything".
//
//
// THE FOUR RULES THIS MODULE ENFORCES, rather than trusting callers to remember:
//
//   1. NO ATTRIBUTION, NO PULL. A soft pull is a consumer-credit event. Every
//      request records who initiated it and why, and a request that cannot say
//      either is REFUSED — the same position revealSsn() takes in
//      src/pii/index.mjs ("an unattributed reveal is not loggable"), and for the
//      same reason: a log nobody can trace back to a person is paperwork, not an
//      audit trail. 077 backs this with a CHECK constraint, so the refusal holds
//      even for a writer that does not come through this module.
//
//   2. ONE TAP IS ONE PULL. A button on a phone gets tapped twice and retried by
//      the network. Two guards, at different distances: the caller's
//      idempotencyKey (unique index in 077) collapses a literal retry, and an
//      already-open request for the same client is RETURNED rather than
//      duplicated. Neither is decorative — pulling a consumer's credit twice
//      because a request timed out is a real harm and a real cost.
//
//   3. ONE READER OF A PULL PAYLOAD. fulfil() calls ingestCrsResult() from
//      src/tradelines/store.mjs. It does not parse crs_results.result itself and
//      must never start: two readers of one payload that drift apart is the
//      defect class this repo keeps finding, and the normalizer already handles
//      the vendor disagreements (src/tradelines/index.mjs).
//
//   4. NULL SURVIVES. An unknown cost stays NULL all the way down. It is not
//      defaulted to zero on the way in, and it is not rendered as "$0.00" on the
//      way out — see costDisplay().
//
//
// NO SUBSCRIPTION IMPORT, DELIBERATELY. subscriptionId is a plain parameter and
// this module imports nothing from the subscription/stored-card build. That work
// runs in parallel; coupling the two through an import would make each unable to
// land without the other. NULL is a legitimate value here and means "ad-hoc, or
// the plan is unknown", never "free".

import { fromCents } from "../commissions/money.mjs";
import { ingestCrsResult } from "../tradelines/store.mjs";

export class SoftPullError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "SoftPullError";
    this.status = status;
  }
}

/** The states a request can be in. Mirrors the CHECK in 077 — there is no
 *  'sent', because there is nothing that sends. */
export const SOFT_PULL_STATUSES = ["queued", "fulfilled", "failed", "cancelled"];
export const REQUESTER_KINDS = ["staff", "client"];

const SELECT_COLUMNS = `
  id, org_id, client_id,
  requested_by_kind, requested_by_staff_id, requested_by_account_id,
  reason, cost_cents, subscription_id, crs_result_id,
  status, state_reason, provider, idempotency_key,
  requested_at, resolved_at, created_at, updated_at`;

/* normalizeRequester — a principal-ish thing → { kind, staffId, accountId }.
 *
 * Accepts { kind, id } or { kind, staffId } / { kind, accountId }, because the
 * two call sites naturally hold different shapes: a staff principal has staffId,
 * an account principal has accountId. Anything that does not resolve to a kind
 * AND a subject is refused with 401 rather than defaulted — see rule 1. */
export function normalizeRequester(requestedBy) {
  const kind = String(requestedBy?.kind ?? "").trim().toLowerCase();
  const id = requestedBy?.id ?? (kind === "staff" ? requestedBy?.staffId : requestedBy?.accountId);

  if (!kind || !id) {
    throw new SoftPullError(
      "requestedBy is required — an unattributed soft pull is not loggable",
      { status: 401 }
    );
  }
  if (!REQUESTER_KINDS.includes(kind)) {
    throw new SoftPullError(
      `requestedBy.kind must be one of: ${REQUESTER_KINDS.join(", ")}`,
      { status: 400 }
    );
  }
  return {
    kind,
    staffId: kind === "staff" ? String(id) : null,
    accountId: kind === "client" ? String(id) : null
  };
}

/* normalizeReason — a stated purpose, or a refusal.
 *
 * "   " is refused as hard as "" is. A whitespace reason is worse than a missing
 * one: it satisfies a NOT NULL, looks populated in an export, and tells an
 * auditor nothing. src/http/pii.pg.test.mjs pins the identical distinction for
 * SSN reveals; a non-string is a 400 rather than being coerced, so that neither
 * "42" nor "[object Object]" can become the sentence somebody later reads. */
export function normalizeReason(reason) {
  if (typeof reason !== "string" || !reason.trim()) {
    throw new SoftPullError(
      "reason is required — every soft pull is written to soft_pull_requests",
      { status: 400 }
    );
  }
  return reason.trim();
}

/* normalizeCostCents — integer cents, or null meaning UNKNOWN.
 *
 * Not defaulted to 0. "We do not know what this pull cost" and "this pull was
 * free" are different facts and only one of them belongs in a billing report.
 * A float is refused rather than rounded: a caller passing 12.5 is passing
 * dollars-shaped data into a cents-shaped column, and silently accepting it is
 * how a 12-cent charge becomes a 12-dollar one. Convert at the boundary with
 * toCents() from src/commissions/money.mjs, deliberately, before calling here. */
export function normalizeCostCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) {
    throw new SoftPullError(
      `cost_cents must be an integer number of cents (got ${JSON.stringify(value)})`
    );
  }
  if (n < 0) throw new SoftPullError("cost_cents cannot be negative");
  return n;
}

/** costDisplay — cents → a 2dp string for a screen, or null. NULL stays NULL:
 *  an unknown cost must not render as "0.00". */
export function costDisplay(costCents) {
  return costCents === null || costCents === undefined ? null : fromCents(Number(costCents));
}

/** decorate — the row as callers should see it: the stored columns plus the
 *  rendered cost, so no screen has to know the cents convention. */
export function decorate(row) {
  return row ? { ...row, cost_display: costDisplay(row.cost_cents) } : row;
}

/**
 * openRequestFor — the client's outstanding request, or null.
 * Exported because "is a pull already in flight for this client" is a question
 * the portal button needs to ask before it renders, not only when it is tapped.
 */
export async function openRequestFor(db, { clientId }) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
      WHERE client_id = $1 AND status = 'queued'
      ORDER BY requested_at ASC LIMIT 1`,
    [clientId]
  );
  return res.rows[0] ? decorate(res.rows[0]) : null;
}

/**
 * requestSoftPull — record that somebody asked for a pull. THE ONE-TAP PATH.
 *
 * Returns { created, request }. `created: false` means an equivalent request was
 * already open (or an identical idempotency key had already been used) and the
 * EXISTING row is returned — the caller's tap is acknowledged without a second
 * consumer-credit event being recorded or a second cost being incurred.
 *
 * Nothing is sent. See PROVIDER SEAM at the end of this function.
 */
export async function requestSoftPull(db, {
  orgId,
  clientId,
  requestedBy,
  reason,
  costCents = null,
  subscriptionId = null,
  idempotencyKey = null,
  provider = "internal"
} = {}) {
  if (!orgId || !clientId) throw new SoftPullError("orgId and clientId are required");

  // Attribution first, before anything touches the database. A request that
  // cannot say who asked is not a request we are willing to have half-written.
  const requester = normalizeRequester(requestedBy);
  const statedReason = normalizeReason(reason);
  const cost = normalizeCostCents(costCents);
  const idem = typeof idempotencyKey === "string" && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : null;

  // GUARD 1 — the same tap, replayed. Checked before the open-request guard so
  // a retry gets back the row it made rather than somebody else's older one.
  if (idem) {
    const prior = await db.query(
      `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
        WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, idem]
    );
    if (prior.rows[0]) return { created: false, reason: "replay", request: decorate(prior.rows[0]) };
  }

  // GUARD 2 — a pull is already outstanding for this client. Returning it is the
  // honest answer to a second tap: the work is already recorded, and starting a
  // second one would bill twice for one question.
  const open = await openRequestFor(db, { clientId });
  if (open) return { created: false, reason: "already_open", request: open };

  const res = await db.query(
    `INSERT INTO soft_pull_requests
       (org_id, client_id, requested_by_kind, requested_by_staff_id, requested_by_account_id,
        reason, cost_cents, subscription_id, idempotency_key, provider, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')
     RETURNING ${SELECT_COLUMNS}`,
    [orgId, clientId, requester.kind, requester.staffId, requester.accountId,
     statedReason, cost, subscriptionId ?? null, idem, String(provider || "internal")]
  );

  /* ── PROVIDER SEAM ───────────────────────────────────────────────────────
     This is where a real soft pull would be requested, and it is not here.

     A provider client belongs in src/adapters/ alongside the inbound parsers,
     takes the request row's id as its own idempotency key, and on an answer
     calls fulfilSoftPull() below with the crs_results row it wrote. It does NOT
     belong inline in this function: an outbound call inside the same await as
     the ledger insert makes "we recorded it" and "we asked for it" fail
     together, and the whole point of the ledger is that the record survives a
     provider that is down.

     Until that exists the row sits at 'queued', which is what queued means.
     ──────────────────────────────────────────────────────────────────────── */

  return { created: true, request: decorate(res.rows[0]) };
}

/**
 * fulfilSoftPull — an answer arrived. Link it, ingest it, close the request.
 *
 * REUSES ingestCrsResult(). This function contains no knowledge of what a bureau
 * payload looks like and must never acquire any — rule 3 in the header.
 *
 * Transactional, and in this order: the ledger row is stamped before the
 * tradelines are written, so a failure part-way cannot leave a client's cards
 * updated by a pull the ledger says never completed. Both halves land or neither
 * does — the same reasoning as revealSsn()'s log-then-disclose.
 */
export async function fulfilSoftPull(db, { requestId, crsResultId } = {}) {
  if (!requestId) throw new SoftPullError("requestId is required");
  if (!crsResultId) throw new SoftPullError("crsResultId is required");

  return withTransaction(db, async (tx) => {
    const request = (await tx.query(
      `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    )).rows[0];
    if (!request) throw new SoftPullError("no such soft pull request", { status: 404 });
    if (request.status !== "queued") {
      throw new SoftPullError(
        `soft pull request is already ${request.status}`,
        { status: 409 }
      );
    }

    const crsRow = (await tx.query(
      `SELECT id, org_id, client_id, result, outcome_tier, created_at
         FROM crs_results WHERE id = $1`,
      [crsResultId]
    )).rows[0];
    if (!crsRow) throw new SoftPullError("no such crs_results row", { status: 404 });

    // An answer about somebody else is not an answer to this question. Without
    // this check a mis-joined fulfil would attribute one person's credit file to
    // another client's request AND ingest their tradelines — the same class of
    // harm the AAD binding in src/pii/index.mjs exists to prevent.
    if (String(crsRow.client_id) !== String(request.client_id)) {
      throw new SoftPullError(
        "that crs_results row belongs to a different client",
        { status: 409 }
      );
    }

    const updated = (await tx.query(
      `UPDATE soft_pull_requests
          SET status = 'fulfilled', crs_result_id = $2,
              resolved_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [requestId, crsResultId]
    )).rows[0];

    // THE EXISTING INGEST PATH. One reader of a pull payload, and this is not it.
    const ingest = await ingestCrsResult(tx, crsRow);

    return { request: decorate(updated), ingested: ingest.ingested, tradelines: ingest.rows };
  });
}

/**
 * closeSoftPull — end a request without an answer.
 * `status` is 'failed' (the request could not be answered) or 'cancelled' (it
 * was withdrawn). Both demand a stated reason, for the same reason the request
 * itself does: "it ended" is not an audit trail.
 */
export async function closeSoftPull(db, { requestId, status, reason } = {}) {
  if (!requestId) throw new SoftPullError("requestId is required");
  if (status !== "failed" && status !== "cancelled") {
    throw new SoftPullError("status must be one of: failed, cancelled");
  }
  const stated = normalizeReason(reason);

  const res = await db.query(
    `UPDATE soft_pull_requests
        SET status = $2, state_reason = $3, resolved_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING ${SELECT_COLUMNS}`,
    [requestId, status, stated]
  );
  if (!res.rows[0]) {
    // Either it does not exist or it is already resolved. Both mean "this call
    // did not do what it was asked", and neither should look like success.
    throw new SoftPullError("no queued soft pull request with that id", { status: 409 });
  }
  return decorate(res.rows[0]);
}

/* boundedLimit — clamps BOTH ends, and treats a non-positive limit as "use the
   default" rather than as a number.
   `Math.min(parseInt(q.limit) || 100, 200)` is the idiom three routes in this
   repo shipped, and it lets -1 through — parseInt("-1") is truthy — so a
   one-character typo in a URL becomes a 500 carrying raw Postgres text
   ("LIMIT must not be negative"). Clamping to 1 would be safe but silently
   answers a different question than the caller asked; falling back to the
   default is the behaviour src/http/read-api.mjs pageParams() already has. */
export function boundedLimit(raw, fallback = 50) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}

/** listSoftPullRequests — one client's pull history, newest first. This is the
 *  read the phrase "why was this person's credit pulled" resolves to. */
export async function listSoftPullRequests(db, { clientId, limit = 50 } = {}) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const capped = boundedLimit(limit);
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
      WHERE client_id = $1
      ORDER BY requested_at DESC, id DESC
      LIMIT $2`,
    [clientId, capped]
  );
  return res.rows.map(decorate);
}

/** getSoftPullRequest — one row, or null. */
export async function getSoftPullRequest(db, requestId) {
  if (!requestId) throw new SoftPullError("requestId is required");
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1`, [requestId]
  );
  return res.rows[0] ? decorate(res.rows[0]) : null;
}

/* Same shape as src/pii/index.mjs: a pool gets a real transaction, a plain
   client or a test double is used as-is. */
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
