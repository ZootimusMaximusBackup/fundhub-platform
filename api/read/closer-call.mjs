// GET /api/read/closer-call?client_id= — Closer Dashboard live-call payload.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { buildCockpit } from "../../src/sales/cockpit.mjs";
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
  if (!isUuid(req.query?.client_id)) {
    return res.status(400).json({
      ok: false,
      error: "client_id is required and must be a uuid"
    });
  }

  try {
    const data = await buildCockpit(database, {
      orgId: staff.org_id,
      staffId: staff.id,
      clientId: String(req.query.client_id).trim()
    });
    if (!data) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
