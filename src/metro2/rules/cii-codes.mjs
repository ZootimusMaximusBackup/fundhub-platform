// Exhibit 11 — Consumer Information Indicator (Field 38). Knowledge base § 1.11.
//
// Field 38 is the bankruptcy flag, recorded per consumer rather than per
// account. It carries the two facts the rest of the bankruptcy checks turn on:
// whether a petition was filed (A–D) and whether the debt was discharged
// (E–H).
//
// A discharged debt still showing a balance is the strongest single finding in
// this engine. It is both an FCRA accuracy violation and, per § 1.11, a
// potential violation of the Bankruptcy Code § 524 discharge injunction — the
// court order that says the debt no longer exists. That is why M2-025 sits in
// the deletion tier.
//
// NOTE THE TWO-CHARACTER CODES. 1A (Personal Receivership) and 2A (Lease
// Assumption) are two characters wide while every other code is one. Any parser
// that assumes a single character silently drops them.

export const CII_CODES = Object.freeze({
  A: { meaning: "Petition for Chapter 7 Bankruptcy", bankruptcy: true, petition: true, discharged: false, chapter: "7" },
  B: { meaning: "Petition for Chapter 11 Bankruptcy", bankruptcy: true, petition: true, discharged: false, chapter: "11" },
  C: { meaning: "Petition for Chapter 12 Bankruptcy", bankruptcy: true, petition: true, discharged: false, chapter: "12" },
  D: { meaning: "Petition for Chapter 13 Bankruptcy", bankruptcy: true, petition: true, discharged: false, chapter: "13" },
  E: { meaning: "Discharged through Chapter 7", bankruptcy: true, petition: false, discharged: true, chapter: "7" },
  F: { meaning: "Discharged through Chapter 11", bankruptcy: true, petition: false, discharged: true, chapter: "11" },
  G: { meaning: "Discharged through Chapter 12", bankruptcy: true, petition: false, discharged: true, chapter: "12" },
  H: { meaning: "Discharged/completed through Chapter 13", bankruptcy: true, petition: false, discharged: true, chapter: "13" },
  Q: {
    meaning: "Removes previously-reported bankruptcy indicator; also used for BK closed/terminated without discharge",
    bankruptcy: false,
    removesBankruptcy: true,
    discharged: false
  },
  R: { meaning: "Chapter 7 Reaffirmation of Debt", bankruptcy: true, reaffirmation: true, discharged: false, chapter: "7" },
  V: { meaning: "Chapter 7 Reaffirmation of Debt Rescinded", bankruptcy: true, reaffirmation: false, discharged: false, chapter: "7" },
  "1A": { meaning: "Personal Receivership", bankruptcy: false, discharged: false },
  "2A": { meaning: "Lease Assumption", bankruptcy: false, discharged: false },
  T: { meaning: "Credit grantor cannot locate consumer", bankruptcy: false, discharged: false },
  U: { meaning: "Consumer now located (removes T)", bankruptcy: false, discharged: false, removes: "T" }
});

/** Petition filed, no discharge yet. */
export const CII_PETITION_CODES = Object.freeze(
  Object.keys(CII_CODES).filter((c) => CII_CODES[c].petition === true)
);

/**
 * Debt discharged or completed. § 5.4's check 24 asks for exactly this set on a
 * bankruptcy-included account, and M2-025 fires when one of these coexists with
 * a balance.
 */
export const CII_DISCHARGED_CODES = Object.freeze(
  Object.keys(CII_CODES).filter((c) => CII_CODES[c].discharged === true)
);

/** Any code asserting a bankruptcy touched this account. */
export const CII_BANKRUPTCY_CODES = Object.freeze(
  Object.keys(CII_CODES).filter((c) => CII_CODES[c].bankruptcy === true)
);

/** Bankruptcy chapter → the CII code that records its discharge. */
export const CHAPTER_TO_DISCHARGED_CII = Object.freeze({ "7": "E", "11": "F", "12": "G", "13": "H" });

/** Bankruptcy chapter → the CII code that records its petition. */
export const CHAPTER_TO_PETITION_CII = Object.freeze({ "7": "A", "11": "B", "12": "C", "13": "D" });

export function isCiiCode(code) {
  return typeof code === "string" && Object.hasOwn(CII_CODES, code);
}

export function ciiDef(code) {
  return isCiiCode(code) ? CII_CODES[code] : null;
}

export function isDischargedCii(code) {
  return CII_DISCHARGED_CODES.includes(code);
}
