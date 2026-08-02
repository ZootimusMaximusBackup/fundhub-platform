// Access tiers for Company Brain retrieval.
//
// Spec §4.6: filter by tier BEFORE retrieval. Role comes from the session.
// Reuse ROLE_SETS for staff — do not invent a second staff permission model.
//
// Owner-set decisions:
//   H-1 2026-08-02: pgvector
//   H-2 2026-08-02: index everything
//   H-3 2026-08-02: only owner approves owner/affiliate classifications
//
// Step 5 (staff):
//   Gate                    → ROLE_SETS.STAFF
//   public / sales / staff  → ROLE_SETS.STAFF
//   owner                   → ROLE_SETS.OPS
//   affiliate               → NEVER on the staff path
//
// Step 7 (external — affiliates & white-label partners):
//   Separate allowlist. External roles see ONLY `affiliate` tier rows that
//   also appear on brain_affiliate_allowlist. No fallback to internal tiers.

import { ROLE_SETS, allowsRole } from "../http/read-api.mjs";

export const ACCESS_TIERS = Object.freeze([
  "public",
  "sales",
  "staff",
  "owner",
  "affiliate"
]);

/** Roles that may hit the external Company Brain path. Not ROLE_SETS.STAFF. */
export const EXTERNAL_BRAIN_ROLES = Object.freeze(new Set(["affiliate", "partner"]));

export function isExternalBrainRole(role) {
  return EXTERNAL_BRAIN_ROLES.has(String(role || "").trim().toLowerCase());
}

/**
 * Staff/internal tiers. Affiliate is NEVER included.
 * Empty array = refuse (fail closed).
 */
export function tiersForRole(role) {
  const r = String(role || "").trim().toLowerCase();
  // External roles must not receive internal tiers through this function.
  if (isExternalBrainRole(r)) return [];
  if (!allowsRole(ROLE_SETS.STAFF, r)) return [];

  const tiers = ["public", "sales", "staff"];
  if (allowsRole(ROLE_SETS.OPS, r)) {
    tiers.push("owner");
  }
  return tiers;
}

/**
 * External allowlist tiers. ONLY `affiliate`. Never public/sales/staff/owner.
 */
export function tiersForAffiliateRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (!isExternalBrainRole(r)) return [];
  return ["affiliate"];
}

/** True when the role may call the STAFF Company Brain endpoint. */
export function canQueryBrain(role) {
  return tiersForRole(role).length > 0;
}

/** True when the role may call the EXTERNAL Company Brain endpoint. */
export function canQueryAffiliateBrain(role) {
  return tiersForAffiliateRole(role).length > 0;
}

/**
 * Refuse any mixed tier list. Affiliate must never share a query with internal
 * tiers — that is the step-7 hard rule.
 */
export function assertTierListSafe(tiers, { external = false } = {}) {
  const list = Array.isArray(tiers) ? tiers.map(String) : [];
  const hasAffiliate = list.includes("affiliate");
  const hasInternal = list.some((t) => t !== "affiliate");
  if (external) {
    if (!hasAffiliate || hasInternal || list.length !== 1) {
      return { ok: false, reason: "unsafe_external_tiers", tiers: [] };
    }
    return { ok: true, reason: null, tiers: ["affiliate"] };
  }
  if (hasAffiliate) {
    return { ok: false, reason: "affiliate_on_staff_path", tiers: [] };
  }
  return { ok: true, reason: null, tiers: list };
}

export function assertBrainAccess(role) {
  const tiers = tiersForRole(role);
  const safe = assertTierListSafe(tiers, { external: false });
  if (!safe.ok || tiers.length === 0) {
    return { ok: false, reason: safe.reason || "forbidden_role", tiers: [] };
  }
  return { ok: true, reason: null, tiers: safe.tiers };
}

export function assertAffiliateBrainAccess(role) {
  if (!isExternalBrainRole(role)) {
    return { ok: false, reason: "forbidden_role", tiers: [] };
  }
  const tiers = tiersForAffiliateRole(role);
  const safe = assertTierListSafe(tiers, { external: true });
  if (!safe.ok || tiers.length === 0) {
    return { ok: false, reason: safe.reason || "forbidden_role", tiers: [] };
  }
  return { ok: true, reason: null, tiers: safe.tiers };
}

/** @deprecated use assertBrainAccess */
export function assertOwnerOnlyRole(role) {
  return assertBrainAccess(role);
}
