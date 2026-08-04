// GET /api/staff/telemetry?staff_id=<uuid>
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { getStaffTelemetry } from "../../src/shifts/telemetry-query.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staffId = String((req.query && req.query.staff_id) || "").trim();
  if (!isUuid(staffId)) return res.status(400).json({ ok: false, error: "staff_id must be a uuid" });
  const get = deps.getStaffTelemetry || getStaffTelemetry;
  const out = await get(database, { orgId, staffId });
  if (!out.ok) {
    const status = out.reason === "staff_not_found" ? 404 : 400;
    return res.status(status).json({ ok: false, error: out.reason });
  }
  return res.status(200).json(out);
}
