// Pins the funding estimate to the UnderwriteIQ rules as written.
//
// The 2026-09-03 walkthrough recorded this as a defect: "the funding estimate
// ignores the credit score — 724 and 762 both yield $199,350 to the dollar."
// Checked against vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js,
// that is the SPEC, not a bug. The v2 estimator applies exactly three factors —
// the outcome tier, the card-use band and the thin-file flag — and its own
// comment says so ("v2: Only 2 modifiers (utilization + thin file)"). The two
// score-adjacent tables in that file, bureau confidence and inquiry pressure,
// are underscore-prefixed and deliberately never applied.
//
// The score reaches the money through the TIER and nowhere else, and both
// FULL_FUNDING and PREMIUM_STACK carry an outcome modifier of 1.0. So two files
// with the same accounts and different scores in that band produce the same
// dollar figure by design.
//
// These tests exist so nobody "fixes" that by inventing a score factor the spec
// does not have, and so nobody removes one it does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const estimator = require("../../vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js");

const { estimatePreapprovals, OUTCOME_MODIFIER, PERSONAL_CARD_MULTIPLIER, PERSONAL_LOAN_MULTIPLIER } =
  estimator;

/** The Sim One-Funding file: Amex $25,000 anchor card, Toyota $28,000 anchor loan, 17% card use. */
function signals({ median, utilizationPct = 17, band = "good" } = {}) {
  return {
    scores: { median, bureauConfidence: "high" },
    utilization: { pct: utilizationPct, band },
    tradelines: { thinFile: false, revolvingDepth: 3 },
    anchors: {
      revolving: { limit: 25000 },
      installment: { amount: 28000 }
    }
  };
}

test("the estimator applies exactly three factors, and none of them is the credit score", () => {
  const out = estimatePreapprovals(signals({ median: 724 }), null, "FULL_FUNDING");
  assert.deepEqual(Object.keys(out.personalCard.modifiers).sort(), ["outcome", "thinFile", "utilization"]);
  assert.deepEqual(Object.keys(out.personalLoan.modifiers).sort(), ["outcome", "thinFile", "utilization"]);
});

test("the same accounts at 724 and at 762 produce the same money — that is the spec", () => {
  const at724 = estimatePreapprovals(signals({ median: 724 }), null, "FULL_FUNDING");
  const at762 = estimatePreapprovals(signals({ median: 762 }), null, "FULL_FUNDING");
  assert.equal(at724.totalCombined, at762.totalCombined);
  assert.equal(at724.totalCombined, 199350);
});

test("the score does move the money — through the tier", () => {
  const funding = estimatePreapprovals(signals({ median: 724 }), null, "FULL_FUNDING");
  const plusRepair = estimatePreapprovals(signals({ median: 640 }), null, "FUNDING_PLUS_REPAIR");
  const repairOnly = estimatePreapprovals(signals({ median: 595 }), null, "REPAIR_ONLY");

  assert.equal(OUTCOME_MODIFIER.FULL_FUNDING, 1.0);
  assert.equal(OUTCOME_MODIFIER.PREMIUM_STACK, 1.0);
  assert.equal(OUTCOME_MODIFIER.FUNDING_PLUS_REPAIR, 0.6);
  assert.equal(OUTCOME_MODIFIER.REPAIR_ONLY, 0);

  assert.ok(plusRepair.totalCombined < funding.totalCombined);
  assert.equal(repairOnly.totalCombined, 0);
  assert.equal(repairOnly.suppressedByOutcome, true);
});

test("card use does move the money, band by band", () => {
  const good = estimatePreapprovals(signals({ median: 724, band: "good" }), null, "FULL_FUNDING");
  const excellent = estimatePreapprovals(
    signals({ median: 724, utilizationPct: 5, band: "excellent" }), null, "FULL_FUNDING"
  );
  const critical = estimatePreapprovals(
    signals({ median: 724, utilizationPct: 95, band: "critical" }), null, "FULL_FUNDING"
  );
  assert.ok(excellent.totalCombined > good.totalCombined);
  assert.ok(critical.totalCombined < good.totalCombined);
});

test("the anchor multipliers are the ones the walkthrough was checked against", () => {
  assert.equal(PERSONAL_CARD_MULTIPLIER, 5.5);
  assert.equal(PERSONAL_LOAN_MULTIPLIER, 3.0);
  const out = estimatePreapprovals(signals({ median: 724 }), null, "FULL_FUNDING");
  // 25,000 x 5.5 x 1.0 x 0.9 x 1.0
  assert.equal(out.personalCard.final, 123750);
  // 28,000 x 3.0 x 1.0 x 0.9 x 1.0
  assert.equal(out.personalLoan.final, 75600);
});

test("business money is zero without a business credit report, whatever the business age", () => {
  const noReport = estimatePreapprovals(signals({ median: 724 }), null, "FULL_FUNDING");
  assert.equal(noReport.business.final, 0);
  assert.equal(noReport.business.multiplier, 0, "the age multiplier is never even reached");

  // The same client with a real business report on file: the 30-month age the
  // simulation writes to the client record is worth a 2.0 multiplier here, and
  // only here. Nothing on the client record can substitute for the report.
  const withReport = estimatePreapprovals(signals({ median: 724 }), {
    available: true,
    profile: { ageMonths: 30 },
    bizUtilization: { band: "good" },
    hardBlock: { blocked: false },
    bizNegativeItems: { hasNegatives: false },
    ucc: { caution: false }
  }, "FULL_FUNDING");
  assert.equal(withReport.business.multiplier, 2.0);
  assert.ok(withReport.business.final > 0);
});
