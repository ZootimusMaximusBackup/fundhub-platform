// Exhibit 7 — Special Comment Codes (Field 19). Knowledge base § 1.8.
//
// Field 19 is a narrative code reported every month for as long as its
// condition holds. Several codes are only valid alongside particular Account
// Status values, and that pairing is the whole of check M2-016: a code claiming
// "paid in full for less than the full balance" (AU) on an account still
// reported as a charge-off is internally contradictory, and a contradiction is
// evidence of inaccuracy.
//
// SELECTED, NOT COMPLETE. The knowledge base heading itself says
// "EXHIBIT 7 (Selected)" — the real exhibit is longer. So an unrecognised
// Field 19 value is NOT treated as an invalid code: it may simply be a code the
// knowledge base does not reproduce. Checks fire on a code we know AND whose
// stated condition is contradicted — never on a code we do not know.
//
// Constraint vocabulary, all quoted from § 1.8's "Required Conditions" column:
//   requiresStatusIn      Field 17A must be one of these.
//   requiresStatusNotIn   Field 17A must not be one of these.
//   requiresBalanceZero   Field 21 must be $0.
//   requiresBalanceNonZero Field 21 must not be $0.
//   requiresPastDueZero   Field 22 must be $0.
//   requiresEcoa          Field 37 must be this code.
//   requiresDateClosed    Field 26 must be populated.

/** The "Status 13 or 61–65" set that § 1.8 refers to repeatedly. */
export const PAID_OR_CLOSED_STATUSES = Object.freeze(["13", "61", "62", "63", "64", "65"]);

export const SPECIAL_COMMENTS = Object.freeze({
  B: { meaning: "Payments managed by financial counseling", conditionText: "" },
  C: {
    meaning: "Paid by co-maker/guarantor",
    conditionText: "Status 13 or 61–65, balance = 0",
    requiresStatusIn: PAID_OR_CLOSED_STATUSES,
    requiresBalanceZero: true
  },
  H: {
    meaning: "Loan assumed by another party",
    conditionText: "ECOA Code T",
    requiresEcoa: "T"
  },
  M: {
    meaning: "Account closed at credit grantor's request",
    conditionText: "Requires Date Closed",
    requiresDateClosed: true
  },
  O: { meaning: "Account transferred to another company/servicer", conditionText: "" },
  AB: {
    meaning: "Debt being paid through insurance",
    conditionText: "Status NOT 13 or 61–65",
    requiresStatusNotIn: PAID_OR_CLOSED_STATUSES
  },
  AC: {
    meaning: "Paying under partial payment agreement",
    conditionText: "Status NOT 13 or 61–65",
    requiresStatusNotIn: PAID_OR_CLOSED_STATUSES
  },
  AH: { meaning: "Purchased by another company", conditionText: "", indicatesSale: true },
  AS: { meaning: "Account closed due to refinance", conditionText: "" },
  AT: { meaning: "Account closed due to transfer (internal)", conditionText: "" },
  AU: {
    meaning: "Account paid in full for less than full balance",
    conditionText: "Status 13 or 61–65, balance = 0",
    requiresStatusIn: PAID_OR_CLOSED_STATUSES,
    requiresBalanceZero: true
  },
  AV: { meaning: "First payment never received", conditionText: "" },
  AW: { meaning: "Affected by natural or declared disaster", conditionText: "" },
  BO: { meaning: "Foreclosure proceedings started", conditionText: "" },
  BP: {
    meaning: "Paid through insurance",
    conditionText: "Status 13 or 61–65, balance = 0",
    requiresStatusIn: PAID_OR_CLOSED_STATUSES,
    requiresBalanceZero: true
  },
  CI: { meaning: "Account closed due to inactivity", conditionText: "" },
  CN: { meaning: "Loan modified under federal government plan", conditionText: "" },
  CO: { meaning: "Loan modified (non-federal)", conditionText: "" },
  CP: {
    meaning: "Account in forbearance",
    conditionText: "Status NOT 13 or 61–65, balance NOT 0",
    requiresStatusNotIn: PAID_OR_CLOSED_STATUSES,
    requiresBalanceNonZero: true
  },
  DE: {
    meaning: "Debt extinguished under state law",
    conditionText: "Status NOT 13 or 61–65, balance = 0, past due = 0",
    requiresStatusNotIn: PAID_OR_CLOSED_STATUSES,
    requiresBalanceZero: true,
    requiresPastDueZero: true
  }
});

/**
 * Codes the knowledge base names in prose but does not define in its Exhibit 7
 * excerpt. Recorded so the gap is visible rather than guessed at, and so no
 * check treats one of them as an unknown-code finding.
 *
 * A furnisher reporting one of these is not thereby in violation — we simply
 * have no condition text to test it against. Filling these in requires the
 * CRRG itself, which is not in this repo.
 */
export const CODES_REFERENCED_WITHOUT_DEFINITION = Object.freeze({
  BA: "§ 1.4 — offered as a replacement for obsolete Status 05",
  AO: "§ 4.3 — repossession comment",
  AZ: "§ 4.3 — repossession comment",
  BI: "§ 4.3 — repossession comment",
  BJ: "§ 4.3 — repossession comment",
  BK: "§ 4.3 — repossession comment",
  CS: "§ 1.13 — the only permitted comment on child support",
  AL: "§ 1.13 — student loan deferment/forbearance, now obsolete"
});

/** Codes whose presence asserts the account changed hands. Used by M2-018. */
export const SALE_INDICATING_COMMENTS = Object.freeze(
  Object.keys(SPECIAL_COMMENTS).filter((c) => SPECIAL_COMMENTS[c].indicatesSale === true)
);

/** Codes carrying a testable condition. The only codes M2-016 can fire on. */
export const CONSTRAINED_COMMENTS = Object.freeze(
  Object.keys(SPECIAL_COMMENTS).filter((c) => SPECIAL_COMMENTS[c].conditionText !== "")
);

export function isSpecialComment(code) {
  return typeof code === "string" && Object.hasOwn(SPECIAL_COMMENTS, code);
}

export function specialCommentDef(code) {
  return isSpecialComment(code) ? SPECIAL_COMMENTS[code] : null;
}
