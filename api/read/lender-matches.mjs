// GET /api/read/lender-matches?client_id= — lenders that fit a client's
// underwrite / inquiry profile for round planning (Card Stacking).
//
// Structural filters only (state, inquiry sensitivity, bureau rotation).
// Returns match_count: 0 when the lender table is empty — never invents names.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { matchForClient } from "../../src/lenders/store.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const q = req.query || {};
  if (!isUuid(q.client_id)) {
    return res.status(400).json({
      ok: false,
      error: "client_id is required and must be a uuid"
    });
  }

  try {
    const result = await matchForClient(database, {
      orgId: staff.org_id,
      clientId: q.client_id,
      lenderTable: q.lender_table || null
    });
    if (!result) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }
    return res.status(200).json({
      ok: true,
      client_id: q.client_id,
      match_count: result.summary.match_count,
      summary: result.summary,
      matches: result.matches,
      skipped: result.skipped
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
