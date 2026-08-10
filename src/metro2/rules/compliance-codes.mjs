// Exhibit 8 — Compliance Condition Codes (Field 20). Knowledge base § 1.9.
//
// Field 20 is where a furnisher records that an account is in dispute. It is
// the highest-value dispute target in the format for one reason: a furnisher
// that receives a meritorious dispute and keeps reporting the account without a
// dispute flag has failed § 1681s-2(a)(3), and both Saunders (4th Cir.) and
// Gorman (9th Cir.) say so in terms.
//
// THE XB / XH / XC PATTERN. XB means "disputed, investigation in progress" and
// must come off when the investigation closes. XH means "previously disputed,
// investigation complete" and says nothing about whether the consumer accepted
// the outcome. XC means "investigation complete, consumer still disagrees".
// Reporting XH where the consumer plainly disagrees drops the disagreement out
// of the file — which is the Fulton / Wood / Matson litigation pattern and the
// substance of check M2-030.
//
// `composes` records the codes a combination code stands in for, so a check
// asking "is a dispute flagged?" can accept XD (which contains XB) without a
// second table.

export const COMPLIANCE_CODES = Object.freeze({
  XA: {
    meaning: "Account closed at consumer's request",
    keyTrigger: "Date Closed must match",
    requiresDateClosed: true,
    composes: []
  },
  XB: {
    meaning: "Account info disputed by consumer directly to furnisher under FCRA; investigation in progress",
    keyTrigger: "Must be REMOVED after investigation completes",
    disputeInProgress: true,
    statute: "FCRA",
    mustBeRemovedAfterInvestigation: true,
    composes: []
  },
  XC: {
    meaning: "FCRA direct dispute investigation completed — consumer disagrees",
    keyTrigger: "Used after investigation; consumer still disagrees",
    investigationComplete: true,
    consumerDisagrees: true,
    statute: "FCRA",
    composes: []
  },
  XD: {
    meaning: "Combination: XA + XB (closed at consumer request + disputed)",
    keyTrigger: "",
    disputeInProgress: true,
    statute: "FCRA",
    mustBeRemovedAfterInvestigation: true,
    requiresDateClosed: true,
    composes: ["XA", "XB"]
  },
  XE: {
    meaning: "Combination: XA + XC (closed at consumer request + investigation done, consumer disagrees)",
    keyTrigger: "",
    investigationComplete: true,
    consumerDisagrees: true,
    statute: "FCRA",
    requiresDateClosed: true,
    composes: ["XA", "XC"]
  },
  XF: {
    meaning: "Account in dispute under FCBA; investigation in progress",
    keyTrigger: "Must be REMOVED after investigation",
    disputeInProgress: true,
    statute: "FCBA",
    mustBeRemovedAfterInvestigation: true,
    composes: []
  },
  XG: {
    meaning: "FCBA dispute investigation completed — consumer disagrees",
    keyTrigger: "",
    investigationComplete: true,
    consumerDisagrees: true,
    statute: "FCBA",
    composes: []
  },
  XH: {
    meaning: "Account previously in dispute; furnisher has completed investigation",
    keyTrigger: "USE for FCRA direct, FDCPA, or FCBA disputes after completion",
    investigationComplete: true,
    consumerDisagrees: false,
    composes: []
  },
  XJ: {
    meaning: "Combination: XA + XF",
    keyTrigger: "",
    disputeInProgress: true,
    statute: "FCBA",
    mustBeRemovedAfterInvestigation: true,
    requiresDateClosed: true,
    composes: ["XA", "XF"]
  },
  XR: {
    meaning: "Removes the most recently reported Compliance Condition Code",
    keyTrigger: "Do NOT use as default",
    removesPrevious: true,
    notADefault: true,
    composes: []
  }
});

/** Codes that assert a dispute investigation is open. Satisfies M2-028; trips M2-029. */
export const DISPUTE_IN_PROGRESS_CODES = Object.freeze(
  Object.keys(COMPLIANCE_CODES).filter((c) => COMPLIANCE_CODES[c].disputeInProgress === true)
);

/** Codes that must come off once the investigation closes. */
export const REMOVE_AFTER_INVESTIGATION_CODES = Object.freeze(
  Object.keys(COMPLIANCE_CODES).filter((c) => COMPLIANCE_CODES[c].mustBeRemovedAfterInvestigation === true)
);

/** Codes that record the consumer still disagrees with the outcome. The correct
 *  end state where the consumer has not accepted a "verified" result. */
export const CONSUMER_DISAGREES_CODES = Object.freeze(
  Object.keys(COMPLIANCE_CODES).filter((c) => COMPLIANCE_CODES[c].consumerDisagrees === true)
);

/** Codes requiring Field 26 Date Closed to be populated. */
export const REQUIRE_DATE_CLOSED_CODES = Object.freeze(
  Object.keys(COMPLIANCE_CODES).filter((c) => COMPLIANCE_CODES[c].requiresDateClosed === true)
);

export function isComplianceCode(code) {
  return typeof code === "string" && Object.hasOwn(COMPLIANCE_CODES, code);
}

export function complianceCodeDef(code) {
  return isComplianceCode(code) ? COMPLIANCE_CODES[code] : null;
}
