// GET /api/read/call-outcomes — list dispositions (org-scoped).
// Closers see their own by default; FINANCE sees the floor.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  ROLE_SETS, requireRole, isUuid, allowsRole, pageParams, page
} from "../../src/http/read-api.mjs";
import { presentOutcome } from "../../src/sales/call-outcomes.mjs";
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

  const { limit, offset } = pageParams(req.query || {});
  const finance = allowsRole(ROLE_SETS.FINANCE, staff.role);
  const params = [orgId];
  let where = "org_id = $1";
  if (!finance) {
    params.push(staff.id);
    where += ` AND staff_id = $${params.length}`;
  } else if (isUuid(req.query?.staff_id)) {
    params.push(String(req.query.staff_id).trim());
    where += ` AND staff_id = $${params.length}`;
  }
  if (isUuid(req.query?.client_id)) {
    params.push(String(req.query.client_id).trim());
    where += ` AND client_id = $${params.length}`;
  }
  params.push(limit + 1, offset);

  try {
    const r = await database.query(
      `SELECT * FROM call_outcomes
        WHERE ${where}
        ORDER BY logged_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const envelope = page(r.rows.map(presentOutcome), { limit, offset });
    return res.status(200).json({ ok: true, ...envelope });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
