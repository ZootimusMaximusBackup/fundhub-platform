// Access tiers for Company Brain retrieval.
//
// Spec §4.6: filter by tier BEFORE retrieval. Role comes from the session.
// Reuse ROLE_SETS — do not invent a second permission model.
//
// Owner-set decisions:
//   H-1 2026-08-02: pgvector
//   H-2 2026-08-02: index everything
//   H-3 2026-08-02: only owner approves owner/affiliate classifications
//
// Step 5 mapping (derived only from existing ROLE_SETS):
//   Gate to query at all     → ROLE_SETS.STAFF
//   public / sales / staff   → ROLE_SETS.STAFF  (no separate sales set exists)
//   owner                    → ROLE_SETS.OPS    (owner + admin)
//   affiliate                → NEVER here (step 7 allowlist)

import { ROLE_SETS, allowsRole } from "../http/read-api.mjs";

export const ACCESS_TIERS = Object.freeze([
  "public",
  "sales",
  "staff",
  "owner",
  "affiliate"
]);

/**
 * Tiers the session role is cleared to see.
 * Empty array = refuse the query (fail closed).
 * Affiliate is NEVER included — separate allowlist in step 7.
 */
export function tiersForRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (!allowsRole(ROLE_SETS.STAFF, r)) return [];

  const tiers = ["public", "sales", "staff"];
  if (allowsRole(ROLE_SETS.OPS, r)) {
    tiers.push("owner");
  }
  return tiers;
}

/** True when the role may call Company Brain retrieval at all. */
export function canQueryBrain(role) {
  return tiersForRole(role).length > 0;
}

/**
 * Gate for retrieveChunks. Fail closed when the role is outside ROLE_SETS.STAFF.
 * @deprecated name kept as assertOwnerOnlyRole alias — prefer assertBrainAccess
 */
export function assertBrainAccess(role) {
  const tiers = tiersForRole(role);
  if (tiers.length === 0) {
    return { ok: false, reason: "forbidden_role", tiers: [] };
  }
  return { ok: true, reason: null, tiers };
}

/** @deprecated use assertBrainAccess — kept so older call sites keep working */
export function assertOwnerOnlyRole(role) {
  return assertBrainAccess(role);
}
