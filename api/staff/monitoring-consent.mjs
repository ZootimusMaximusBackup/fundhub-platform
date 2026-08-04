// POST /api/staff/monitoring-consent — owner-only grant/revoke.
// COMPLIANCE REVIEW REQUIRED — employee monitoring consent capture.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import {
  grantMonitoringConsent,
  revokeMonitoringConsent,
  CONSENT_FORM_VERSION
} from "../../src/shifts/monitoring-consent.mjs";

const OWNER_ONLY = new Set(["owner"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, OWNER_ONLY)) return;
  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const body = req.body || {};
  const staffId = String(body.staff_id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const formVersion = String(body.form_version || CONSENT_FORM_VERSION).trim();
  if (!isUuid(staffId)) return res.status(400).json({ ok: false, error: "staff_id must be a uuid" });
  if (action !== "grant" && action !== "revoke") {
    return res.status(400).json({ ok: false, error: "action must be grant or revoke" });
  }
  const grant = deps.grantMonitoringConsent || grantMonitoringConsent;
  const revoke = deps.revokeMonitoringConsent || revokeMonitoringConsent;
  const out = action === "grant"
    ? await grant(database, { orgId, staffId, formVersion, grantedByStaffId: staff.id || null })
    : await revoke(database, { orgId, staffId });
  if (!out.ok) {
    const status = out.reason === "staff_not_found" ? 404 : 400;
    return res.status(status).json({ ok: false, error: out.reason });
  }
  return res.status(200).json({
    ok: true,
    action: out.action,
    form_version: out.form_version || formVersion,
    staff: {
      id: out.staff.id,
      name: out.staff.name,
      email: out.staff.email,
      monitoring_consent_at: out.staff.monitoring_consent_at,
      monitoring_on: out.staff.monitoring_consent_at != null
    }
  });
}
