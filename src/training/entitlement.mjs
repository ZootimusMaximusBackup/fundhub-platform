// @ts-check
// Who may open the $10,000 training, and why the answer is what it is.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE QUESTION
//
// docs/specs/W0-decisions.md sells the training as part of a $10,000 entry fee.
// So the training screen is a paid deliverable, and a paid deliverable needs a
// check in front of it. This module is that check and the only one — nothing else
// in src/training/ decides access, and api/read/partner-training.mjs refuses a
// partner on this verdict before it reads a single progress row.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT "BOUGHT THE PROGRAM" IS READ FROM, AND THE GAP UNDERNEATH IT
//
// Two facts that already exist in this database, both about the partner row:
//
//   1. partners.status = 'active'. 042_partners.sql: 'invited' cannot sign in at
//      all and 'paused' is a suspended partner. Neither should be sitting in a
//      cohort, and neither is a person FundHub is currently willing to have
//      selling under its brand.
//   2. partners.agreement_signed_at IS NOT NULL — the signed partner licence.
//      This is the same stamp 042's partner_payout_agreement_gate() requires
//      before a single dollar can be paid to a partner, and 283 finally seeds the
//      document it names. It is the nearest thing this system has to "this person
//      is a partner on terms somebody signed".
//
// WHAT IT IS NOT READ FROM, STATED PLAINLY: there is no per-product proof of
// purchase for the $10,000 entry anywhere in this schema. `payment_links` carries
// no product code (119, extended by 277 to allow a partner_id), so no query can
// currently ask "did this partner pay for PARTNER_ENTRY". The offer exists
// (src/config/offers.mjs PARTNER_ENTRY, productCode 'partner-entry',
// priceCents 1000000); the receipt has nowhere to say which offer it settled.
// That absence is a finding, not a thing to paper over with a guess — so this
// module reads the two facts that are real and says so, rather than inventing a
// purchase check that would be wrong the first time somebody looked at it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE VERDICT ALWAYS CARRIES A REASON
//
// A bare false tells a partner "no" and tells the person supporting them nothing.
// Every refusal names itself:
//
//   no_partner          — no partner row in the caller's company with that id
//   partner_not_active  — status is 'invited' or 'paused'
//   agreement_unsigned  — no signed partner licence on the row
//
// The org is bound on the query, always, and it comes from the session. A partner
// id belonging to another company must resolve to no_partner rather than to a
// curriculum.

/** The verdicts this module can return. Exported so a screen and a test cannot
    disagree about the spelling of a reason. */
export const ACCESS_REASONS = Object.freeze([
  "no_partner",
  "partner_not_active",
  "agreement_unsigned"
]);

/**
 * @typedef {object} TrainingAccess
 * @property {boolean} allowed
 * @property {string|null} reason        one of ACCESS_REASONS, or null when allowed
 * @property {string|null} partnerStatus the status read off the row, or null
 * @property {string|null} agreementSignedAt
 */

/** Thrown by the write paths when a partner may not be enrolled or recorded
    against. The caller turns it into a 403. */
export class TrainingAccessError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = "TrainingAccessError";
    this.code = reason;
  }
}

/**
 * trainingAccessFor — may this partner open the training?
 *
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 * @returns {Promise<TrainingAccess>}
 */
export async function trainingAccessFor(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  if (!orgId) throw new Error("trainingAccessFor: orgId is required — refusing an unscoped read");
  if (!partnerId) throw new Error("trainingAccessFor: partnerId is required");

  const { rows } = await db.query(
    `SELECT id, status, agreement_signed_at
       FROM partners
      WHERE id = $1 AND org_id = $2
      LIMIT 1`,
    [partnerId, orgId]
  );
  const partner = rows[0];

  // Deliberately the same answer as "belongs to another company". Telling a
  // caller that a partner exists but is not theirs is itself a disclosure —
  // src/partners/scope.mjs makes the same choice for the same reason.
  if (!partner) {
    return { allowed: false, reason: "no_partner", partnerStatus: null, agreementSignedAt: null };
  }

  const status = partner.status || null;
  const signedAt = partner.agreement_signed_at || null;

  if (status !== "active") {
    return { allowed: false, reason: "partner_not_active", partnerStatus: status, agreementSignedAt: signedAt };
  }
  if (!signedAt) {
    return { allowed: false, reason: "agreement_unsigned", partnerStatus: status, agreementSignedAt: null };
  }
  return { allowed: true, reason: null, partnerStatus: status, agreementSignedAt: signedAt };
}

/**
 * assertTrainingAccess — the throwing form, for write paths.
 * @param {{query: Function}} db
 * @param {{orgId: string, partnerId: string}} args
 * @returns {Promise<TrainingAccess>}
 */
export async function assertTrainingAccess(db, { orgId, partnerId } = /** @type {any} */ ({})) {
  const access = await trainingAccessFor(db, { orgId, partnerId });
  if (!access.allowed) throw new TrainingAccessError(access.reason || "no_partner");
  return access;
}

/** A sentence a non-coder can read. The screen prints this; nothing branches on
    it. Kept beside the reasons so a new reason cannot ship without one. */
export function accessMessage(reason) {
  switch (reason) {
    case "no_partner":
      return "This training belongs to a white-label partner account. We could not find one for you.";
    case "partner_not_active":
      return "Your partner account is not active right now, so the training is closed. Talk to FundHub.";
    case "agreement_unsigned":
      return "Your partner agreement has not been signed yet. The training opens once it is.";
    default:
      return "";
  }
}
