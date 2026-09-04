// May this client be asked to authorize dispute letters? One answer, one place.
//
// WHY IT IS NOT ../repair/on-repair-path.mjs. That file answers a narrower and
// different question — "is this a repair client" — and three other things lean on
// that answer. This one answers the question the OWNER actually set on
// 2026-09-03, quoted in docs/workflows/manual-walkthrough-2026-09-03.md:1135:
//
//   "if they aren't going through credit repair, they don't need to
//    authorize... It's only for repair and for the funding offer. If they're
//    getting deliverables, meaning e-products and courses, they don't need to
//    sign for shit."
//
// So the door opens for TWO offers and nothing else:
//
//   1. REPAIR — ../repair/on-repair-path.mjs, unchanged and re-used rather than
//      re-stated: the `metro2-letter-pack` entitlement (granted by repair-bundle,
//      repair-trial and consulting-package) or outcome_tier REPAIR_ONLY.
//   2. THE FUNDING OFFER — the `funding-snapshot` entitlement, which is what
//      db/migrations/180_product_entitlements_seed.sql grants for the
//      `card-stacking-dfy` product, i.e. "Funding, done-for-you"
//      (src/config/offers.mjs FUNDING_DFY). The funding letter pack really does
//      contain dispute work — inquiry-removal and personal-information letters
//      come off the same engine (src/underwrite/letter-pack.mjs) — so a funding
//      client who is never asked to sign is a client whose letters cannot go out.
//
// THE OFFER, NOT THE TIER. It is tempting to add isFundingPath(outcome_tier)
// here and it would re-open the exact hole F35 reported. `outcome_tier` is
// stamped by the analyzer on ANY client who gets a credit pull, course buyers
// included: the walk's Academy buyer had been pulled. Gating on the tier would
// put the dispute-authorization form back in front of them. What separates a
// repair or funding customer from a course customer is WHAT THEY BOUGHT, and
// that is an entitlement. REPAIR_ONLY survives only because it arrives through
// onRepairPath, where it is the DIY letter path's own long-standing rule
// (src/workflows/ds-02-diy-letters.mjs) and not a pull result.
//
// FAILS CLOSED, for the same reason on-repair-path.mjs does. No org, no client,
// or a database that will not answer is a no. The cost of a false negative is a
// client who has to be sent the sign link by hand. The cost of a false positive
// is a course buyer being asked to authorize credit disputes, which is the thing
// this closes.

import { has } from "../entitlements/entitlements.mjs";
import { onRepairPath } from "../repair/on-repair-path.mjs";

/** The entitlement the "Funding, done-for-you" offer grants (migration 180). */
export const FUNDING_OFFER_ENTITLEMENT_CODE = "funding-snapshot";

/** mayAuthorizeDisputes — true when this client may be shown, and may sign, the
 * dispute-letter authorization.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string, repairPath?: boolean }} opts
 *   `repairPath` is optional: pass it when the caller already asked
 *   onRepairPath() (the portal summary does) so this does not repeat the reads.
 */
export async function mayAuthorizeDisputes(db, { orgId, clientId, repairPath } = {}) {
  if (!orgId || !clientId) return false;

  const repair = repairPath === undefined
    ? await onRepairPath(db, { orgId, clientId })
    : repairPath === true;
  if (repair) return true;

  try {
    return await has(db, { orgId, clientId, code: FUNDING_OFFER_ENTITLEMENT_CODE });
  } catch (err) {
    console.warn("[consent] funding entitlement read failed:", err && err.message);
    return false;
  }
}
