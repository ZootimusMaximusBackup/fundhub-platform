// POST /api/slo-connections — owner map of ClickFunnels IDs → Fundhub product.
// COMPLIANCE REVIEW REQUIRED — payment rails (what a paid webhook may unlock).

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { saveConnection } from "../src/slo/connections.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "This screen only accepts a save request, not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  try {
    const result = await saveConnection(db, orgId, req.body || {});
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return res.status(status).json(result);
    }
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      connection: result.connection
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({
        ok: false, error: "duplicate_map",
        message: "That ClickFunnels funnel and product already map to a Fundhub product."
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
