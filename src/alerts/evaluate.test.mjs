// Unit tests for the alert and upsell evaluators. Pure functions, no database.
//
// The tests that matter here are the refusals and the null cases. Everything
// worth testing in this module is a place where a plausible-looking number must
// NOT be produced, because the output is shown to someone making a decision
// about money — and in the upsell case, is advice to borrow.
//
// The two failures being guarded against, stated once:
//   a missing LIMIT read as 0 makes utilization infinite  -> client looks maxed
//   a missing BALANCE read as 0 makes utilization 0%      -> client looks clear,
//                                                            and gets told to
//                                                            borrow more.

import { test } from "node:test";
import assert from "node:assert";
import {
  evaluateUtilization, evaluateScore, suggestCardUpgrade, monthlyReport,
  ALERT_KINDS, UPSELL_KINDS, DEFAULT_UTILIZATION_THRESHOLD
} from "./evaluate.mjs";

const card = (lender, limit, balance, extra = {}) =>
  ({ lender, creditLimitCents: limit, balanceCents: balance, ...extra });

/* --------------------------- evaluateUtilization -------------------------- */

test("utilization is the ratio of what is used to what is available", () => {
  const r = evaluateUtilization({ cards: [card("Amex", 10000, 5000)] });
  assert.equal(r.aggregate.utilization, 0.5);
  assert.equal(r.aggregate.cardsCounted, 1);
  assert.equal(r.aggregate.cardsNotCounted, 0);
  assert.equal(r.aggregate.complete, true);
});

test("A MISSING LIMIT IS NOT ZERO — the card is excluded, not reported as maxed", () => {
  const r = evaluateUtilization({ cards: [card("Chase", null, 4000)] });
  assert.equal(r.aggregate.utilization, null, "no limit means no ratio, not an infinite one");
  assert.equal(r.aggregate.cardsCounted, 0);
  assert.equal(r.aggregate.cardsNotCounted, 1);
  assert.equal(r.unknown[0].reason, "no credit limit on file");
  assert.deepEqual(r.findings, [], "a finding must never rest on a gap");
});

test("A MISSING BALANCE IS NOT ZERO — the card is excluded, not reported as clear", () => {
  const r = evaluateUtilization({ cards: [card("Chase", 10000, null)] });
  assert.equal(r.aggregate.utilization, null);
  assert.equal(r.unknown[0].reason, "no balance on file");
  assert.deepEqual(r.findings, []);
});

test("a zero limit is undefined utilization, not 100%", () => {
  const r = evaluateUtilization({ cards: [card("Store card", 0, 500)] });
  assert.equal(r.aggregate.utilization, null);
  assert.match(r.unknown[0].reason, /zero/);
});

test("THE AGGREGATE USES ONLY COMPLETE CARDS — a known balance is never divided by an unknown limit", () => {
  const r = evaluateUtilization({
    cards: [card("Amex", 10000, 5000), card("Chase", null, 9000)]
  });
  // 5000/10000, NOT 14000/10000 and NOT 14000/(10000+0).
  assert.equal(r.aggregate.utilization, 0.5);
  assert.equal(r.aggregate.totalBalance, 5000, "the excluded card's balance must not leak into the numerator");
  assert.equal(r.aggregate.totalLimit, 10000);
  assert.equal(r.aggregate.cardsNotCounted, 1);
});

test("a partial picture is reported as partial and is never critical", () => {
  const r = evaluateUtilization({
    cards: [card("Amex", 10000, 9000), card("Chase", null, null)]
  });
  const f = r.findings.find((x) => x.kind === ALERT_KINDS.UTILIZATION_HIGH);
  assert.equal(r.aggregate.complete, false);
  assert.equal(f.severity, "info", "a warning on 1 of 2 cards would be a confident wrong answer");
  assert.match(f.message, /could not be counted/);
});

test("a complete picture over the threshold is a warning that says so plainly", () => {
  const r = evaluateUtilization({ cards: [card("Amex", 10000, 6200)] });
  const f = r.findings.find((x) => x.kind === ALERT_KINDS.UTILIZATION_HIGH);
  assert.equal(f.severity, "warn");
  assert.match(f.message, /62\.0%/);
  assert.match(f.message, /30%/);
  assert.equal(f.evidence.cardsCounted, 1);
});

test("utilization at or below the threshold raises nothing", () => {
  const r = evaluateUtilization({ cards: [card("Amex", 10000, 3000)] });
  assert.equal(r.aggregate.utilization, 0.3);
  assert.deepEqual(r.findings.filter((f) => f.kind === ALERT_KINDS.UTILIZATION_HIGH), [],
    "the threshold is a boundary, not a trigger — 30% is not above 30%");
});

test("a near-limit card is its own finding, deduped per card and not per lender name", () => {
  const r = evaluateUtilization({
    cards: [card("Amex", 10000, 9500, { accountRef: "a1" }), card("Amex", 5000, 4900, { accountRef: "a2" })]
  });
  const near = r.findings.filter((f) => f.kind === ALERT_KINDS.CARD_NEAR_LIMIT);
  assert.equal(near.length, 2, "two maxed cards are two findings");
  assert.notEqual(near[0].dedupeKey, near[1].dedupeKey,
    "two cards from the same lender must not collapse into one alert");
});

test("no cards at all is 'nothing known', not 'nothing wrong'", () => {
  const r = evaluateUtilization({ cards: [] });
  assert.equal(r.aggregate.utilization, null);
  assert.equal(r.aggregate.complete, false, "an empty file is not a clean file");
  assert.deepEqual(r.findings, []);
});

test("garbage inputs are unknown, not zero", () => {
  for (const bad of ["n/a", "", undefined, NaN, -500]) {
    const r = evaluateUtilization({ cards: [card("X", bad, 100)] });
    assert.equal(r.aggregate.utilization, null, `"${String(bad)}" must not become a limit`);
  }
});

test("the threshold is configurable and honoured", () => {
  const r = evaluateUtilization({ cards: [card("Amex", 10000, 4000)], threshold: 0.5 });
  assert.deepEqual(r.findings.filter((f) => f.kind === ALERT_KINDS.UTILIZATION_HIGH), []);
  assert.equal(r.aggregate.threshold, 0.5);
});

/* ------------------------------ evaluateScore ----------------------------- */

test("a score drop past the threshold is reported with both numbers", () => {
  const r = evaluateScore({ current: 640, previous: 700 });
  assert.equal(r.delta, -60);
  assert.equal(r.direction, "down");
  const f = r.findings[0];
  assert.equal(f.kind, ALERT_KINDS.SCORE_DROP);
  assert.match(f.message, /fell 60 points, from 700 to 640/);
});

test("A FIRST-EVER SCORE HAS NOTHING TO COMPARE AGAINST", () => {
  const r = evaluateScore({ current: 700, previous: null });
  assert.equal(r.delta, null);
  assert.equal(r.direction, "unknown");
  assert.equal(r.reason, "no earlier score to compare against");
  assert.deepEqual(r.findings, [],
    "defaulting the previous score to 0 would report every new client as having gained 700 points");
});

test("a missing current score names which half is missing", () => {
  assert.equal(evaluateScore({ current: null, previous: 700 }).reason, "no current score on file");
  assert.equal(evaluateScore({}).reason, "no score on file");
});

test("a small drop is movement, not an alert", () => {
  const r = evaluateScore({ current: 695, previous: 700 });
  assert.equal(r.delta, -5);
  assert.equal(r.direction, "down");
  assert.deepEqual(r.findings, []);
});

test("a rise is never an alert", () => {
  const r = evaluateScore({ current: 760, previous: 700 });
  assert.equal(r.direction, "up");
  assert.deepEqual(r.findings, []);
});

test("the drop threshold is configurable", () => {
  assert.equal(evaluateScore({ current: 690, previous: 700, dropPoints: 5 }).findings.length, 1);
  assert.equal(evaluateScore({ current: 690, previous: 700, dropPoints: 50 }).findings.length, 0);
});

test("the score message states what moved and never what will happen next", () => {
  const f = evaluateScore({ current: 600, previous: 700 }).findings[0];
  assert.doesNotMatch(f.message, /will|guarantee|improve|expect|should|likely/i,
    "this repo does not draft claims about credit outcomes");
});

/* --------------------------- suggestCardUpgrade --------------------------- */

test("a card carrying real balance against a small limit is worth asking about", () => {
  const r = suggestCardUpgrade({ cards: [card("Amex", 1000, 900, { accountRef: "a1" })] });
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0].kind, UPSELL_KINDS.CARD_LIMIT_INCREASE);
  assert.equal(r.suggestions[0].confidence, 1);
});

test("NO SUGGESTION IS EVER MADE FROM A MISSING BALANCE", () => {
  const r = suggestCardUpgrade({ cards: [card("Amex", 1000, null)] });
  assert.deepEqual(r.suggestions, [],
    "reading a missing balance as 0 recommends borrowing to someone who may already be maxed");
  assert.equal(r.cardsSkipped, 1);
});

test("no suggestion is ever made from a missing limit", () => {
  const r = suggestCardUpgrade({ cards: [card("Amex", null, 900)] });
  assert.deepEqual(r.suggestions, []);
  assert.equal(r.cardsSkipped, 1);
});

test("a comfortable card is not an opportunity", () => {
  const r = suggestCardUpgrade({ cards: [card("Amex", 10000, 1000)] });
  assert.deepEqual(r.suggestions, []);
});

test("a card at zero balance is not an opportunity even with a tiny limit", () => {
  const r = suggestCardUpgrade({ cards: [card("Store", 300, 0)] });
  assert.deepEqual(r.suggestions, [], "there is no balance to relieve");
});

test("confidence reflects how much of the file was visible, and is null when none was", () => {
  const partial = suggestCardUpgrade({
    cards: [card("Amex", 1000, 900), card("Chase", null, null), card("Citi", null, null), card("Cap1", null, null)]
  });
  assert.equal(partial.suggestions[0].confidence, 0.25, "1 of 4 cards visible");
  assert.equal(partial.visibility, 0.25);

  const nothing = suggestCardUpgrade({ cards: [] });
  assert.equal(nothing.visibility, null, "no visibility is unknown, not zero — zero reads as certainty");
});

test("low confidence is reported, never used to hide the row", () => {
  const r = suggestCardUpgrade({
    cards: [card("Amex", 1000, 900), ...Array.from({ length: 9 }, (_, i) => card(`Unknown ${i}`, null, null))]
  });
  assert.equal(r.suggestions.length, 1, "hiding it would let a reader assume everything visible is solid");
  assert.equal(r.suggestions[0].confidence, 0.1);
});

test("the rationale is internal and states no credit-outcome claim", () => {
  const r = suggestCardUpgrade({ cards: [card("Amex", 1000, 900)] });
  assert.doesNotMatch(r.suggestions[0].rationale, /score|approved|guarantee|will improve/i);
});

/* ------------------------------ monthlyReport ----------------------------- */

test("the report assembles the evaluators and invents nothing", () => {
  const r = monthlyReport({
    period: "2026-07",
    cards: [card("Amex", 10000, 6200)],
    score: { current: 640, previous: 700 }
  });
  assert.equal(r.period, "2026-07");
  assert.equal(r.utilization.utilization, 0.62);
  assert.equal(r.score.delta, -60);
  assert.equal(r.findings.length, 2);
  assert.equal(r.complete, true);
  assert.deepEqual(r.gaps, []);
});

test("THE REPORT NAMES ITS OWN BLIND SPOTS", () => {
  const r = monthlyReport({
    period: "2026-07",
    cards: [card("Amex", 10000, 6200), card("Chase", null, 3000)],
    score: { current: 640 }
  });
  assert.equal(r.complete, false);
  assert.equal(r.gaps.length, 2);
  assert.match(r.gaps[0], /1 card\(s\) were not counted/);
  assert.match(r.gaps[1], /Score movement unavailable/);
});

test("the report has no clock — the same input gives the same output", () => {
  const input = { period: "2026-07", cards: [card("Amex", 10000, 6200)], score: { current: 640, previous: 700 } };
  assert.deepEqual(monthlyReport(input), monthlyReport(input));
});

test("a period nobody supplied stays null rather than becoming this month", () => {
  assert.equal(monthlyReport({ cards: [] }).period, null);
});

test("findings are ordered worst first", () => {
  const r = monthlyReport({
    cards: [card("Amex", 1000, 990, { accountRef: "a1" })],
    score: { current: 600, previous: 700 }
  });
  const severities = r.findings.map((f) => f.severity);
  assert.deepEqual([...severities].sort((a, b) => ({ critical: 0, warn: 1, info: 2 })[a] - ({ critical: 0, warn: 1, info: 2 })[b]), severities);
});

test("an empty report is empty, not clean", () => {
  const r = monthlyReport({ period: "2026-07" });
  assert.deepEqual(r.findings, []);
  assert.equal(r.utilization.utilization, null);
  assert.equal(r.complete, false, "no data is not a clean bill of health");
  assert.match(r.gaps[0], /Score movement unavailable/);
});

test("the default threshold matches the funding calculator's", () => {
  assert.equal(DEFAULT_UTILIZATION_THRESHOLD, 0.30,
    "two numbers for 'high utilization' on the same screen is a bug that takes months to surface");
});
