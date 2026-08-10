// The violation engine. All 38 checks from knowledge base § 5, run in order.
//
// Detection is deterministic code. Prose is a language model's job, later, and
// the two never mix — a model must never decide whether a violation exists,
// only how to say it. Everything in this directory is arithmetic, comparisons
// and code-table lookups, and it is pure: no clock, no database, no network.
// Same tradeline and context in, byte-identical violations out, which is what
// makes a claim in a mailed letter defensible months afterwards.
//
// ── THIRTY TRADELINE CHECKS, EIGHT REPORT CHECKS ──────────────────────────
//
// M2-001 … M2-030 describe an account. M2-031 … M2-038 describe the file — a
// misspelled name and an unauthorised inquiry belong to the consumer, not to a
// tradeline. Running the file-level checks once per tradeline would repeat the
// same finding once for every account on the report, and a letter that lists the
// same address error twelve times reads as machine-generated. § 4.6 is explicit
// that a letter which reads as templated can be lawfully discarded, so this is
// not tidiness.
//
// Hence three entry points:
//
//   runTradelineChecks(tradeline, context)  the 30 account rules
//   runReportChecks(context)                the 8 file rules, once
//   runAllChecks(tradeline, context)        both, for a single-tradeline call
//
// For a whole report use runReport(tradelines, context), which runs the file
// rules exactly once and the account rules once per tradeline.
//
// ── A CHECK THAT THROWS MUST NOT TAKE DOWN THE REPORT ─────────────────────
//
// Each check is called inside a try. A rule that throws is a bug in that rule,
// and losing the other thirty-seven findings because of it would turn a small
// defect into a blank letter. The failure is recorded on the result as an
// `error` rather than swallowed, so it is visible and reportable — never
// silently counted as "no violation found".

import { UNIVERSAL_CHECKS } from "./universal.mjs";
import { STATUS_CONSISTENCY_CHECKS } from "./status-consistency.mjs";
import { CHARGEOFF_COLLECTION_CHECKS } from "./chargeoff-collection.mjs";
import { BANKRUPTCY_CHECKS } from "./bankruptcy.mjs";
import { DISPUTE_STATUS_CHECKS } from "./dispute-status.mjs";
import { PERSONAL_INFO_CHECKS } from "./personal-info.mjs";
import { INQUIRY_CHECKS } from "./inquiries.mjs";
import { sortBySeverity, severityCounts, highestSeverity } from "./severity.mjs";
import { RULE_IDS } from "../rules/citations.mjs";
import { KB_STAMP } from "../version.mjs";
import { observed } from "../provenance.mjs";
import { str } from "./violation.mjs";

/** The 30 checks that examine one account. § 5.1 – § 5.5. */
export const TRADELINE_CHECKS = Object.freeze([
  ...UNIVERSAL_CHECKS,
  ...STATUS_CONSISTENCY_CHECKS,
  ...CHARGEOFF_COLLECTION_CHECKS,
  ...BANKRUPTCY_CHECKS,
  ...DISPUTE_STATUS_CHECKS
]);

/** The 8 checks that examine the file. § 5.6 – § 5.7. */
export const REPORT_CHECKS = Object.freeze([...PERSONAL_INFO_CHECKS, ...INQUIRY_CHECKS]);

/** All 38, in the knowledge base's numbering. */
export const ALL_CHECKS = Object.freeze([...TRADELINE_CHECKS, ...REPORT_CHECKS]);

/** Every rule ID the engine implements, in order. */
export const IMPLEMENTED_RULE_IDS = Object.freeze(ALL_CHECKS.map(([ruleId]) => ruleId));

function invoke(ruleId, fn, args, collected) {
  try {
    const result = fn(...args);
    if (!result) return;
    for (const v of Array.isArray(result) ? result : [result]) {
      if (v) collected.push(v);
    }
  } catch (cause) {
    collected.errors.push({ ruleId, message: cause?.message ?? String(cause) });
  }
}

/**
 * A violation list that also carries the errors from any rule that threw.
 *
 * `errors` is NON-ENUMERABLE on purpose. The documented return of these
 * functions is `violations[]`, and a caller comparing the result to a list of
 * expected violations — which is what every test in this directory does — must
 * see an array of violations and nothing else. A plain assigned property would
 * make an empty result compare unequal to `[]` and quietly push callers into
 * looser assertions, which is the last thing wanted in a suite whose whole job
 * is proving the engine found nothing.
 */
function newCollector() {
  const out = [];
  Object.defineProperty(out, "errors", { value: [], enumerable: false, writable: true });
  return out;
}

function withErrors(list, errors) {
  Object.defineProperty(list, "errors", { value: errors, enumerable: false, writable: true });
  return list;
}

/**
 * The 30 account-level checks against one normalized tradeline.
 * Returns violations strongest-first. Empty means nothing fired — which is not
 * the same as "clean": a tradeline whose fields are all `not_visible` produces
 * no violations because nothing could be examined.
 */
export function runTradelineChecks(tradeline, context = {}) {
  const collected = newCollector();
  for (const [ruleId, fn] of TRADELINE_CHECKS) invoke(ruleId, fn, [tradeline, context], collected);
  return withErrors(sortBySeverity(collected), collected.errors);
}

/** The 8 file-level checks. Run once per report, not once per tradeline. */
export function runReportChecks(context = {}) {
  const collected = newCollector();
  for (const [ruleId, fn] of REPORT_CHECKS) invoke(ruleId, fn, [context], collected);
  return withErrors(sortBySeverity(collected), collected.errors);
}

/**
 * All 38 checks for a single tradeline plus its file context.
 *
 * Convenient for one account. For a whole report use runReport(), which avoids
 * repeating the eight file-level findings once per tradeline.
 */
export function runAllChecks(tradeline, context = {}) {
  const collected = newCollector();
  for (const [ruleId, fn] of TRADELINE_CHECKS) invoke(ruleId, fn, [tradeline, context], collected);
  for (const [ruleId, fn] of REPORT_CHECKS) invoke(ruleId, fn, [context], collected);
  return withErrors(sortBySeverity(collected), collected.errors);
}

/**
 * A whole report: the file rules once, the account rules per tradeline.
 *
 * `context.relatedTradelines` and `context.reportedCreditors` are filled in from
 * the tradeline list when the caller has not supplied them, because the
 * double-reporting and permissible-purpose rules need to see the other accounts
 * on the file and rebuilding that by hand at every call site is how one call
 * site ends up not doing it.
 */
export function runReport(tradelines = [], context = {}) {
  const list = Array.isArray(tradelines) ? tradelines : [];

  // Derived context is `observed`, not raw: everything the checks read goes
  // through the provenance wrappers, and a bare array here would read as
  // malformed and silence the rules that depend on it.
  const reportedCreditors =
    context.reportedCreditors ?? observed(list.map((t) => str(t?.creditor)).filter((c) => c !== null));
  const withFileContext = { ...context, reportedCreditors };
  const reportViolations = runReportChecks(withFileContext);

  const perTradeline = list.map((tradeline) => {
    const scoped = {
      ...withFileContext,
      relatedTradelines: context.relatedTradelines ?? observed(list.filter((t) => t !== tradeline))
    };
    return { tradeline, violations: runTradelineChecks(tradeline, scoped) };
  });

  const all = [...reportViolations, ...perTradeline.flatMap((r) => r.violations)];
  return {
    kbVersion: KB_STAMP,
    asOf: context.asOf ?? null,
    report: reportViolations,
    tradelines: perTradeline,
    violations: sortBySeverity(all),
    counts: severityCounts(all),
    highestSeverity: highestSeverity(all),
    errors: [...reportViolations.errors, ...perTradeline.flatMap((r) => r.violations.errors)]
  };
}

/** Do we implement exactly M2-001 … M2-038, once each? Asserted by the suite. */
export function coverageReport() {
  const implemented = new Set(IMPLEMENTED_RULE_IDS);
  return {
    implemented: IMPLEMENTED_RULE_IDS,
    missing: RULE_IDS.filter((id) => !implemented.has(id)),
    unexpected: IMPLEMENTED_RULE_IDS.filter((id) => !RULE_IDS.includes(id)),
    duplicates: IMPLEMENTED_RULE_IDS.filter((id, i) => IMPLEMENTED_RULE_IDS.indexOf(id) !== i)
  };
}

export { sortBySeverity, severityCounts, highestSeverity };
