// Per-employee deep-monitoring consent — grant and revoke.
// Default OFF. Grant writes now(). Revoke clears to NULL.

export const CONSENT_FORM_VERSION = "2026-08-04";

export async function grantMonitoringConsent(db, {
  orgId, staffId, formVersion = CONSENT_FORM_VERSION, grantedByStaffId = null
} = {}) {
  if (!staffId) return { ok: false, reason: "missing_staff_id" };
  if (!orgId) return { ok: false, reason: "missing_org_id" };
  const res = await db.query(
    `UPDATE staff
        SET monitoring_consent_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING id, org_id, name, email, role, status,
                monitoring_consent_at, hubstaff_user_id`,
    [staffId, orgId]
  );
  const row = res && res.rows && res.rows[0];
  if (!row) return { ok: false, reason: "staff_not_found" };
  void grantedByStaffId;
  return { ok: true, staff: row, action: "grant", form_version: formVersion };
}

export async function revokeMonitoringConsent(db, { orgId, staffId } = {}) {
  if (!staffId) return { ok: false, reason: "missing_staff_id" };
  if (!orgId) return { ok: false, reason: "missing_org_id" };
  const res = await db.query(
    `UPDATE staff
        SET monitoring_consent_at = NULL
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING id, org_id, name, email, role, status,
                monitoring_consent_at, hubstaff_user_id`,
    [staffId, orgId]
  );
  const row = res && res.rows && res.rows[0];
  if (!row) return { ok: false, reason: "staff_not_found" };
  return { ok: true, staff: row, action: "revoke" };
}
