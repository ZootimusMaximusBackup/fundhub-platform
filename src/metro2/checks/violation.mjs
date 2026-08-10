// The violation record, and the small readers every check shares.
//
// One factory, so every one of the 38 rules emits the same shape and nothing
// ships a violation missing its citations. The spec's required keys are
// ruleId, severity, field, observed, expected, reason, citations and metro2Ref;
// three more are added because the letter generator and the audit trail need
// them:
//
//   subcase  which arm of a multi-arm rule fired. Two rules detect defects of
//            different severity under one ID, and a letter that cannot say
//            which one fired cannot explain itself.
//   scope    "tradeline" or "report". The personal-information and inquiry
//            checks describe the file, not an account, so a report with twelve
//            tradelines must not repeat them twelve times.
//   subject  which address, name, employer or inquiry this is about, for the
//            rules that can fire more than once over one file.
//
// PURE. No clock, no I/O, no randomness. Given the same tradeline and context
// this file and everything importing it produce byte-identical output, which is
// what makes a violation defensible six months after it was mailed.

import { citationsFor, metro2RefFor } from "../rules/citations.mjs";
import { severityFor } from "./severity.mjs";
import { isObserved, valueOf } from "../provenance.mjs";

/**
 * Build a violation. `severity` is derived, never passed in — a caller that
 * could override it could quietly promote a personal-information nit above an
 * expired seven-year window.
 */
export function violation({
  ruleId,
  field,
  observed = null,
  expected = null,
  reason,
  subcase = null,
  scope = "tradeline",
  subject = null
}) {
  if (!ruleId) throw new TypeError("violation: ruleId is required");
  if (!reason) throw new TypeError(`violation ${ruleId}: reason is required`);
  return Object.freeze({
    ruleId,
    severity: severityFor(ruleId, subcase),
    field: field == null ? null : String(field),
    observed,
    expected,
    reason,
    citations: citationsFor(ruleId),
    metro2Ref: metro2RefFor(ruleId),
    subcase,
    scope,
    subject
  });
}

/** A finite number from a provenance-wrapped field, or null. Money is cents. */
export function num(field) {
  const v = valueOf(field);
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** A trimmed string from a provenance-wrapped field, or null. */
export function str(field) {
  const v = valueOf(field);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** An array from a provenance-wrapped field, or null. */
export function list(field) {
  const v = valueOf(field);
  return Array.isArray(v) ? v : null;
}

/** Strictly `true` from a provenance-wrapped boolean field. */
export function isTrue(field) {
  return isObserved(field) && field.value === true;
}

/** Strictly `false` from a provenance-wrapped boolean field. */
export function isFalse(field) {
  return isObserved(field) && field.value === false;
}

/**
 * Loose text comparison for names, creditors and addresses: case-folded,
 * punctuation stripped, whitespace collapsed.
 *
 * Deliberately loose. "CITIBANK, N.A." and "Citibank NA" are the same
 * furnisher, and a check that called them different would manufacture a
 * violation out of a comma.
 */
export function normalizeText(value) {
  if (value == null) return "";
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameText(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na !== "" && na === nb;
}

/**
 * The numeric thresholds the checks compare against.
 *
 * Every one of these is quoted from the knowledge base, and each is overridable
 * per-run via `context.options` so a threshold can be tuned on evidence without
 * a code change. Where the knowledge base is not specific, that is said so.
 */
export const DEFAULT_OPTIONS = Object.freeze({
  /** § 1.7 — "must be within 30 days of the report date". */
  staleDoaiDays: 30,
  /** § 1681c(c) — the seven-year clock runs from DOFD plus 180 days. */
  sevenYearDays: 180,
  /** § 1.13 — medical collections under $500 must be deleted. Integer cents. */
  medicalMinCents: 50000,
  /** § 1.13 — medical debt may not be reported within 365 days of DOFD. */
  medicalWaitDays: 365,
  /**
   * § 5.6 — "Old addresses (>2 reporting cycles)".
   *
   * AMBIGUOUS IN THE KNOWLEDGE BASE, AND REPORTED AS SUCH. The document says
   * "cycles" and never defines one. Metro 2 furnishing is monthly (§ 1.7), so a
   * cycle is read as one month here. Two months is a short window and this
   * check is `supporting` severity, so the cost of the reading being wrong is a
   * weak extra paragraph rather than a bad deletion demand.
   */
  addressStaleCycles: 2,
  /** § 5.7 — "Inquiry older than 2 years on hard inquiries". */
  inquiryMaxAgeYears: 2
});

/** One option, from the context if supplied, otherwise the documented default. */
export function opt(context, key) {
  const supplied = context?.options?.[key];
  return Number.isFinite(supplied) ? supplied : DEFAULT_OPTIONS[key];
}

/** Money for a letter: 210000 cents → "$2,100.00". */
export function formatCents(cents) {
  if (!Number.isFinite(cents)) return null;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
