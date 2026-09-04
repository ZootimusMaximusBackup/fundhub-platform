// May this client be asked to authorize dispute letters? One answer, one place.
//
// WHY IT IS NOT ../repair/on-repair-path.mjs. That file answers a narrower and
// different question — "is this a repair client" — and three other things lean
// on that answer. It says yes on EITHER the repair entitlement OR an
// outcome_tier of REPAIR_ONLY. This file answers the question the OWNER set on
// 2026-09-03, quoted in docs/workflows/manual-walkthrough-2026-09-03.md:1135:
//
//   "if they aren't going through credit repair, they don't need to
//    authorize... It's only for repair and for the funding offer. If they're
//    getting deliverables, meaning e-products and courses, they don't need to
//    sign for shit."
//
// So the door opens for TWO PURCHASES and nothing else:
//
//   1. REPAIR — the `metro2-letter-pack` entitlement, granted by repair-bundle,
//      repair-trial and consulting-package
//      (db/migrations/180_product_entitlements_seed.sql).
//   2. THE FUNDING OFFER — the `funding-snapshot` entitlement, which the same
//      migration grants for the `card-stacking-dfy` product, i.e. "Funding,
//      done-for-you" (src/config/offers.mjs FUNDING_DFY). The funding letter
//      pack really does contain dispute work — inquiry-removal and
//      personal-information letters come off the same engine
//      (src/underwrite/letter-pack.mjs) — so a funding client who is never asked
//      to sign is a client whose letters cannot go out.
//
// WHAT THEY BOUGHT, NEVER WHAT THEIR CREDIT FILE LOOKS LIKE. This gate reads
// entitlements and NO tier, in either direction:
//
//   * not a funding tier — FULL_FUNDING on a course buyer is a common state and
//     gating on it re-opens F35 directly;
//   * and not REPAIR_ONLY either. `clients.outcome_tier` is written by a REAL
//     credit pull — src/finance/crs-pull.mjs persistOutcomeTier() UPDATEs it on
//     every non-simulated run — so a course buyer whose file happens to grade
//     REPAIR_ONLY would be handed the dispute-authorization form. An earlier
//     version of this file reached REPAIR_ONLY through onRepairPath() and
//     claimed in a comment that the tier was "not a pull result". That was
//     wrong, and it is why this file no longer calls onRepairPath() at all.
//
//   The cost of dropping REPAIR_ONLY: a client who has bought nothing but whose
//   pull graded REPAIR_ONLY can no longer self-authorize in the portal. Staff
//   can still record an authorization for them — api/consent/capture.mjs
//   narrows the CLIENT principal only — and onRepairPath() is untouched, so the
//   DIY letter workflow (src/workflows/ds-02-diy-letters.mjs) still runs on the
//   tier exactly as it always has.
//
// FAILS CLOSED. No org, no client, or a database that will not answer is a no.
// The cost of a false negative is a client who has to be sent the sign link by
// hand. The cost of a false positive is a course buyer being asked to authorize
// credit disputes, which is the thing this closes.

import { has } from "../entitlements/entitlements.mjs";
import { REPAIR_ENTITLEMENT_CODE } from "../repair/on-repair-path.mjs";

/** The entitlement the "Funding, done-for-you" offer grants (migration 180). */
export const FUNDING_OFFER_ENTITLEMENT_CODE = "funding-snapshot";

/** Every purchase that may authorize dispute letters. Repair first: it is the
 *  commoner of the two, so the commoner case costs one query. */
export const DISPUTE_CONSENT_ENTITLEMENT_CODES = Object.freeze([
  REPAIR_ENTITLEMENT_CODE,
  FUNDING_OFFER_ENTITLEMENT_CODE
]);

/** mayAuthorizeDisputes — true when this client may be shown, and may sign, the
 * dispute-letter authorization.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string }} opts
 */
export async function mayAuthorizeDisputes(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return false;

  try {
    for (const code of DISPUTE_CONSENT_ENTITLEMENT_CODES) {
      if (await has(db, { orgId, clientId, code })) return true;
    }
    return false;
  } catch (err) {
    console.warn("[consent] entitlement read failed:", err && err.message);
    return false;
  }
}
