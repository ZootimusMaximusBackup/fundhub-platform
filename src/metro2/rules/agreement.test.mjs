// The rule tables must agree with the knowledge base document.
//
// WHAT THIS SUITE IS FOR. docs/metro2/METRO2_MASTER_KNOWLEDGE_BASE.md is the
// human source of truth and agents do not edit it. The .mjs files in this
// directory are its machine form. Two documents saying different things about
// which Account Status codes exist is the kind of drift nobody notices until a
// letter cites a code the CDIA withdrew — so the code form is checked against
// the document form on every run, in BOTH directions:
//
//   forward   every code in the table appears in the document's exhibit
//   reverse   every code in the document's exhibit appears in the table
//
// The reverse direction is the one that catches a real edition change. Adding
// a code to the document and forgetting the table would otherwise be silent,
// and the engine would go blind to it.
//
// The document is a text extraction from a PDF, so its tables are line-wrapped
// mid-cell. Each exhibit row nonetheless starts with its code at the beginning
// of a line, which is what the row scanner below relies on.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { KB_VERSION, KB_PATH, KB_STAMP, KB_DATE } from "../version.mjs";
import {
  STATUS_CODES,
  THIRD_PARTY_COLLECTOR_STATUSES,
  ZERO_BALANCE_STATUSES,
  PROHIBITED_STATUS_SEQUENCES,
  OBSOLETE_STATUSES,
  PORTFOLIO_TYPES
} from "./status-codes.mjs";
import { PAYMENT_RATINGS, PAYMENT_RATING_REQUIRED_TEXT } from "./payment-ratings.mjs";
import { PHP_CODES, PHP_LENGTH, PHP_DIRECTION, PHP_LATE_CODES } from "./php-codes.mjs";
import { SPECIAL_COMMENTS, PAID_OR_CLOSED_STATUSES } from "./special-comments.mjs";
import { COMPLIANCE_CODES, DISPUTE_IN_PROGRESS_CODES, CONSUMER_DISAGREES_CODES } from "./compliance-codes.mjs";
import { ECOA_CODES, OBSOLETE_ECOA_CODES, ECOA_OBSOLETE_SINCE } from "./ecoa-codes.mjs";
import { CII_CODES, CII_DISCHARGED_CODES, CII_PETITION_CODES } from "./cii-codes.mjs";
import { CASES, RULE_IDS, RULE_CITATIONS, citationsFor, metro2RefFor } from "./citations.mjs";

const KB = readFileSync(
  fileURLToPath(new URL("../../../" + KB_PATH, import.meta.url)),
  "utf8"
);

/** The document's own text between two markers. Throws loudly if a marker moved. */
function slice(startMarker, endMarker) {
  const from = KB.indexOf(startMarker);
  assert.ok(from >= 0, `knowledge base marker not found: ${startMarker}`);
  const to = KB.indexOf(endMarker, from + startMarker.length);
  assert.ok(to > from, `knowledge base marker not found after ${startMarker}: ${endMarker}`);
  return KB.slice(from, to);
}

/** Codes at the start of a line within an exhibit slice. */
function rowCodes(text, pattern) {
  const found = new Set();
  for (const line of text.split("\n")) {
    const m = pattern.exec(line);
    if (m) found.add(m[1]);
  }
  return found;
}

function assertSameCodes(label, tableCodes, documentCodes) {
  const inTableOnly = tableCodes.filter((c) => !documentCodes.has(c));
  const inDocOnly = [...documentCodes].filter((c) => !tableCodes.includes(c));
  assert.deepEqual(inTableOnly, [], `${label}: in the table but not in the knowledge base`);
  assert.deepEqual(inDocOnly, [], `${label}: in the knowledge base but not in the table`);
}

// ── Version stamp ──────────────────────────────────────────────────────────

test("version stamp matches the knowledge base document", () => {
  assert.match(KB, new RegExp(`Version:\\s*${KB_VERSION.replace(".", "\\.")}`));
  assert.equal(KB_STAMP, `METRO2_MASTER_KNOWLEDGE_BASE v${KB_VERSION} (${KB_DATE})`);
  assert.match(KB_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

// ── Exhibit 4 — Account Status (Field 17A) ─────────────────────────────────

const EXHIBIT_4 = slice("1.4 Account Status Codes (Field 17A) — EXHIBIT 4", "1.5 Payment Rating (Field 17B)");

test("Exhibit 4 status codes agree with the knowledge base, both directions", () => {
  // Rows 71–84 begin "71 30–59 days past due", so the character after the code
  // may be a digit as well as a letter.
  const documentCodes = rowCodes(EXHIBIT_4, /^(\d{2}|D[AF]) \S/);
  assertSameCodes("Exhibit 4", Object.keys(STATUS_CODES), documentCodes);
  assert.equal(Object.keys(STATUS_CODES).length, 23);
});

test("Exhibit 4 status meanings are quoted from the knowledge base", () => {
  // Spot-check the codes the checks lean on hardest. The document wraps table
  // cells mid-phrase, so each meaning is matched with whitespace made flexible.
  const spot = {
    "11": "Current account",
    "13": "Paid or closed",
    "62": "Paid in full, was",
    "93": "Account assigned to",
    "97": "Unpaid balance",
    DA: "Delete entire account",
    DF: "Delete entire account"
  };
  for (const [code, fragment] of Object.entries(spot)) {
    assert.ok(
      STATUS_CODES[code].meaning.includes(fragment),
      `status ${code} meaning should contain "${fragment}"`
    );
    assert.ok(
      EXHIBIT_4.replace(/\s+/g, " ").includes(fragment),
      `knowledge base Exhibit 4 should contain "${fragment}"`
    );
  }
});

test("required-balance constraints follow Exhibit 4", () => {
  // The document's "Required Balance" column reads $0 for 13 and 61–65.
  assert.deepEqual([...ZERO_BALANCE_STATUSES].sort(), ["05", "13", "61", "62", "63", "64", "65"]);
  const flat = EXHIBIT_4.replace(/\s+/g, " ");
  assert.ok(flat.includes("13 Paid or closed / zero balance $0"));
  assert.ok(flat.includes("Status 13 (paid/zero) with Amount Past Due > 0 = contradictory"));
  assert.ok(flat.includes("Status 97 (charge-off) with non-zero Current Balance"));
});

test("collector-only status list is the knowledge base's list", () => {
  assert.deepEqual(THIRD_PARTY_COLLECTOR_STATUSES, ["62", "93", "DA", "DF"]);
  assert.ok(KB.replace(/\s+/g, " ").includes("may ONLY use 62, 93, DA, or DF"));
  for (const code of THIRD_PARTY_COLLECTOR_STATUSES) {
    assert.equal(STATUS_CODES[code].collectionPermitted, true, `status ${code} must be collector-permitted`);
  }
});

test("prohibited status sequence 97-after-89/94 is recorded", () => {
  assert.deepEqual(PROHIBITED_STATUS_SEQUENCES, { 89: ["97"], 94: ["97"] });
  assert.ok(EXHIBIT_4.replace(/\s+/g, " ").includes("do NOT report 97 after 89"));
  assert.ok(EXHIBIT_4.replace(/\s+/g, " ").includes("do NOT report 97 after 94"));
});

test("obsolete status 05 is flagged, not deleted", () => {
  assert.deepEqual(OBSOLETE_STATUSES, ["05"]);
  assert.equal(STATUS_CODES["05"].obsoleteSince, "2022-04");
  assert.ok(EXHIBIT_4.replace(/\s+/g, " ").includes("OBSOLETE as of April 2022"));
});

test("the two knowledge base contradictions are recorded rather than resolved silently", () => {
  // Exhibit 4's notes require 17B on 71–84; § 1.5's list excludes them.
  for (const code of ["71", "78", "80", "82", "83", "84"]) {
    assert.equal(STATUS_CODES[code].exhibit4NotesRequirePaymentRating, true);
    assert.equal(STATUS_CODES[code].requiresPaymentRating, false);
  }
  // Status 11's non-zero balance requirement is recorded but not enforced.
  assert.equal(STATUS_CODES["11"].requiredBalance, "nonzero");
  assert.equal(STATUS_CODES["11"].requiredBalanceEnforced, false);
});

test("Portfolio Type codes are the five in § 1.3", () => {
  assert.deepEqual(Object.keys(PORTFOLIO_TYPES).sort(), ["C", "I", "M", "O", "R"]);
  assert.ok(KB.replace(/\s+/g, " ").includes("C/I/M/O/R"));
});

// ── Field 17B — Payment Rating ─────────────────────────────────────────────

const EXHIBIT_17B = slice("Payment Rating (17B): Required when", "Payment History Profile (18): 24 characters");

test("Payment Rating codes agree with § 1.5, both directions", () => {
  const documentCodes = rowCodes(EXHIBIT_17B, /^([0-9]|[A-Z]) [A-Z0-9]/);
  assertSameCodes("Field 17B", Object.keys(PAYMENT_RATINGS), documentCodes);
  assert.equal(Object.keys(PAYMENT_RATINGS).length, 9);
  assert.equal(PAYMENT_RATINGS.L.meaning, "Charge-off");
  assert.equal(PAYMENT_RATINGS.G.meaning, "Collection");
});

test("the § 1.5 sentence naming which statuses require 17B is quoted verbatim", () => {
  assert.ok(KB.replace(/\s+/g, " ").includes(PAYMENT_RATING_REQUIRED_TEXT));
});

// ── Field 18 — Payment History Profile ─────────────────────────────────────

test("Payment History Profile alphabet, length and direction match § 1.5", () => {
  assert.equal(PHP_LENGTH, 24);
  assert.equal(Object.keys(PHP_CODES).length, 15);
  assert.deepEqual(PHP_LATE_CODES, ["1", "2", "3", "4", "5", "6"]);
  const flat = KB.replace(/\s+/g, " ");
  assert.ok(flat.includes("24 characters representing 24 months of history"));
  assert.ok(flat.includes(PHP_DIRECTION));
  // Every non-numeric code is introduced by name in the § 1.5 prose list.
  const named = {
    B: "B (no data)",
    D: "D (no",
    E: "E (zero balance/current)",
    G: "G (collection)",
    H: "H (foreclosure)",
    J: "J (voluntary surrender)",
    K: "K (repossession)",
    L: "L (charge-off)"
  };
  for (const [code, fragment] of Object.entries(named)) {
    assert.ok(Object.hasOwn(PHP_CODES, code), `PHP table missing ${code}`);
    assert.ok(flat.includes(fragment), `knowledge base § 1.5 should list "${fragment}"`);
  }
});

// ── Exhibit 7 — Special Comment Codes (Field 19) ───────────────────────────

const EXHIBIT_7 = slice("1.8 Special Comment Codes (Field 19) — EXHIBIT 7", "1.9 Compliance Condition Codes");

test("Exhibit 7 special comment codes agree with the knowledge base, both directions", () => {
  const documentCodes = rowCodes(EXHIBIT_7, /^([A-Z]{1,2}) [A-Z]/);
  assertSameCodes("Exhibit 7", Object.keys(SPECIAL_COMMENTS), documentCodes);
  assert.equal(Object.keys(SPECIAL_COMMENTS).length, 20);
});

test("Exhibit 7 required conditions are quoted, not paraphrased", () => {
  const flat = EXHIBIT_7.replace(/\s+/g, " ");
  for (const [code, def] of Object.entries(SPECIAL_COMMENTS)) {
    if (!def.conditionText) continue;
    assert.ok(
      flat.includes(def.conditionText),
      `Exhibit 7 condition text for ${code} not found verbatim: "${def.conditionText}"`
    );
  }
  assert.deepEqual(PAID_OR_CLOSED_STATUSES, ["13", "61", "62", "63", "64", "65"]);
  assert.equal(SPECIAL_COMMENTS.AU.requiresBalanceZero, true);
  assert.deepEqual(SPECIAL_COMMENTS.AU.requiresStatusIn, PAID_OR_CLOSED_STATUSES);
  assert.equal(SPECIAL_COMMENTS.H.requiresEcoa, "T");
  assert.equal(SPECIAL_COMMENTS.M.requiresDateClosed, true);
});

// ── Exhibit 8 — Compliance Condition Codes (Field 20) ──────────────────────

const EXHIBIT_8 = slice("1.9 Compliance Condition Codes (Field 20) — EXHIBIT 8", "1.10 ECOA Code (Field 37)");

test("Exhibit 8 compliance condition codes agree with the knowledge base, both directions", () => {
  const documentCodes = rowCodes(EXHIBIT_8, /^(X[A-Z]) [A-Z]/);
  assertSameCodes("Exhibit 8", Object.keys(COMPLIANCE_CODES), documentCodes);
  assert.deepEqual(Object.keys(COMPLIANCE_CODES), ["XA", "XB", "XC", "XD", "XE", "XF", "XG", "XH", "XJ", "XR"]);
});

test("Exhibit 8 removal and disagreement semantics match § 1.9", () => {
  const flat = EXHIBIT_8.replace(/\s+/g, " ");
  assert.ok(flat.includes("Must be REMOVED after investigation"));
  assert.ok(flat.includes("consumer disagrees"));
  assert.ok(flat.includes("Do NOT use as default"));
  assert.deepEqual([...DISPUTE_IN_PROGRESS_CODES].sort(), ["XB", "XD", "XF", "XJ"]);
  assert.deepEqual([...CONSUMER_DISAGREES_CODES].sort(), ["XC", "XE", "XG"]);
  assert.equal(COMPLIANCE_CODES.XH.consumerDisagrees, false);
  assert.equal(COMPLIANCE_CODES.XR.notADefault, true);
  assert.deepEqual(COMPLIANCE_CODES.XD.composes, ["XA", "XB"]);
  assert.deepEqual(COMPLIANCE_CODES.XE.composes, ["XA", "XC"]);
  assert.deepEqual(COMPLIANCE_CODES.XJ.composes, ["XA", "XF"]);
});

// ── Exhibit 10 — ECOA Code (Field 37) ──────────────────────────────────────

const EXHIBIT_10 = slice("1.10 ECOA Code (Field 37) — EXHIBIT 10", "1.11 Consumer Information Indicators");

test("Exhibit 10 ECOA codes agree with the knowledge base, both directions", () => {
  const documentCodes = rowCodes(EXHIBIT_10, /^([0-9]|[A-Z]) [A-Z]/);
  assertSameCodes("Exhibit 10", Object.keys(ECOA_CODES), documentCodes);
  assert.deepEqual(Object.keys(ECOA_CODES), ["1", "2", "3", "5", "7", "T", "W", "X", "Z"]);
});

test("obsolete ECOA codes 0, 4 and 6 are retained so a check can report them", () => {
  assert.deepEqual(Object.keys(OBSOLETE_ECOA_CODES), ["0", "4", "6"]);
  assert.equal(ECOA_OBSOLETE_SINCE, "2003-09");
  assert.ok(
    EXHIBIT_10.replace(/\s+/g, " ").includes("Obsolete codes 0, 4, 6 still being reported (obsolete since September 2003)")
  );
  // They must NOT appear in the current-code table.
  for (const code of ["0", "4", "6"]) {
    assert.equal(Object.hasOwn(ECOA_CODES, code), false, `ECOA ${code} is obsolete and must not be a current code`);
  }
});

// ── Exhibit 11 — Consumer Information Indicator (Field 38) ─────────────────

const EXHIBIT_11 = slice("1.11 Consumer Information Indicators (Field 38) — EXHIBIT 11", "1.12 Critical Appended Segments");

test("Exhibit 11 CII codes agree with the knowledge base, both directions", () => {
  const documentCodes = rowCodes(EXHIBIT_11, /^([0-9]A|[A-Z]) [A-Z]/);
  assertSameCodes("Exhibit 11", Object.keys(CII_CODES), documentCodes);
  assert.equal(Object.keys(CII_CODES).length, 15);
});

test("Exhibit 11 discharge and petition sets match § 1.11", () => {
  assert.deepEqual(CII_DISCHARGED_CODES, ["E", "F", "G", "H"]);
  assert.deepEqual(CII_PETITION_CODES, ["A", "B", "C", "D"]);
  const flat = EXHIBIT_11.replace(/\s+/g, " ");
  assert.ok(flat.includes("Discharged through Chapter 7"));
  assert.ok(flat.includes("Discharged/completed through Chapter 13"));
  assert.ok(flat.includes("Reporting a balance due on a discharged (Code E/F/G/H) debt"));
  // 1A and 2A are two characters wide; a single-character parser drops them.
  assert.equal(CII_CODES["1A"].meaning, "Personal Receivership");
  assert.equal(CII_CODES["2A"].meaning, "Lease Assumption");
});

// ── Citations ──────────────────────────────────────────────────────────────

test("rule IDs are exactly M2-001 through M2-038", () => {
  assert.equal(RULE_IDS.length, 38);
  RULE_IDS.forEach((id, i) => {
    assert.equal(id, `M2-${String(i + 1).padStart(3, "0")}`);
  });
});

test("every case cited appears verbatim in the knowledge base case law library", () => {
  const flat = KB.replace(/\s+/g, " ");
  for (const [key, citation] of Object.entries(CASES)) {
    if (key === "XB_XH_XC") {
      // § 2.3 names these three by surname only, without reporters.
      assert.ok(flat.includes("Fulton, Wood, Matson"), "XB/XH/XC cases not found in § 2.3");
      continue;
    }
    assert.ok(flat.includes(citation), `case citation not found verbatim in knowledge base: ${citation}`);
  }
});

test("every rule carries at least one statutory hook and a Metro 2 reference", () => {
  for (const id of RULE_IDS) {
    const entry = RULE_CITATIONS[id];
    assert.ok(entry.statutes.length > 0, `${id} has no statutory hook`);
    assert.ok(entry.metro2Ref && entry.metro2Ref.length > 0, `${id} has no Metro 2 reference`);
    assert.deepEqual(citationsFor(id), [...entry.statutes, ...entry.caseLaw]);
    assert.equal(metro2RefFor(id), entry.metro2Ref);
  }
  assert.deepEqual(citationsFor("M2-999"), []);
  assert.equal(metro2RefFor("M2-999"), null);
});

/**
 * Citations the knowledge base carries under different wording than the
 * canonical "§ 1681s-2(a)(2)" form. Each maps to the phrase § 3 actually uses,
 * so the assertion still proves the subsection exists in the document rather
 * than waving the mismatch through.
 */
const STATUTE_WORDING_IN_DOCUMENT = Object.freeze({
  "1681s-2(a)(2)": "(a)(2): Duty to correct and update information"
});

test("every statutory section cited appears in the knowledge base statute text", () => {
  const flat = KB.replace(/\s+/g, " ");
  const sections = new Set();
  for (const id of RULE_IDS) {
    for (const s of RULE_CITATIONS[id].statutes) {
      const m = /§+\s*([0-9A-Za-z\-().]+)/.exec(s);
      if (m) sections.add(m[1]);
    }
    // Non-§ hooks (Regulation V parts, CDIA policy) are checked below.
  }
  for (const section of sections) {
    const alternate = STATUTE_WORDING_IN_DOCUMENT[section];
    if (alternate) {
      assert.ok(flat.includes(alternate), `statute subsection not found in knowledge base: ${alternate}`);
      // The base section must still be present under its own number.
      const base = section.split("(")[0];
      assert.ok(flat.includes(base), `statute base section not found in knowledge base: § ${base}`);
      continue;
    }
    assert.ok(flat.includes(section), `statute section not found in knowledge base: § ${section}`);
  }
  assert.ok(flat.includes("12 CFR 1022.42"));
  assert.ok(flat.includes("12 CFR 1022.43"));
  assert.ok(flat.includes("1-year wait, $500 minimum"));
  assert.ok(flat.includes("Bankruptcy Code § 524"));
});

// ── § 5.8 severity tiers ───────────────────────────────────────────────────

test("§ 5.8's four priority tiers are quoted where severity is assigned", () => {
  const tiers = slice("5.8 Output Priority Ranking", "AI PROMPT INTEGRATION GUIDE").replace(/\s+/g, " ");
  assert.ok(tiers.includes("Most powerful (likely deletion)"));
  assert.ok(tiers.includes("Strong (high leverage)"));
  assert.ok(tiers.includes("Moderate:"));
  assert.ok(tiers.includes("Supporting:"));
});
