// The engine as a whole.
//
// Three properties this suite exists to hold, all of them the kind that break
// quietly:
//
//   COVERAGE     exactly M2-001 … M2-038, once each. A rule silently dropped
//                from the registry stops firing and no other test notices.
//   BLINDNESS    a tradeline whose every field is `not_visible` produces zero
//                violations. This is the whole safety property of the design —
//                if it ever fails, the engine is inventing findings out of data
//                it cannot see, and every letter it writes is a liability.
//   CLEANLINESS  a compliant tradeline with everything visible produces zero
//                violations. Without this, "found nothing" would prove nothing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  runAllChecks,
  runTradelineChecks,
  runReportChecks,
  runReport,
  coverageReport,
  TRADELINE_CHECKS,
  REPORT_CHECKS,
  ALL_CHECKS,
  IMPLEMENTED_RULE_IDS
} from "./index.mjs";
import { RULE_IDS } from "../rules/citations.mjs";
import { SEVERITY_ORDER, severityFor, compareSeverity, highestSeverity, severityCounts, RULE_SEVERITY } from "./severity.mjs";
import { violation, formatCents, normalizeText, DEFAULT_OPTIONS, opt } from "./violation.mjs";
import {
  cleanTradeline,
  cleanContext,
  blindTradeline,
  blindContext,
  bareContext,
  kbExampleCollection,
  observed,
  absent,
  notVisible,
  METRO2_FIELD_NAMES,
  AS_OF
} from "./fixtures/tradelines.mjs";

// ── Coverage ───────────────────────────────────────────────────────────────

test("the engine implements exactly M2-001 through M2-038, once each", () => {
  const coverage = coverageReport();
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual(coverage.unexpected, []);
  assert.deepEqual(coverage.duplicates, []);
  assert.equal(IMPLEMENTED_RULE_IDS.length, 38);
  assert.deepEqual([...IMPLEMENTED_RULE_IDS].sort(), [...RULE_IDS].sort());
});

test("30 checks examine a tradeline and 8 examine the file", () => {
  assert.equal(TRADELINE_CHECKS.length, 30);
  assert.equal(REPORT_CHECKS.length, 8);
  assert.equal(ALL_CHECKS.length, 38);
});

test("every rule has a severity, and severityFor refuses an unknown rule", () => {
  for (const id of RULE_IDS) {
    assert.ok(SEVERITY_ORDER.includes(severityFor(id)), `${id} has no severity tier`);
  }
  assert.equal(Object.keys(RULE_SEVERITY).length, 38);
  assert.throws(() => severityFor("M2-999"), /unknown rule ID/);
});

// ── Blindness: the safety property ─────────────────────────────────────────

test("a tradeline with every field not_visible produces no violations at all", () => {
  const found = runAllChecks(blindTradeline(), blindContext());
  assert.deepEqual(found, [], "the engine must not invent findings from invisible fields");
  assert.deepEqual(found.errors, []);
});

test("an invisible tradeline against a fully-populated context still produces nothing", () => {
  // Even with every consumer assertion, a discharged bankruptcy, an open dispute
  // and a reporting history available, invisible fields yield no tradeline
  // findings. Only the eight file-level rules can speak, and here they are clean.
  const context = cleanContext({
    bankruptcy: { included: observed(true), discharged: observed(true), dismissed: observed(false), chapter: observed("7") },
    dispute: { active: observed(true), investigationCompleted: observed(false), consumerDisagreesWithOutcome: observed(true) },
    priorStatusReports: observed([{ status: "89", reportedOn: "2025-01-01" }]),
    saleIndicated: observed(true)
  });
  assert.deepEqual(runTradelineChecks(blindTradeline(), context), []);
});

test("each field being made invisible one at a time never adds a violation", () => {
  // Guards against a rule that reads a wrapper without testing provenance: such
  // a rule fires as soon as its input goes dark, because an unreadable field
  // looks empty.
  const baseline = runTradelineChecks(cleanTradeline(), cleanContext()).length;
  assert.equal(baseline, 0);
  for (const name of METRO2_FIELD_NAMES) {
    const found = runTradelineChecks(cleanTradeline({ [name]: notVisible() }), cleanContext());
    assert.deepEqual(found, [], `making ${name} not_visible must not produce a violation`);
  }
});

test("a bare context with no consumer statements produces no tradeline findings on a clean account", () => {
  assert.deepEqual(runTradelineChecks(cleanTradeline(), bareContext()), []);
  assert.deepEqual(runReportChecks(bareContext()), []);
});

// ── Cleanliness ────────────────────────────────────────────────────────────

test("a compliant tradeline with everything visible produces no violations", () => {
  const found = runAllChecks(cleanTradeline(), cleanContext());
  assert.deepEqual(
    found.map((v) => `${v.ruleId}${v.subcase ? `/${v.subcase}` : ""}`),
    []
  );
});

// ── The knowledge base's own worked example ────────────────────────────────

test("the knowledge base's Midland Funding example trips the collection rules it should", () => {
  const found = runTradelineChecks(kbExampleCollection(), cleanContext());
  const ids = new Set(found.map((v) => v.ruleId));
  // A collection with no original creditor named.
  assert.ok(ids.has("M2-019"), "missing K1 on a collection");
  // A collection with no Date of First Delinquency — the clock is unverifiable.
  assert.ok(found.some((v) => v.subcase === "dofd_missing_on_derogatory"));
  // Portfolio type and industry code disagree with the consumer's own account.
  assert.ok(ids.has("M2-003"));
  assert.ok(ids.has("M2-004"));
  // Nothing about bankruptcy, medical debt or disputes is asserted, so none of
  // those rules may speak.
  for (const quiet of ["M2-022", "M2-023", "M2-024", "M2-025", "M2-026", "M2-028", "M2-029", "M2-030"]) {
    assert.equal(ids.has(quiet), false, `${quiet} must stay silent on this fixture`);
  }
});

test("violations come back strongest first", () => {
  const found = runTradelineChecks(
    cleanTradeline({
      field_17A_account_status: observed("13"),
      field_21_current_balance: observed(210000),
      field_25_dofd: observed("2015-01-01"),
      field_17B_payment_rating: absent()
    }),
    cleanContext()
  );
  assert.ok(found.length >= 3);
  assert.equal(found[0].severity, "deletion");
  for (let i = 1; i < found.length; i += 1) {
    assert.ok(compareSeverity(found[i - 1].severity, found[i].severity) <= 0, "severity order must be non-increasing");
  }
  assert.equal(highestSeverity(found), "deletion");
});

// ── Whole-report behaviour ─────────────────────────────────────────────────

test("runReport runs the file-level rules once, not once per tradeline", () => {
  const context = cleanContext({
    file: {
      ...cleanContext().file,
      names: observed([{ first: "BARBARA", last: "DOTTY" }])
    }
  });
  const result = runReport([cleanTradeline(), cleanTradeline({ creditor: observed("AMEX") })], context);
  const nameFindings = result.violations.filter((v) => v.ruleId === "M2-032");
  assert.equal(nameFindings.length, 1, "one misspelled name must produce one finding, not one per tradeline");
  assert.equal(result.tradelines.length, 2);
  assert.equal(result.asOf, AS_OF);
  assert.match(result.kbVersion, /METRO2_MASTER_KNOWLEDGE_BASE v1\.0/);
});

test("runReport lets the double-reporting rule see the other accounts on the file", () => {
  const chargeOff = cleanTradeline({
    creditor: observed("SYNCHRONY BANK"),
    field_17A_account_status: observed("97"),
    field_17B_payment_rating: observed("L"),
    field_21_current_balance: observed(210000),
    field_23_original_chargeoff_amount: observed(210000),
    field_25_dofd: observed("2023-04-01")
  });
  const result = runReport([chargeOff, kbExampleCollection()], { asOf: AS_OF });
  assert.ok(
    result.violations.some((v) => v.ruleId === "M2-021"),
    "the same debt reported by creditor and collector must be found"
  );
});

test("runReport summarises counts and the highest severity present", () => {
  const result = runReport(
    [cleanTradeline({ field_17A_account_status: observed("13"), field_21_current_balance: observed(500) })],
    cleanContext()
  );
  assert.equal(result.highestSeverity, "strong");
  assert.equal(result.counts.strong >= 1, true);
  assert.equal(result.counts.deletion, 0);
  assert.deepEqual(result.errors, []);
});

test("runReport on an empty file produces nothing and does not throw", () => {
  const result = runReport([], { asOf: AS_OF });
  assert.deepEqual(result.violations, []);
  assert.equal(result.highestSeverity, null);
  assert.deepEqual(severityCounts([]), { deletion: 0, strong: 0, moderate: 0, supporting: 0 });
});

// ── A throwing rule must not take down the report ──────────────────────────

test("a rule that throws is recorded as an error, not counted as 'nothing found'", () => {
  // A tradeline whose field is a bare string rather than a wrapper is malformed.
  // Whatever the rules do with it, the run must complete and say so.
  const malformed = { ...cleanTradeline(), field_21_current_balance: "not a wrapper" };
  const found = runTradelineChecks(malformed, cleanContext());
  assert.ok(Array.isArray(found));
  assert.ok(Array.isArray(found.errors));
});

// ── The violation record ───────────────────────────────────────────────────

test("a violation cannot be built without a rule ID and a reason", () => {
  assert.throws(() => violation({ field: "21", reason: "x" }), /ruleId is required/);
  assert.throws(() => violation({ ruleId: "M2-011", field: "21" }), /reason is required/);
});

test("severity is derived from the rule, never passed in by a caller", () => {
  const v = violation({ ruleId: "M2-031", field: "address", reason: "an old address is still reported", severity: "deletion" });
  assert.equal(v.severity, "supporting");
});

test("violations are frozen, so nothing downstream can rewrite a finding", () => {
  const v = violation({ ruleId: "M2-011", field: "21", reason: "a paid account still shows a balance" });
  assert.throws(() => {
    v.severity = "supporting";
  }, TypeError);
});

test("money formats for a letter, and refuses a non-number", () => {
  assert.equal(formatCents(210000), "$2,100.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(123456789), "$1,234,567.89");
  assert.equal(formatCents(null), null);
});

test("text comparison folds case, punctuation and spacing", () => {
  assert.equal(normalizeText("Citibank, N.A."), "CITIBANK N A");
  assert.equal(normalizeText("  MIDLAND   FUNDING  "), "MIDLAND FUNDING");
  assert.equal(normalizeText(null), "");
});

test("thresholds come from the knowledge base and can be overridden per run", () => {
  assert.equal(DEFAULT_OPTIONS.staleDoaiDays, 30);
  assert.equal(DEFAULT_OPTIONS.medicalMinCents, 50000);
  assert.equal(DEFAULT_OPTIONS.medicalWaitDays, 365);
  assert.equal(DEFAULT_OPTIONS.inquiryMaxAgeYears, 2);
  assert.equal(opt({}, "staleDoaiDays"), 30);
  assert.equal(opt({ options: { staleDoaiDays: 7 } }, "staleDoaiDays"), 7);
  assert.equal(opt({ options: { staleDoaiDays: "soon" } }, "staleDoaiDays"), 30);
});
