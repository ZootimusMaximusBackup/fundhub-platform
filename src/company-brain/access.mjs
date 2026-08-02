// Access tiers for Company Brain retrieval.
//
// Spec: filter by tier BEFORE retrieval. Role comes from the session.
// Step 2 (owner-set H-1 = pgvector): only owner/admin may query (retrieval).
// Step 4 classification: public/sales/staff may auto-assign onto chunks.
// Owner-set H-3 2026-08-02: only the owner role may approve owner/affiliate.
// Retrieval still owner-only until step 5 wires ROLE_SETS.
// Affiliate query path is step 7 (separate allowlist).

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
 * Affiliate is NEVER included here — separate allowlist in step 7.
 */
export function tiersForRole(role) {
  const r = String(role || "").trim().toLowerCase();
  // Step 2: owner-only access.
  if (r === "owner" || r === "admin") {
    return ["public", "sales", "staff", "owner"];
  }
  return [];
}

export function assertOwnerOnlyRole(role) {
  const tiers = tiersForRole(role);
  if (tiers.length === 0) {
    return { ok: false, reason: "forbidden_role", tiers: [] };
  }
  return { ok: true, reason: null, tiers };
}
