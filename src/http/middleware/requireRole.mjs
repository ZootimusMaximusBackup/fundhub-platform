// requireRole — role gate layered on top of requireAuth.
//
// Gates on staff.role, NOT on a join against staff_roles. That is deliberate:
// staff_roles in 012_attribution.sql is a role CATALOG keyed by (org_id, key) —
// definitions, not assignments — and a staff member's role is the staff.role
// text column that softly references catalog keys (exactly as
// sale_attributions.role does). Gating on staff.role means the gate keeps
// working no matter what shape staff_roles turns out to have.
//
// 401 when there is no valid session, 403 when there is one and it is the wrong
// role. Those are different facts and the caller is entitled to both: a 403
// means "log in as someone else", a 401 means "log in".

import { requireAuth } from "./requireAuth.mjs";

// Roles that pass every gate. An owner is not listed on each individual route.
export const SUPER_ROLES = ["owner"];

const norm = (r) => String(r ?? "").trim().toLowerCase();

// hasRole — pure predicate. Exported because handlers frequently need to branch
// on role without rejecting the request outright.
export function hasRole(staff, allowed) {
  const want = (Array.isArray(allowed) ? allowed : [allowed]).map(norm).filter(Boolean);
  if (!staff) return false;
  const have = norm(staff.role);
  if (!have) return false;
  if (SUPER_ROLES.includes(have)) return true;
  return want.length === 0 || want.includes(have);
}

// requireRole(...allowed) → async (req, res, opts) => staff | null
//
//   const staff = await requireRole("admin", "closer")(req, res);
//   if (!staff) return;
//
export function requireRole(...allowed) {
  const want = allowed.flat();
  return async function roleGate(req, res, opts = {}) {
    const staff = await requireAuth(req, res, opts);
    if (!staff) return null;              // requireAuth already wrote the 401
    if (!hasRole(staff, want)) {
      res.status(403).json({ ok: false, error: "forbidden", required: want.map(norm) });
      return null;
    }
    return staff;
  };
}

export default requireRole;
