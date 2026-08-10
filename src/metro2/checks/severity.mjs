// Severity — which violation a letter leads with.
//
// Knowledge base § 5.8 ranks findings into four tiers for exactly one purpose:
// a letter that opens with a misspelled middle name when the same file has an
// expired seven-year window has buried the ask. The bureau reads the first
// paragraph. So severity is not decoration — it decides letter structure.
//
// § 5.8's four tiers, quoted:
//
//   1. Most powerful (likely deletion): 7-year window expired, identity theft,
//      unverifiable DOFD, discharged bankruptcy balance
//   2. Strong (high leverage): Re-aging, missing K1 on collection,
//      double-reporting, status/balance contradictions
//   3. Moderate: Compliance Condition Code errors, Payment History
//      contradictions, missing Special Comments
//   4. Supporting: Personal info errors, inquiry challenges
//
// ── HOW RULES NOT NAMED IN § 5.8 WERE PLACED ──────────────────────────────
//
// Those four lists are examples, not a complete assignment for 38 rules. Where
// a rule is not named, it was placed by the nearest named analogue, and the
// tie-break was always DOWNWARD. Under-claiming costs a weaker opening
// paragraph; over-claiming puts a demand for deletion behind a defect that only
// supports a correction, and that is how a product that promises removal starts
// generating refunds. Each non-obvious placement carries its reasoning inline.
//
// Two rules carry per-subcase severity, because the same rule detects defects of
// genuinely different weight — a missing DOFD makes the seven-year clock
// unverifiable (tier 1, named), while a DOFD that merely disagrees across
// bureaus is re-aging evidence (tier 2, named).

export const SEVERITY = Object.freeze({
  DELETION: "deletion",
  STRONG: "strong",
  MODERATE: "moderate",
  SUPPORTING: "supporting"
});

/** Strongest first. Letters argue in this order. */
export const SEVERITY_ORDER = Object.freeze([
  SEVERITY.DELETION,
  SEVERITY.STRONG,
  SEVERITY.MODERATE,
  SEVERITY.SUPPORTING
]);

export const RULE_SEVERITY = Object.freeze({
  // ── § 5.1 Universal ──────────────────────────────────────────────────────
  // Not in § 5.8. A wrong account number is a field-level accuracy defect: it
  // is not a deletion lever, and it is more than a personal-information nit
  // because it is the identifier the whole tradeline hangs on.
  "M2-001": SEVERITY.MODERATE,
  // Not in § 5.8. Cross-bureau disagreement on Date Opened is a field defect,
  // not a status/balance contradiction.
  "M2-002": SEVERITY.MODERATE,
  "M2-003": SEVERITY.MODERATE,
  "M2-004": SEVERITY.MODERATE,
  // Not in § 5.8. Stale Date of Account Information is a monthly-update
  // failure — real, but it supports a correction rather than a deletion.
  "M2-005": SEVERITY.MODERATE,
  // Subcased below. Default is the re-aging reading (tier 2, named).
  "M2-006": SEVERITY.STRONG,
  // "7-year window expired" — named in tier 1.
  "M2-007": SEVERITY.DELETION,
  "M2-008": SEVERITY.MODERATE,
  // Not in § 5.8. An inappropriate bankruptcy indicator misstates whether a
  // court order touched the debt. Placed with "missing K1 on collection"
  // (tier 2) as a materially misleading omission on a derogatory account.
  "M2-009": SEVERITY.STRONG,
  // "Compliance Condition Code errors" — named in tier 3.
  "M2-010": SEVERITY.MODERATE,

  // ── § 5.2 Status code consistency ────────────────────────────────────────
  // "status/balance contradictions" — named in tier 2.
  "M2-011": SEVERITY.STRONG,
  "M2-012": SEVERITY.STRONG,
  // Subcased below.
  "M2-013": SEVERITY.MODERATE,
  // "Payment History contradictions" — named in tier 3.
  "M2-014": SEVERITY.MODERATE,
  // Not in § 5.8. A prohibited status sequence (97 after 89 or 94) reports a
  // charge-off on a debt the furnisher already reported as resolved by deed in
  // lieu or foreclosure. Placed in tier 2 as a status contradiction.
  "M2-015": SEVERITY.STRONG,
  // "missing Special Comments" — named in tier 3.
  "M2-016": SEVERITY.MODERATE,
  // Not in § 5.8. A collector using a status the format forbids it is
  // reporting as something it is not. Tier 2.
  "M2-017": SEVERITY.STRONG,

  // ── § 5.3 Charge-off and collection ──────────────────────────────────────
  // "status/balance contradictions" — named in tier 2.
  "M2-018": SEVERITY.STRONG,
  // "missing K1 on collection" — named in tier 2.
  "M2-019": SEVERITY.STRONG,
  // Not in § 5.8. A missing Original Charge-off Amount is an omitted field,
  // closest to "missing Special Comments" in tier 3.
  "M2-020": SEVERITY.MODERATE,
  // "double-reporting" — named in tier 2.
  "M2-021": SEVERITY.STRONG,
  // Not named, but the knowledge base's own trigger text is "Must be deleted".
  "M2-022": SEVERITY.DELETION,
  // Not named; trigger text is "Cannot be reported".
  "M2-023": SEVERITY.DELETION,

  // ── § 5.4 Bankruptcy ─────────────────────────────────────────────────────
  // Not in § 5.8. Missing post-discharge indicator — tier 2, as with M2-009.
  "M2-024": SEVERITY.STRONG,
  // "discharged bankruptcy balance" — named in tier 1.
  "M2-025": SEVERITY.DELETION,
  // Not in § 5.8. The CRRG requires Code Z to remove an authorized user from a
  // bankrupt account, so the remedy is removal — which argues for tier 1. Kept
  // at tier 2 deliberately: tier 1 is an enumerated list and this is not on it,
  // and the downward tie-break applies.
  "M2-026": SEVERITY.STRONG,
  // Not in § 5.8. Delinquency reported on a discharged debt. Tier 2.
  "M2-027": SEVERITY.STRONG,

  // ── § 5.5 Dispute status ─────────────────────────────────────────────────
  // All three are "Compliance Condition Code errors" — tier 3. M2-030 is the
  // Fulton/Wood/Matson litigation pattern and argues well, but § 5.8 puts CCC
  // errors at moderate and the downward tie-break applies.
  "M2-028": SEVERITY.MODERATE,
  "M2-029": SEVERITY.MODERATE,
  "M2-030": SEVERITY.MODERATE,

  // ── § 5.6 Personal information — "Personal info errors", tier 4 ──────────
  "M2-031": SEVERITY.SUPPORTING,
  "M2-032": SEVERITY.SUPPORTING,
  "M2-033": SEVERITY.SUPPORTING,
  "M2-034": SEVERITY.SUPPORTING,

  // ── § 5.7 Inquiries — "inquiry challenges", tier 4 ───────────────────────
  "M2-035": SEVERITY.SUPPORTING,
  "M2-036": SEVERITY.SUPPORTING,
  "M2-037": SEVERITY.SUPPORTING,
  "M2-038": SEVERITY.SUPPORTING
});

/**
 * ruleId → subcase → severity, for the two rules that detect defects of
 * different weight under one number.
 */
export const SUBCASE_SEVERITY = Object.freeze({
  "M2-006": Object.freeze({
    // § 5.8 tier 1 names "unverifiable DOFD" — a collection or charge-off with
    // no Date of First Delinquency has no verifiable seven-year clock at all.
    dofd_missing_on_derogatory: SEVERITY.DELETION,
    // Tier 2 names "Re-aging". A DOFD that disagrees with another bureau's is
    // the evidence of it.
    dofd_mismatch_across_bureaus: SEVERITY.STRONG,
    // A delinquency cannot have begun after the report date.
    dofd_future: SEVERITY.STRONG
  }),
  "M2-013": Object.freeze({
    // § 1.4's own bullet list treats a charge-off without Payment Rating L as a
    // contradiction, which is tier 2.
    chargeoff_without_rating_L: SEVERITY.STRONG,
    // A required field left empty is an omission, tier 3.
    payment_rating_absent: SEVERITY.MODERATE,
    payment_rating_invalid: SEVERITY.MODERATE
  })
});

/**
 * Severity for a rule, optionally narrowed by subcase.
 * Throws on an unknown rule ID: a violation with no severity cannot be ordered
 * in a letter, and silently defaulting it to `supporting` would bury a real
 * finding. This is a programming error, so it fails loudly at the source.
 */
export function severityFor(ruleId, subcase = null) {
  const bySubcase = subcase ? SUBCASE_SEVERITY[ruleId]?.[subcase] : undefined;
  if (bySubcase) return bySubcase;
  const base = RULE_SEVERITY[ruleId];
  if (!base) throw new RangeError(`severityFor: unknown rule ID ${ruleId}`);
  return base;
}

/** Negative when `a` is more severe. Sorts strongest-first. */
export function compareSeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

/** Strongest severity present, or null for an empty list. */
export function highestSeverity(violations = []) {
  let best = null;
  for (const v of violations) {
    if (best === null || compareSeverity(v.severity, best) < 0) best = v.severity;
  }
  return best;
}

/**
 * Strongest first, stable within a tier. Stability matters: the letter
 * generator varies which violation leads WITHIN a tier to defeat template
 * detection, and it can only do that from a deterministic starting order.
 */
export function sortBySeverity(violations = []) {
  return [...violations].sort((a, b) => compareSeverity(a.severity, b.severity));
}

/** Count per tier, for a summary line. */
export function severityCounts(violations = []) {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const v of violations) if (v.severity in counts) counts[v.severity] += 1;
  return counts;
}
