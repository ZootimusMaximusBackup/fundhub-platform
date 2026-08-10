// Exhibit 4 — Account Status Codes (Field 17A).
//
// Machine form of knowledge base § 1.4. The `.md` is the human source of
// truth; this is its code form, and rules/agreement.test.mjs fails if the two
// drift apart.
//
// Field 17A is the most-disputed field in a credit report, and most of the
// Section 5 checks resolve to a lookup in this table plus one comparison. The
// constraints are kept as data rather than as branches inside the checks so a
// new CRRG edition is a table edit, not a rewrite.
//
// ── TWO PLACES THE KNOWLEDGE BASE CONTRADICTS ITSELF ──────────────────────
//
// Recorded here, not resolved silently. Both are reported as OPEN findings.
//
// (1) Payment Rating (17B) requirement for statuses 71–84.
//     Exhibit 4's Notes column says 71, 78, 80, 82, 83 and 84 each "Requires
//     Payment Rating (17B)". Section 1.5 says 17B is "Required when Account
//     Status Code is 05, 13, 61–65, or 88–97" — which excludes 71–84.
//     Both readings are recorded: `requiresPaymentRating` follows § 1.5,
//     `exhibit4NotesRequirePaymentRating` follows the Exhibit 4 notes. Check
//     M2-013 uses the narrower § 1.5 set, because firing on the wider one
//     would risk a violation claim the knowledge base itself undercuts.
//
// (2) Status 11's required balance.
//     Exhibit 4 says "Non-zero (installment/mortgage)". Section 5.2's check 11
//     trigger names only "Status 13/61-65 with non-zero balance". So the
//     zero-balance-on-status-11 case is recorded in the table
//     (`requiredBalance: "nonzero"`, scoped by `requiredBalanceAppliesTo`) and
//     deliberately NOT enforced by M2-011: a revolving line at $0 is normal,
//     and the knowledge base's own check does not ask for it.
//
// requiredBalance vocabulary:
//   "zero"      Current Balance must be $0.
//   "nonzero"   Balance expected — scoped by requiredBalanceAppliesTo.
//   "exists"    Balance exists (collections).
//   "may-exist" Balance permitted, not required.
//   "n/a"       Deletion instruction; balance is not meaningful.
//
// pastDueSource records WHERE the past-due constraint comes from:
//   "kb-explicit" § 1.4 or § 5.2 names this status by number.
//   "implied"     Derived from the status meaning plus its $0 balance
//                 requirement (a paid-in-full account cannot owe arrears).
//                 Enforced, but the violation reason says so.

export const STATUS_CODES = Object.freeze({
  "05": {
    meaning: "Account transferred to another office",
    requiredBalance: "zero",
    final: false,
    obsolete: true,
    obsoleteSince: "2022-04",
    replacedBy: ["O", "AH", "AT", "BA"],
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "OBSOLETE as of April 2022 — use Special Comment Codes O, AH, AT, or BA instead"
  },
  "11": {
    meaning: "Current account (0–29 days past due)",
    requiredBalance: "nonzero",
    requiredBalanceAppliesTo: ["I", "M"],
    requiredBalanceEnforced: false,
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "kb-explicit",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "For closed lines with balance, also report Special Comment Code M or CCC XA"
  },
  "13": {
    meaning: "Paid or closed / zero balance",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "kb-explicit",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "Final status, no further updates needed"
  },
  "61": {
    meaning: "Paid in full, was voluntary surrender",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "Final"
  },
  "62": {
    meaning: "Paid in full, was collection",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: true,
    notes: "Final"
  },
  "63": {
    meaning: "Paid in full, was repossession",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "Final"
  },
  "64": {
    meaning: "Paid in full, was charge-off",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: false,
    chargeOffAmountPermitted: true,
    notes: "Final"
  },
  "65": {
    meaning: "Paid in full, foreclosure was started",
    requiredBalance: "zero",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: true,
    pastDueSource: "implied",
    showsDelinquency: false,
    collectionPermitted: false,
    notes: "Final"
  },
  "71": {
    meaning: "30–59 days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "78": {
    meaning: "60–89 days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "80": {
    meaning: "90–119 days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "82": {
    meaning: "120–149 days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "83": {
    meaning: "150–179 days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "84": {
    meaning: "180+ days past due",
    requiredBalance: "may-exist",
    requiredPastDue: "positive",
    final: false,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: true,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Requires Payment Rating (17B) per Exhibit 4 notes"
  },
  "88": {
    meaning: "Claim filed with government (defaulted loan)",
    requiredBalance: "may-exist",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Final"
  },
  "89": {
    meaning: "Deed in lieu of foreclosure (defaulted mortgage)",
    requiredBalance: "may-exist",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    prohibitsSubsequent: ["97"],
    notes: "Final; do NOT report 97 after 89"
  },
  "93": {
    meaning: "Account assigned to internal or external collections",
    requiredBalance: "exists",
    final: false,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: true,
    notes: "Third-party collection agencies may ONLY use 62, 93, DA, or DF"
  },
  "94": {
    meaning: "Foreclosure completed",
    requiredBalance: "may-exist",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    prohibitsSubsequent: ["97"],
    notes: "Final; do NOT report 97 after 94"
  },
  "95": {
    meaning: "Voluntary surrender",
    requiredBalance: "may-exist",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: "Final; do NOT use for lease early termination"
  },
  "96": {
    meaning: "Merchandise repossessed",
    requiredBalance: "may-exist",
    final: false,
    obsolete: false,
    requiresPaymentRating: true,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    notes: ""
  },
  "97": {
    meaning: "Unpaid balance reported as loss (charge-off)",
    requiredBalance: "may-exist",
    final: true,
    obsolete: false,
    requiresPaymentRating: true,
    requiredPaymentRating: "L",
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: true,
    collectionPermitted: false,
    chargeOffAmountRequired: true,
    notes: "Final"
  },
  DA: {
    meaning: "Delete entire account (non-fraud)",
    requiredBalance: "n/a",
    final: true,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: false,
    collectionPermitted: true,
    deletionInstruction: true,
    notes: "Paid derogatory accounts should be reported as paid, NOT deleted"
  },
  DF: {
    meaning: "Delete entire account — confirmed fraud",
    requiredBalance: "n/a",
    final: true,
    obsolete: false,
    requiresPaymentRating: false,
    exhibit4NotesRequirePaymentRating: false,
    pastDueMustBeZero: false,
    showsDelinquency: false,
    collectionPermitted: true,
    deletionInstruction: true,
    notes: "After completed fraud investigation"
  }
});

/**
 * The only statuses a third-party collection agency or debt buyer may report
 * (§ 1.4 and § 1.13). Anything else from a collector is check M2-017.
 */
export const THIRD_PARTY_COLLECTOR_STATUSES = Object.freeze(["62", "93", "DA", "DF"]);

/** Statuses whose Current Balance must be $0. Drives M2-011. */
export const ZERO_BALANCE_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].requiredBalance === "zero")
);

/** Statuses whose Amount Past Due must be $0. Drives M2-012. */
export const ZERO_PAST_DUE_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].pastDueMustBeZero === true)
);

/** Statuses that require a positive Amount Past Due (Exhibit 4). Drives M2-012's second arm. */
export const POSITIVE_PAST_DUE_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].requiredPastDue === "positive")
);

/** Statuses that require Payment Rating (17B), on § 1.5's reading. Drives M2-013. */
export const PAYMENT_RATING_REQUIRED_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].requiresPaymentRating === true)
);

/** Statuses that represent delinquency or a derogatory final outcome. Drives M2-027. */
export const DELINQUENT_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].showsDelinquency === true)
);

/**
 * status → statuses that may not be reported after it (§ 1.4: "Reporting
 * status 97 after 89 or 94 = prohibited by CRRG"). Drives M2-015.
 */
export const PROHIBITED_STATUS_SEQUENCES = Object.freeze(
  Object.fromEntries(
    Object.entries(STATUS_CODES)
      .filter(([, def]) => Array.isArray(def.prohibitsSubsequent))
      .map(([code, def]) => [code, Object.freeze([...def.prohibitsSubsequent])])
  )
);

/** Statuses withdrawn by the CDIA but still seen in the wild. */
export const OBSOLETE_STATUSES = Object.freeze(
  Object.keys(STATUS_CODES).filter((c) => STATUS_CODES[c].obsolete === true)
);

/** Portfolio Type codes (Field 8) — § 1.3. */
export const PORTFOLIO_TYPES = Object.freeze({
  C: "Line of Credit",
  I: "Installment",
  M: "Mortgage",
  O: "Open",
  R: "Revolving"
});

export function isStatusCode(code) {
  return typeof code === "string" && Object.hasOwn(STATUS_CODES, code);
}

export function statusDef(code) {
  return isStatusCode(code) ? STATUS_CODES[code] : null;
}
