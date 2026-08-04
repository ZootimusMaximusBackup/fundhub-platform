// POST /api/applications — set application status (writes application_decisions).

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { setApplicationStatus, listApplicationDecisions, ApplicationStatusError } from "../src/applications/status.mjs";
import { dbDown } from "../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
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
    if (req.method === "GET") {
      const applicationId = (req.query || {}).application_id;
      if (!isUuid(applicationId)) {
        return res.status(400).json({ ok: false, error: "application_id required" });
      }
      const decisions = await listApplicationDecisions(database, {
        orgId,
        applicationId,
        limit: Number((req.query || {}).limit) || 50
      });
      return res.status(200).json({ ok: true, decisions });
    }

    const body = req.body || {};
    if (!isUuid(body.application_id)) {
      return res.status(400).json({ ok: false, error: "application_id required" });
    }
    const application = await setApplicationStatus(database, {
      orgId,
      applicationId: body.application_id,
      status: body.status,
      eventType: body.event_type || "status_change",
      staff,
      notes: body.notes || null,
      patch: body.patch || null
    });
    return res.status(200).json({ ok: true, application });
  } catch (err) {
    if (err instanceof ApplicationStatusError) {
      return res.status(err.status || 400).json({ ok: false, error: err.code, message: err.message });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
