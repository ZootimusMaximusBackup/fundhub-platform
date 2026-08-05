export function andNotDemo(alias = "c") {
  return `AND COALESCE(${alias}.is_demo, false) = false`;
}
export async function orgDemoModeEnabled(db, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id = $1`, [orgId]);
  return r.rows[0]?.demo_mode_enabled === true;
}
export function crmDemoFilterSQL(alias = "c", { demoMode = false } = {}) {
  if (demoMode) return "";
  return `AND COALESCE(${alias}.is_demo, false) = false`;
}
export function demoClause(alias = "", { includeDemo = false } = {}) {
  if (includeDemo) return "";
  const col = alias ? `${alias}.is_demo` : "is_demo";
  return `AND COALESCE(${col}, false) = false`;
}
