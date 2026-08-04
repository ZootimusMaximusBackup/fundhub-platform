// GET /api/read/ai-bureau-config — IVR routing table (empty until edited).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listAiBureauConfig } from "../../src/inquiry-ops/ai-bureau-config.mjs";
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

  try {
    const configs = await listAiBureauConfig(database, { orgId: staff.org_id });
    return res.status(200).json({ ok: true, configs, meta: { empty: configs.length === 0 } });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
