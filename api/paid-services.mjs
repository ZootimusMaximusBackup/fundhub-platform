// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing and payment rail.
//
// /api/paid-services — the client-facing door to a paid "do it for me".
//
//   GET  → the price list, whether this client may buy one, and whether one is
//          already in flight. Reads nothing into the database and costs nothing.
//   POST → price it, record it, and mint a HOSTED CHECKOUT LINK. Charges
//          nothing: the link is a page the client may choose to visit.
//
// THE ROUTE KEY IS "paid-services", WITH A HYPHEN AND NO SLASH. Deliberate:
// src/http/routes.test.mjs:239 fails on any ROUTES key beginning "documents/",
// and netlify/functions/api.mjs resolves exact keys before its prefix branches.
// A flat key sidesteps both. A handler file is not a route (CLAUDE.md §12) —
// the one ROUTES line is in netlify/functions/api.mjs and routes.test.mjs
// fails without it.
//
// NO BUTTON SHIPS IN THIS LANE. This endpoint exists and is tested; the screen
// that calls it is a later wave.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS ENDPOINT WILL NOT DO
//
//   * It will not charge a card. There is no card here. Payment happens on the
//     processor's own page (src/subscriptions/charger.mjs:25 — the charger map
//     is empty and there is no path from a stored token to a charge).
//   * It will not mail anything, and it will not stage anything to be mailed.
//     Even the paid path only orders a fresh report; a human presses send.
//   * It will not let a client name somebody else. A client principal is pinned
//     to its own file exactly as api/read/portal-summary.mjs:43-51 pins one.
//
// FACTS, NOT COPY, with one deliberate exception: a REFUSAL carries its
// sentence, because the alternative is every screen inventing its own wording
// for "your payment worked but the report could not be ordered". Those
// sentences live in one table (src/paid-services/refusals.mjs) and obey the
// owner-set branding rule.

import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";
import { isDbDown, dbDown } from "../src/http/db-down.mjs";
import {
  SERVICE_KEY,
  requestRound,
  paidServiceOffer
} from "../src/paid-services/round.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    /* The literal "GET, POST" rather than a constant: scripts/journeys/extract.mjs:411
       reads the allowed methods off this exact string, and a variable here makes
       the generated journey page print "—" where the methods belong. */
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* LITERAL requirePrincipal(req, res, ["staff", "client"]) — NOT behind a
     variable, and not injectable. scripts/journeys/extract.mjs:137 finds this
     gate with a regular expression over the source, so hiding the call behind
     `const fn = deps.requirePrincipal ?? requirePrincipal` makes the generated
     journey page report this route as blocked to clients when it is not. That
     was measured on 2026-09-05: the page said "Blocked — 184 routes" and listed
     this one. A journey that is wrong about who can reach a paid endpoint is
     worse than no journey. Same reasoning as api/repair/send.mjs:25's literal
     requireRole. */
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  const body = (method === "POST" && req.body && typeof req.body === "object") ? req.body : {};
  const named = body.client_id ?? body.clientId
    ?? (req.query && (req.query.client_id ?? req.query.clientId))
    ?? null;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. A client's own file, always, whatever the body says.
       Naming somebody else is not a 403 with their data withheld — it is a 403,
       full stop, because answering "that is not you" for an id the caller
       guessed still confirms the guess. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
    if (named != null && named !== "" && String(named) !== String(clientId)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) return res.status(400).json({ ok: false, error: "org_required" });
    if (named != null && named !== "" && !isUuid(named)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = named || null;
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_id_required",
        message: "Pick a client first."
      });
    }
  }

  try {
    // The client must exist in THIS org. Checked before anything is priced so a
    // cross-tenant id cannot reach a pricing or eligibility read at all.
    const owned = await database.query(
      `SELECT outcome_tier FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }
    const outcomeTier = owned.rows[0].outcome_tier ?? null;

    if (method === "GET") {
      const offer = await paidServiceOffer(database, { orgId, clientId, outcomeTier });
      return res.status(200).json({ ok: true, services: [offer] });
    }

    // ── POST ───────────────────────────────────────────────────────────────
    const service = String(body.service ?? body.service_key ?? SERVICE_KEY);
    if (service !== SERVICE_KEY) {
      return res.status(400).json({
        ok: false,
        error: "unknown_service",
        message: "That is not something you can buy here."
      });
    }

    const waypointId = body.waypoint_id ?? body.waypointId ?? null;
    if (waypointId != null && waypointId !== "" && !isUuid(waypointId)) {
      return res.status(400).json({ ok: false, error: "invalid_waypoint_id" });
    }

    const idempotencyKey = firstString([
      body.idempotency_key,
      body.idempotencyKey,
      req.headers && (req.headers["idempotency-key"] || req.headers["Idempotency-Key"])
    ]);

    const outcome = await requestRound(database, {
      orgId,
      clientId,
      outcomeTier,
      requestedByKind: principal.kind === "client" ? "client" : "staff",
      requestedByAccountId: principal.kind === "client" ? (principal.accountId || null) : null,
      requestedByStaffId: principal.kind === "client" ? null : (principal.staff?.id || principal.staffId || null),
      creditorLetter: truthy(body.creditor_letter ?? body.creditorLetter),
      escalationFilings: truthy(body.escalation_filings ?? body.escalationFilings ?? body.cfpb_and_ag),
      waypointId: waypointId || null,
      idempotencyKey,
      env: deps.env ?? process.env,
      fetchImpl: deps.fetchImpl ?? fetch,
      ...(deps.mintFn ? { mintFn: deps.mintFn } : {})
    });

    if (!outcome.ok) {
      return res.status(outcome.status || 409).json({
        ok: false,
        error: outcome.reason,
        message: outcome.message,
        request: outcome.request ? publicRequest(outcome.request) : null
      });
    }

    /* 201 for a request this press created, 200 for one it did not.
       `checkout_pending` is the losing side of a genuine race: the winning
       press is minting the link right now, and the honest answer is "re-read in
       a moment", not a second link. A second link is how one press becomes two
       charges. */
    return res.status(outcome.created ? 201 : 200).json({
      ok: true,
      created: outcome.created === true,
      checkout_url: outcome.checkoutUrl || null,
      checkout_pending: outcome.checkoutPending === true,
      request: publicRequest(outcome.request)
    });
  } catch (err) {
    if (isDbDown(err)) return dbDown(res, err);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: safeError(err)
    });
  }
}

/** The row, minus anything a client has no business reading. `idempotency_key`
 *  and `payment_ref` are ours and the processor's; everything else on the row
 *  is the client's own receipt. */
function publicRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    service_kind: row.service_kind,
    status: row.status,
    state_reason: row.state_reason ?? null,
    price_components: row.price_components ?? [],
    // Integer cents, and NULL survives: null here means "not priced", which is
    // not the same as free and must never render as $0.
    price_total_cents: row.price_total_cents ?? null,
    amount_paid_cents: row.amount_paid_cents ?? null,
    currency: row.currency ?? "USD",
    checkout_url: row.checkout_url ?? null,
    round_no: row.round_no ?? null,
    waypoint_id: row.waypoint_id ?? null,
    requested_at: row.requested_at ?? null,
    paid_at: row.paid_at ?? null,
    resolved_at: row.resolved_at ?? null
  };
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === "string") return v === "true" || v === "1" || v === "yes";
  return v === 1;
}

function firstString(candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}
