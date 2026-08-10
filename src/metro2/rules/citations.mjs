// Statute and case-law citations, keyed by violation rule ID M2-001 … M2-038.
//
// WHY CITATIONS LIVE IN A TABLE AND NOT IN THE PROSE GENERATOR. A letter that
// cites the wrong subsection, or attributes a holding to the wrong circuit, is
// not a small error — it is the thing a bureau points at to justify a
// frivolous determination. So the citations are resolved deterministically
// before any language model sees the violation. The model writes the sentence;
// it never picks the authority.
//
// EVERY STRING IN THIS FILE COMES OUT OF THE KNOWLEDGE BASE. Sections 2 and 3
// are the only sources. Nothing is added from memory, and no case is cited for
// a proposition the knowledge base does not attach it to. If a rule has no
// case-law support in the knowledge base, its `caseLaw` array is empty — an
// empty array is an honest answer and an invented citation is not.
//
// Davenport is deliberately attached to every rule that rests on a Metro 2
// format defect alone. It is the case that cuts AGAINST us — Metro 2
// non-compliance standing alone is not actionable — and carrying it on the rule
// forces the letter to do what § 2.3 says it must: explain why the deviation
// makes the reporting inaccurate or materially misleading under § 1681e and
// § 1681s-2, rather than resting on the format breach.

/** The accuracy-standard cases, § 2.1. */
export const CASES = Object.freeze({
  SESSA: "Sessa v. Trans Union, LLC, 74 F.4th 38 (2d Cir. 2023)",
  MADER: "Mader v. Experian Information Solutions, 56 F.4th 264 (2d Cir. 2022)",
  SEAMANS: "Seamans v. Temple University, 744 F.3d 853 (3d Cir. 2014)",
  SAUNDERS: "Saunders v. Branch Banking & Trust Co., 526 F.3d 142 (4th Cir. 2008)",
  GORMAN: "Gorman v. Wolpoff & Abramson, LLP, 584 F.3d 1147 (9th Cir. 2009)",
  BOGGIO: "Boggio v. USAA Federal Savings Bank, 696 F.3d 611 (6th Cir. 2012)",
  FRAZIER: "Frazier v. Dovenmuehle Mortgage, Inc., 72 F.4th 813 (7th Cir. 2023)",
  JOHNSON_MBNA: "Johnson v. MBNA America Bank, 357 F.3d 426 (4th Cir. 2004)",
  HINKLE: "Hinkle v. Midland Credit Management, Inc., 827 F.3d 1295 (11th Cir. 2016)",
  DAVENPORT: "Davenport v. Capio Partners, LLC (M.D. Pa. 2021)",
  XB_XH_XC: "The XB/XH/XC cases (Fulton, Wood, Matson)",
  BIBBS: "Bibbs v. Trans Union LLC, 43 F.4th 331 (3d Cir. 2022)",
  PITTMAN: "Pittman v. Experian Information Solutions, 901 F.3d 619 (6th Cir. 2018)"
});

/** Statutory and regulatory hooks, § 3. */
export const STATUTES = Object.freeze({
  FCRA_1681B: "FCRA § 1681b (permissible purposes)",
  FCRA_1681C_A: "FCRA § 1681c(a) (7-year reporting limit)",
  FCRA_1681C_C: "FCRA § 1681c(c) (7 years + 180 days from DOFD)",
  FCRA_1681C_2: "FCRA § 1681c-2 (identity theft block)",
  FCRA_1681E_B: "FCRA § 1681e(b) (maximum possible accuracy)",
  FCRA_1681I_A1: "FCRA § 1681i(a)(1) (30-day reinvestigation)",
  FCRA_1681I_A5A: "FCRA § 1681i(a)(5)(A) (delete what cannot be verified)",
  FCRA_1681M: "FCRA § 1681m (adverse action notice)",
  FCRA_1681S2_A1A: "FCRA § 1681s-2(a)(1)(A) (no furnishing known-inaccurate information)",
  FCRA_1681S2_A2: "FCRA § 1681s-2(a)(2) (duty to correct and update)",
  FCRA_1681S2_A3: "FCRA § 1681s-2(a)(3) (duty to note a dispute)",
  FCRA_1681S2_A5: "FCRA § 1681s-2(a)(5) (report the same DOFD as the original creditor)",
  FCRA_1681S2_B: "FCRA § 1681s-2(b) (furnisher investigation duty)",
  FDCPA_1692E: "FDCPA § 1692e (false or misleading representations)",
  FDCPA_1692E8: "FDCPA § 1692e(8) (failure to communicate that a debt is disputed)",
  FDCPA_1692G: "FDCPA § 1692g (debt validation)",
  REG_V_1022_42: "12 CFR 1022.42 (accuracy and integrity)",
  REG_V_1022_43: "12 CFR 1022.43 (direct disputes)",
  BANKRUPTCY_524: "Bankruptcy Code § 524 (discharge injunction)",
  MEDICAL_DEBT_POLICY: "CDIA/CRA medical debt policy (1-year wait, $500 minimum)"
});

const S = STATUTES;
const C = CASES;

/**
 * ruleId → { statutes, caseLaw, metro2Ref }.
 *
 * `metro2Ref` is the exhibit or section a letter should name when it describes
 * the format defect, and it is what lands in the violation's `metro2Ref` field.
 */
export const RULE_CITATIONS = Object.freeze({
  // ── § 5.1 Universal ──────────────────────────────────────────────────────
  "M2-001": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SESSA, C.MADER],
    metro2Ref: "Field 7 — Consumer Account Number, § 1.3"
  },
  "M2-002": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SESSA, C.BOGGIO],
    metro2Ref: "Field 10 — Date Opened, § 1.3"
  },
  "M2-003": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.SEAMANS, C.DAVENPORT],
    metro2Ref: "Field 8 — Portfolio Type, § 1.3"
  },
  "M2-004": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.SEAMANS, C.DAVENPORT],
    metro2Ref: "Field 9 — Account Type (Exhibit 1), § 1.3"
  },
  "M2-005": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A2],
    caseLaw: [C.DAVENPORT],
    metro2Ref: "Field 24 — Date of Account Information, § 1.7"
  },
  "M2-006": {
    statutes: [S.FCRA_1681S2_A5, S.FCRA_1681C_C, S.FCRA_1681E_B],
    caseLaw: [C.SESSA],
    metro2Ref: "Field 25 — Date of First Delinquency, § 1.6"
  },
  "M2-007": {
    statutes: [S.FCRA_1681C_A, S.FCRA_1681C_C, S.FCRA_1681I_A5A],
    caseLaw: [],
    metro2Ref: "Field 25 — Date of First Delinquency, § 1.6"
  },
  "M2-008": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SESSA],
    metro2Ref: "Exhibit 10 — ECOA Code (Field 37), § 1.10"
  },
  "M2-009": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A, S.BANKRUPTCY_524],
    caseLaw: [C.SEAMANS],
    metro2Ref: "Exhibit 11 — Consumer Information Indicator (Field 38), § 1.11"
  },
  "M2-010": {
    statutes: [S.FCRA_1681S2_A3, S.FCRA_1681E_B],
    caseLaw: [C.SAUNDERS, C.GORMAN],
    metro2Ref: "Exhibit 8 — Compliance Condition Code (Field 20), § 1.9"
  },

  // ── § 5.2 Status code consistency ────────────────────────────────────────
  "M2-011": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SESSA, C.BOGGIO, C.DAVENPORT],
    metro2Ref: "Exhibit 4 — Account Status (Field 17A) required balance, § 1.4"
  },
  "M2-012": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SESSA, C.BOGGIO, C.DAVENPORT],
    metro2Ref: "Exhibit 4 — Account Status (Field 17A) vs Field 22, § 1.4"
  },
  "M2-013": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.DAVENPORT, C.SEAMANS],
    metro2Ref: "Field 17B — Payment Rating, § 1.5"
  },
  "M2-014": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SEAMANS, C.BOGGIO],
    metro2Ref: "Field 18 — Payment History Profile, § 1.5"
  },
  "M2-015": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.DAVENPORT],
    metro2Ref: "Exhibit 4 — prohibited sequence 97 after 89 or 94, § 1.4"
  },
  "M2-016": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.SEAMANS, C.DAVENPORT],
    metro2Ref: "Exhibit 7 — Special Comment Code (Field 19), § 1.8"
  },
  "M2-017": {
    statutes: [S.FCRA_1681E_B, S.FDCPA_1692E],
    caseLaw: [C.DAVENPORT],
    metro2Ref: "Exhibit 4 — collectors limited to 62, 93, DA, DF, § 1.4 and § 1.13"
  },

  // ── § 5.3 Charge-off and collection ──────────────────────────────────────
  "M2-018": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_B],
    caseLaw: [C.SAUNDERS],
    metro2Ref: "Exhibit 4 Status 97 with K2 Sold To, § 1.4 and § 1.12"
  },
  "M2-019": {
    statutes: [S.FCRA_1681E_B, S.FDCPA_1692G, S.FDCPA_1692E],
    caseLaw: [C.HINKLE],
    metro2Ref: "K1 Segment — Original Creditor Name, § 1.12"
  },
  "M2-020": {
    statutes: [S.FCRA_1681E_B],
    caseLaw: [C.DAVENPORT],
    metro2Ref: "Field 23 — Original Charge-off Amount, § 1.3"
  },
  "M2-021": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SAUNDERS, C.BOGGIO],
    metro2Ref: "K2 Segment — Purchased From / Sold To, § 1.12"
  },
  "M2-022": {
    statutes: [S.FCRA_1681C_A, S.MEDICAL_DEBT_POLICY],
    caseLaw: [],
    metro2Ref: "§ 1.13 — medical debt: exclude under $500"
  },
  "M2-023": {
    statutes: [S.FCRA_1681C_A, S.MEDICAL_DEBT_POLICY],
    caseLaw: [],
    metro2Ref: "§ 1.13 — medical debt: wait ≥ 365 days from DOFD"
  },

  // ── § 5.4 Bankruptcy ─────────────────────────────────────────────────────
  "M2-024": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [C.SEAMANS],
    metro2Ref: "Exhibit 11 — CII E/F/G/H required post-discharge, § 1.11"
  },
  "M2-025": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A, S.BANKRUPTCY_524],
    caseLaw: [C.SESSA, C.BOGGIO],
    metro2Ref: "Exhibit 11 — discharged CII with Field 21 balance, § 1.11"
  },
  "M2-026": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A],
    caseLaw: [],
    metro2Ref: "Exhibit 10 — ECOA Code Z on an authorized user in bankruptcy, § 1.10"
  },
  "M2-027": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A1A, S.BANKRUPTCY_524],
    caseLaw: [C.SESSA],
    metro2Ref: "Exhibit 4 with Exhibit 11 — discharged accounts report status 13, § 1.11 and § 4.3"
  },

  // ── § 5.5 Dispute status ─────────────────────────────────────────────────
  "M2-028": {
    statutes: [S.FCRA_1681S2_A3, S.FDCPA_1692E8, S.REG_V_1022_43],
    caseLaw: [C.SAUNDERS, C.GORMAN],
    metro2Ref: "Exhibit 8 — XB during investigation, § 1.9"
  },
  "M2-029": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A2],
    caseLaw: [C.SAUNDERS],
    metro2Ref: "Exhibit 8 — XB must be removed after investigation, § 1.9"
  },
  "M2-030": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681S2_A3],
    caseLaw: [C.XB_XH_XC, C.SAUNDERS, C.GORMAN],
    metro2Ref: "Exhibit 8 — XC, not XH, where the consumer disagrees, § 1.9"
  },

  // ── § 5.6 Personal information ───────────────────────────────────────────
  "M2-031": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681I_A1],
    caseLaw: [],
    metro2Ref: "§ 4.3 — personal information errors (old addresses)"
  },
  "M2-032": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681I_A1],
    caseLaw: [],
    metro2Ref: "Field 33 — Surname/First/Middle, § 1.3"
  },
  "M2-033": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681I_A1],
    caseLaw: [],
    metro2Ref: "§ 4.3 — personal information errors (date of birth)"
  },
  "M2-034": {
    statutes: [S.FCRA_1681E_B, S.FCRA_1681I_A1],
    caseLaw: [],
    metro2Ref: "N1 Segment — employment information, § 1.2"
  },

  // ── § 5.7 Inquiries ──────────────────────────────────────────────────────
  "M2-035": {
    statutes: [S.FCRA_1681B, S.FCRA_1681M],
    caseLaw: [],
    metro2Ref: "§ 4.3 — hard inquiry without permissible purpose"
  },
  "M2-036": {
    statutes: [S.FCRA_1681B, S.FCRA_1681E_B],
    caseLaw: [],
    metro2Ref: "§ 4.3 — duplicate same-day inquiries"
  },
  "M2-037": {
    statutes: [S.FCRA_1681B, S.FCRA_1681C_2],
    caseLaw: [],
    metro2Ref: "§ 4.3 — inquiry from an unrecognised entity"
  },
  "M2-038": {
    statutes: [S.FCRA_1681B, S.FCRA_1681C_A],
    caseLaw: [],
    metro2Ref: "§ 4.3 — hard inquiry older than two years"
  }
});

/** M2-001 … M2-038, in order. */
export const RULE_IDS = Object.freeze(Object.keys(RULE_CITATIONS));

/**
 * Flat citation list for a rule, statutes first then case law — the order a
 * letter argues in: the duty, then the authority construing it.
 * Unknown rule → empty array, never a throw: a missing citation must not take
 * down a whole report's analysis.
 */
export function citationsFor(ruleId) {
  const entry = RULE_CITATIONS[ruleId];
  return entry ? Object.freeze([...entry.statutes, ...entry.caseLaw]) : Object.freeze([]);
}

/** The Metro 2 exhibit/section reference for a rule, or null. */
export function metro2RefFor(ruleId) {
  return RULE_CITATIONS[ruleId]?.metro2Ref ?? null;
}
