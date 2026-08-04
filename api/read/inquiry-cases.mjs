// GET /api/read/inquiry-cases — active inquiry removal case queue.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listCases, getActiveCaseForClient } from "../../src/inquiry-ops/cases.mjs";
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

  const query = req.query || {};

  try {
    if (query.client_id) {
      if (!isUuid(query.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const c = await getActiveCaseForClient(database, {
        orgId: staff.org_id,
        clientId: query.client_id
      });
      return res.status(200).json({ ok: true, case: c });
    }

    const cases = await listCases(database, {
      orgId: staff.org_id,
      activeOnly: query.active_only !== "false",
      case_status: query.case_status || null,
      assigned_remover: query.assigned_remover || null,
      limit: Number(query.limit) || 100,
      offset: Number(query.offset) || 0
    });
    return res.status(200).json({ ok: true, cases });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
