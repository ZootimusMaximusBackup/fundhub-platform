// POST /api/ai-bureau-config — upsert IVR routing rows (owner / funding advisor).

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../src/http/read-api.mjs";
import { upsertAiBureauConfig, updateAiBureauConfig } from "../src/inquiry-ops/ai-bureau-config.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const EDITOR_ROLES = new Set(["owner", "admin", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, EDITOR_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  const action = String(body.action || "upsert").trim().toLowerCase();

  try {
    if (action === "save" && isUuid(body.id)) {
      const row = await updateAiBureauConfig(database, {
        orgId,
        id: body.id,
        patch: body.patch || body,
        staff
      });
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, config: row });
    }

    const row = await upsertAiBureauConfig(database, {
      orgId,
      row: body,
      staff
    });
    return res.status(200).json({ ok: true, config: row });
  } catch (err) {
    if (err.code === "bureau_required") {
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
