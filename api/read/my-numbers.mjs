// GET /api/read/my-numbers — closer personal performance.
// Always scoped to the session staff member for role=closer.
// FINANCE may pass ?staff_id= to view another closer.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, allowsRole } from "../../src/http/read-api.mjs";
import { closerMyNumbers } from "../../src/sales/metrics.mjs";
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

  let staffId = staff.id;
  const qStaff = req.query?.staff_id;
  if (qStaff) {
    if (!allowsRole(ROLE_SETS.FINANCE, staff.role)) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Closers can only see their own numbers."
      });
    }
    if (!isUuid(qStaff)) {
      return res.status(400).json({ ok: false, error: "staff_id must be a uuid" });
    }
    staffId = String(qStaff).trim();
  } else if (String(staff.role).toLowerCase() !== "closer" && !allowsRole(ROLE_SETS.FINANCE, staff.role)) {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "My numbers is for closers."
    });
  }

  try {
    const data = await closerMyNumbers(database, { orgId: staff.org_id, staffId });
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
