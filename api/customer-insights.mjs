// POST /api/customer-insights — staff save a mid check-in or post-funding interview.
// COMPLIANCE REVIEW REQUIRED: answers may later feed ads / VSL. Store only.

import { db } from "../src/db.mjs";
import { requireAuth as defaultRequireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { InsightError, saveInsight } from "../src/insights/store.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuth = deps.requireAuth ?? defaultRequireAuth;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    const insight = await saveInsight(database, {
      orgId: staff.org_id,
      staffId: staff.id,
      input: req.body || {}
    });
    return res.status(201).json({ ok: true, insight });
  } catch (e) {
    if (e instanceof InsightError) {
      return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
