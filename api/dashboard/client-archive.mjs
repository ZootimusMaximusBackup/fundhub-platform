// POST /api/dashboard/client-archive
//
// Soft-archive a pipeline contact (owner-set "delete"):
//   - Remove all cards rows for that client+org
//   - Stamp clients.custom_fields.crm_archived_at (ISO)
// Does NOT wipe payments, CRS history, or the client row.
//
// Body: { client_id, confirm: "DELETE" }
// Typed "DELETE" only — a boolean is not confirmation.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { isUuid, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  // `true` is the DASHBOARD_SECRET fallback — no role to check; requireSessionOrg
  // still refuses it because a shared secret has no company.
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const body = req.body || {};
  const clientId = body.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "invalid_client_id" });
  }

  // Exact string. confirm: true / "delete" / "Delete" all refuse.
  if (body.confirm !== "DELETE") {
    return res.status(400).json({
      ok: false,
      error: "confirm_required",
      message: "Type DELETE exactly in confirm to archive this contact."
    });
  }

  // 404 for cross-org (oracle defence) — same as other single-client writes.
  if (!await requireClientInOrg(res, db, staff, clientId)) return;

  const stamp = { crm_archived_at: new Date().toISOString() };

  try {
    await db.query("BEGIN");
    const del = await db.query(
      `DELETE FROM cards WHERE client_id = $1::uuid AND org_id = $2::uuid`,
      [clientId, orgId]
    );
    // COALESCE so a null custom_fields does not stay null under ||.
    const upd = await db.query(
      `UPDATE clients
          SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE id = $1::uuid AND org_id = $2::uuid
        RETURNING id`,
      [clientId, orgId, JSON.stringify(stamp)]
    );
    if (!upd.rows[0]) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    await db.query("COMMIT");
    return res.status(200).json({
      ok: true,
      archived: true,
      client_id: clientId,
      cards_removed: del.rowCount ?? 0,
      crm_archived_at: stamp.crm_archived_at
    });
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch (_) { /* ignore */ }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
