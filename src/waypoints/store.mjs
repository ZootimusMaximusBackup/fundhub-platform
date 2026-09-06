// Thin DB helpers for client_waypoints and paid_service_requests
// (db/migrations/330, 331). Pure SQL — no clock in business logic beyond
// DEFAULT now(), no HTTP, no processor call.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. requestPaidService() records what a
// client is asked to pay and when. IT CHARGES NOBODY. There is no processor
// call in this file and no stored card token is readable from it; the only rail
// this repository has is a hosted checkout link a human clicks
// (src/payments/commas-api.mjs), and minting one is somebody else's job.
//
// EVERY CONSTRAINT THAT MATTERS IS IN THE DATABASE, NOT HERE (CLAUDE.md §3a).
// This module builds rows the database will accept; it is not the thing that
// decides they are legal. Deleting this file cannot make a bad row storable.

import { sumComponents } from "./pricing.mjs";

export class WaypointError extends Error {
  constructor(message, { status = 400, code = "waypoint" } = {}) {
    super(message);
    this.name = "WaypointError";
    this.status = status;
    this.code = code;
  }
}

/**
 * One client's checklist, in display order.
 * Returns rows exactly as stored — `overdue` is computed here rather than
 * stored, because it is a fact about the clock and the clock moves.
 */
export async function listWaypoints(db, { orgId, clientId, now = new Date() } = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  const r = await db.query(
    `SELECT * FROM client_waypoints
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY position ASC, key ASC`,
    [orgId, clientId]
  );
  return (r.rows || []).map((row) => ({ ...row, overdue: isOverdue(row, now) }));
}

/**
 * Overdue is `due_at < now AND the row is still open`.
 *
 * NULL due_at is NOT overdue. It means nobody set a deadline (CLAUDE.md §12),
 * and treating unknown as breached would put a red flag on a client's screen
 * for a date that does not exist.
 */
export function isOverdue(row, now = new Date()) {
  if (!row || !row.due_at) return false;
  if (row.state === "done" || row.state === "skipped") return false;
  return new Date(row.due_at).getTime() < new Date(now).getTime();
}

/**
 * Create or update one waypoint, keyed on (client_id, key).
 *
 * paidAlternativePriceCents:
 *   omitted / null → no paid alternative. NOT free, and NOT zero — the column's
 *                    CHECK refuses 0 outright, so nothing downstream can read
 *                    one and call it free.
 *   a positive integer → the price.
 */
export async function upsertWaypoint(db, {
  orgId,
  clientId,
  key,
  title,
  detail = null,
  position = 0,
  ownerKind,
  state = "not_started",
  dueAt = null,
  completedAt = null,
  paidAlternativePriceCents = null,
  paidAlternativeLabel = null,
  paidAlternativeKind = null
} = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  if (!key) throw new WaypointError("key is required", { code: "key_required" });
  if (!title) throw new WaypointError("title is required", { code: "title_required" });
  if (ownerKind !== "client" && ownerKind !== "fundhub") {
    throw new WaypointError("ownerKind must be 'client' or 'fundhub'", { code: "owner_kind" });
  }
  if (paidAlternativePriceCents !== null && paidAlternativePriceCents !== undefined) {
    if (!Number.isInteger(paidAlternativePriceCents) || paidAlternativePriceCents <= 0) {
      throw new WaypointError(
        "paidAlternativePriceCents must be a positive integer number of cents, or null for no paid alternative",
        { code: "paid_price" }
      );
    }
  }

  const r = await db.query(
    `INSERT INTO client_waypoints
       (org_id, client_id, key, title, detail, position, owner_kind, state,
        due_at, completed_at,
        paid_alternative_price_cents, paid_alternative_label, paid_alternative_kind)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (client_id, key) DO UPDATE
        SET title                        = EXCLUDED.title,
            detail                       = EXCLUDED.detail,
            position                     = EXCLUDED.position,
            owner_kind                   = EXCLUDED.owner_kind,
            due_at                       = EXCLUDED.due_at,
            paid_alternative_price_cents = EXCLUDED.paid_alternative_price_cents,
            paid_alternative_label       = EXCLUDED.paid_alternative_label,
            paid_alternative_kind        = EXCLUDED.paid_alternative_kind
      RETURNING *`,
    [
      orgId, clientId, key, title, detail, position, ownerKind, state,
      dueAt, completedAt,
      paidAlternativePriceCents ?? null,
      paidAlternativeLabel,
      paidAlternativeKind
    ]
  );
  return r.rows[0];
}

/**
 * Mark a waypoint done. `state` and `completed_at` are written together
 * because a CHECK in the database refuses them apart.
 */
export async function completeWaypoint(db, { orgId, clientId, key, at = null } = {}) {
  const r = await db.query(
    `UPDATE client_waypoints
        SET state = 'done', completed_at = COALESCE($4::timestamptz, now())
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND key = $3
      RETURNING *`,
    [orgId, clientId, key, at]
  );
  return r.rows[0] || null;
}

/**
 * Record a "do it for me" request.
 *
 * IDEMPOTENCY. `idempotencyKey` is the natural key of the press — the same key
 * twice is the same request, not two. The partial unique index
 * uq_paid_service_requests_idem adjudicates that in the database, because two
 * simultaneous presses can both pass a SELECT before either reaches its INSERT.
 * A loser is handed the existing row with `created: false`, which is the same
 * answer the winner's second press would get. That is the shape 090 gave the
 * soft-pull double tap and it is copied rather than reinvented.
 *
 * A dispute round bought here does NOT consume repair_programs.rounds_cap.
 * `roundNo` is the self-serve counter and nothing in this function reads,
 * writes, or joins the program's cap.
 */
export async function requestPaidService(db, {
  orgId,
  clientId,
  waypointId = null,
  serviceKind,
  requestedByKind,
  requestedByAccountId = null,
  requestedByStaffId = null,
  components = [],
  roundNo = null,
  idempotencyKey = null,
  status = "quoted",
  checkoutUrl = null
} = {}) {
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");
  if (!serviceKind) throw new WaypointError("serviceKind is required", { code: "service_kind" });
  if (requestedByKind !== "client" && requestedByKind !== "staff") {
    throw new WaypointError("requestedByKind must be 'client' or 'staff'", { code: "requested_by" });
  }

  // A priced request carries its lines and its total together. NULL total means
  // "not priced yet" and is a real answer — it is not zero and it is not free.
  const totalCents = Array.isArray(components) && components.length
    ? sumComponents(components)
    : null;
  if (totalCents !== null && totalCents <= 0) {
    throw new WaypointError("a priced request must total more than zero cents", { code: "price_total" });
  }

  const r = await db.query(
    `INSERT INTO paid_service_requests
       (org_id, client_id, waypoint_id, service_kind,
        requested_by_kind, requested_by_account_id, requested_by_staff_id,
        status, price_components, price_total_cents, round_no, idempotency_key, checkout_url)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8,$9::jsonb,$10,$11,$12,$13)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      orgId, clientId, waypointId, serviceKind,
      requestedByKind, requestedByAccountId, requestedByStaffId,
      status, JSON.stringify(components || []), totalCents, roundNo, idempotencyKey, checkoutUrl
    ]
  );

  if (r.rows[0]) return { created: true, request: r.rows[0] };

  // Lost the race, or this is the second press. Hand back the row that won.
  if (idempotencyKey) {
    const existing = await db.query(
      `SELECT * FROM paid_service_requests
        WHERE org_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
      [orgId, idempotencyKey]
    );
    if (existing.rows[0]) return { created: false, request: existing.rows[0] };
  }
  return { created: false, request: null };
}

/** One client's paid-service history, newest first. */
export async function listPaidServiceRequests(db, { orgId, clientId } = {}) {
  const r = await db.query(
    `SELECT * FROM paid_service_requests
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY requested_at DESC`,
    [orgId, clientId]
  );
  return r.rows || [];
}

/**
 * The next self-serve round number for a client.
 *
 * Counts ONLY paid_service_requests. repair_programs.rounds_cap is a different
 * counter and is deliberately not consulted (owner-set): a round bought here is
 * extra and does not consume one the client already paid for with their
 * program.
 */
export async function nextSelfServeRoundNo(db, { clientId } = {}) {
  const r = await db.query(
    `SELECT COALESCE(MAX(round_no), 0) + 1 AS next
       FROM paid_service_requests
      WHERE client_id = $1::uuid AND round_no IS NOT NULL`,
    [clientId]
  );
  return Number(r.rows?.[0]?.next || 1);
}
