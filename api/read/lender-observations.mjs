// GET /api/read/lender-observations — bureau mismatch review queue.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listObservations } from "../../src/lenders/store.mjs";
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
  const mismatchOnly = q.mismatch_only === "1" || q.mismatch_only === "true" || q.mismatch_only == null;
  const reviewStatus = q.review_status === "" || q.review_status === "all"
    ? null
    : (q.review_status || "pending");

  try {
    const observations = await listObservations(database, {
      orgId: staff.org_id,
      mismatch_only: mismatchOnly,
      review_status: reviewStatus,
      limit: q.limit,
      offset: q.offset
    });
    return res.status(200).json({
      ok: true,
      observations,
      meta: { count: observations.length }
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
