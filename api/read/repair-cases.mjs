// GET /api/read/repair-cases — Specialist desk repair queue.
// STAFF, same as inquiry-cases. Letter bodies only on ?client_id=.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listRepairCases, getRepairCase } from "../../src/repair/cases.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.SPECIALIST_DESK)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const query = req.query || {};

  try {
    if (query.client_id) {
      if (!isUuid(query.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const detail = await getRepairCase(database, {
        orgId: staff.org_id,
        clientId: query.client_id
      });
      return res.status(200).json({ ok: true, ...detail });
    }

    const list = await listRepairCases(database, {
      orgId: staff.org_id,
      limit: Number(query.limit) || 100
    });
    return res.status(200).json({ ok: true, ...list });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
