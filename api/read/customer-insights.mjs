// GET /api/read/customer-insights?client_id=&stage=
// Staff list saved interviews. Also returns the question banks.

import { db } from "../../src/db.mjs";
import { requireAuth as defaultRequireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, page, pageParams } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { listInsights } from "../../src/insights/store.mjs";
import { QUESTIONS } from "../../src/insights/questions.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuth = deps.requireAuth ?? defaultRequireAuth;

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

  const query = req.query || {};
  const { limit, offset } = pageParams(query);
  const clientId = isUuid(query.client_id) ? String(query.client_id).trim() : null;
  const stage = query.stage ? String(query.stage).trim().toLowerCase() : null;

  try {
    const rows = await listInsights(database, {
      orgId: staff.org_id,
      clientId,
      stage,
      limit,
      offset
    });
    const envelope = page(rows, { limit, offset });
    return res.status(200).json({ ok: true, ...envelope, questions: QUESTIONS });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
