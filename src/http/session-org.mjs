// requireSessionOrg — refuse when the caller has no org on the session.
// Org comes from the session only. Never from the request body or query.

/**
 * sessionOrgId(staff) → uuid | null
 * `true` is the DASHBOARD_SECRET fallback (no org). Anything without org_id is null.
 */
export function sessionOrgId(staff) {
  if (!staff || staff === true) return null;
  const id = staff.org_id || staff.orgId || null;
  return id || null;
}

/**
 * requireSessionOrg(res, staff) → orgId | null
 * Writes 403 and returns null when the session has no org.
 */
export function requireSessionOrg(res, staff) {
  const orgId = sessionOrgId(staff);
  if (!orgId) {
    res.status(403).json({
      ok: false,
      error: "no_org_on_session",
      message: "this endpoint needs a staff session that belongs to a company"
    });
    return null;
  }
  return orgId;
}
