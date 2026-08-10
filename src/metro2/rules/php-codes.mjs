// Payment History Profile (Field 18) — knowledge base § 1.5.
//
// 24 characters, one per month, LEFT-TO-RIGHT NEWEST-TO-OLDEST. That direction
// matters: read it backwards and every date-anchored conclusion inverts, so a
// charge-off two years ago reads as a charge-off last month. Index 0 is the
// month of Field 24 (Date of Account Information); index n is n months before.
//
// The alphabet is fifteen characters and no others. A consumer-report vendor's
// "payment pattern" string uses a different alphabet and a different length
// (see docs/metro2/CRS-FIELD-COVERAGE.md), which is why Field 18 is
// `not_visible` on a CRS pull rather than translated.

export const PHP_LENGTH = 24;

/** Index 0 is the newest month. Quoted for the agreement test. */
export const PHP_DIRECTION = "left-to-right newest-to-oldest";

export const PHP_CODES = Object.freeze({
  "0": { meaning: "Current", late: false },
  "1": { meaning: "30–59 days past due", late: true },
  "2": { meaning: "60–89 days past due", late: true },
  "3": { meaning: "90–119 days past due", late: true },
  "4": { meaning: "120–149 days past due", late: true },
  "5": { meaning: "150–179 days past due", late: true },
  "6": { meaning: "180+ days past due", late: true },
  B: { meaning: "No data", late: false, noData: true },
  D: { meaning: "No data / paid", late: false, noData: true },
  E: { meaning: "Zero balance / current", late: false },
  G: { meaning: "Collection", late: false, derogatory: true },
  H: { meaning: "Foreclosure", late: false, derogatory: true },
  J: { meaning: "Voluntary surrender", late: false, derogatory: true },
  K: { meaning: "Repossession", late: false, derogatory: true },
  L: { meaning: "Charge-off", late: false, derogatory: true }
});

/** Delinquency tiers 1–6. A late code here beside Account Status 11 is M2-014. */
export const PHP_LATE_CODES = Object.freeze(
  Object.keys(PHP_CODES).filter((c) => PHP_CODES[c].late === true)
);

/** Codes that assert a derogatory event happened in that month. */
export const PHP_DEROGATORY_CODES = Object.freeze(
  Object.keys(PHP_CODES).filter((c) => PHP_CODES[c].derogatory === true)
);

export function isPhpCode(code) {
  return typeof code === "string" && code.length === 1 && Object.hasOwn(PHP_CODES, code);
}

/**
 * Split a profile string into an array of single characters.
 * Returns null for a non-string. Does NOT reject a wrong length or an unknown
 * character — those are findings for a check to report, not parse errors to
 * swallow here.
 */
export function phpChars(profile) {
  return typeof profile === "string" ? [...profile.trim().toUpperCase()] : null;
}

/** Positions (0 = newest month) holding a late code 1–6. */
export function latePositions(profile) {
  const chars = phpChars(profile);
  if (!chars) return [];
  return chars.map((c, i) => (PHP_LATE_CODES.includes(c) ? i : -1)).filter((i) => i >= 0);
}

/** Positions holding one of the derogatory event codes. */
export function derogatoryPositions(profile, codes = PHP_DEROGATORY_CODES) {
  const chars = phpChars(profile);
  if (!chars) return [];
  return chars.map((c, i) => (codes.includes(c) ? i : -1)).filter((i) => i >= 0);
}
