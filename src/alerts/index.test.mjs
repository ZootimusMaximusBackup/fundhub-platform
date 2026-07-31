// Unit tests for alert and upsell evaluation. Everything here is pure, so these
// are the whole test story for this module — there is no database half.
//
// The cases that matter most are the awkward ones: a card with no known limit, a
// score with nothing to compare against, a client with no cards. Each of those
// has an obvious wrong answer (treat the unknown as zero) that produces a
// plausible number, and each is asserted against here.

import { test } from "node:test";
import assert from "node:assert";
import {
  utilizationOf, drawableLines, evaluateUtilization, evaluateScore,
  suggestCardUpgrade, monthlyReport
} from "./index.mjs";

const line = (over = {}) => ({
  id: "t1", lender: "Amex", kind: "revolving",
  credit_limit_cents: 1_000_000, balance_cents: 250_000, closed_at: null, ...over
});

// ---------------------------------------------------------------------------
// utilization arithmetic
// ---------------------------------------------------------------------------

test("utilization is balance over limit, and unknown when it cannot be known", () => {
  assert.equal(utilizationOf(line({ credit_limit_cents: 1000, balance_cents: 250 })), 0.25);
  assert.equal(utilizationOf(line({ credit_limit_cents: null })), null, "no limit, no ratio");
  assert.equal(utilizationOf(line({ balance_cents: null })), null, "no balance, no ratio");
  assert.equal(utilizationOf(line({ credit_limit_cents: 0 })), null,
    "a zero limit is an unknown, not an infinite utilization and not 100%");
  assert.equal(utilizationOf(null), null);
});

test("only drawable lines count — installments and closed cards are excluded", () => {
  const lines = [
    line({ id: "a" }),
    line({ id: "b", kind: "installment" }),
    line({ id: "c", closed_at: "2026-01-01T00:00:00.000Z" }),
    line({ id: "d", kind: "loc" })
  ];
  assert.deepEqual(drawableLines(lines).map((l) => l.id), ["a", "d"],
    "you cannot draw against an auto loan or a closed card");
});

// ---------------------------------------------------------------------------
// evaluateUtilization
// ---------------------------------------------------------------------------

test("evaluateUtilization refuses to run without a policy rather than assuming one", () => {
  // No threshold rows exist anywhere in this repository. A plausible default
  // would read as a decision somebody made.
  assert.throws(() => evaluateUtilization({ lines: [line()] }), /a threshold is required/);
  assert.throws(() => evaluateUtilization({ lines: [line()] }, { perCard: 0.8 }), /overall/);
  assert.throws(() => evaluateUtilization({ lines: [line()] }, { overall: 0.5 }), /perCard/);
  assert.throws(() => evaluateUtilization({ lines: [] }, { perCard: "high", overall: 0.5 }), /not a number/);
});

test("a card over the line is reported with both the number and the line it crossed", () => {
  const out = evaluateUtilization(
    { lines: [line({ id: "hot", credit_limit_cents: 1000, balance_cents: 940 })] },
    { perCard: 0.8, overall: 0.9 }
  );
  const f = out.findings.find((x) => x.scope === "line");
  assert.equal(f.tradeline_id, "hot");
  assert.equal(f.observed, 0.94);
  assert.equal(f.threshold, 0.8, "the threshold travels with the finding, so it explains itself later");
  assert.equal(f.dedupe_key, "utilization:line:hot");
});

test("a card exactly on the line fires — the threshold is inclusive", () => {
  const out = evaluateUtilization(
    { lines: [line({ credit_limit_cents: 1000, balance_cents: 800 })] },
    { perCard: 0.8, overall: 0.99 }
  );
  assert.equal(out.findings.filter((f) => f.scope === "line").length, 1);
});

test("the whole book is judged separately from any single card", () => {
  const out = evaluateUtilization({
    lines: [
      line({ id: "a", credit_limit_cents: 1000, balance_cents: 700 }),
      line({ id: "b", credit_limit_cents: 1000, balance_cents: 700 })
    ]
  }, { perCard: 0.9, overall: 0.6 });

  assert.deepEqual(out.findings.map((f) => f.scope), ["book"],
    "neither card is over 90%, but the book is over 60%");
  assert.equal(out.overall, 0.7);
  assert.equal(out.findings[0].dedupe_key, "utilization:book");
});

test("a line with no known limit is EXCLUDED and named, never counted as zero", () => {
  const out = evaluateUtilization({
    lines: [
      line({ id: "known", credit_limit_cents: 1000, balance_cents: 500 }),
      line({ id: "mystery", lender: "Chase", credit_limit_cents: null, balance_cents: 900_000 })
    ]
  }, { perCard: 0.9, overall: 0.9 });

  assert.equal(out.overall, 0.5, "the total covers what could be measured");
  assert.equal(out.measured_lines, 1);
  assert.deepEqual(out.excluded, [{ tradeline_id: "mystery", lender: "Chase", reason: "no_known_limit" }],
    "a total that quietly leaves cards out is a wrong number that looks right");
  assert.equal(out.findings.length, 0, "an unmeasurable card raises nothing — it is unknown, not fine");
});

test("money comes back as a fixed 2dp STRING, never a float", () => {
  const out = evaluateUtilization(
    { lines: [line({ credit_limit_cents: 1_000_010, balance_cents: 20 })] },
    { perCard: 0.9, overall: 0.9 }
  );
  assert.equal(out.measured_limit, "10000.10");
  assert.equal(typeof out.measured_limit, "string");
  assert.equal(out.measured_balance, "0.20");
});

test("a client with no cards produces no findings and no fabricated total", () => {
  const out = evaluateUtilization({ lines: [] }, { perCard: 0.8, overall: 0.5 });
  assert.deepEqual(out.findings, []);
  assert.equal(out.overall, null, "no cards is not 0% utilization");
  assert.equal(out.measured_lines, 0);
});

// ---------------------------------------------------------------------------
// evaluateScore
// ---------------------------------------------------------------------------

test("evaluateScore refuses to run without a policy", () => {
  assert.throws(() => evaluateScore({ current: 600, previous: 700 }), /a threshold is required/);
  assert.throws(() => evaluateScore({ current: 600, previous: 700 }, { dropPoints: -40 }), /magnitude/);
});

test("a big enough drop raises, with the reading, the previous one and the line", () => {
  const out = evaluateScore({ current: 640, previous: 700 }, { dropPoints: 40 });
  assert.equal(out.delta, -60);
  assert.equal(out.findings.length, 1);
  assert.deepEqual(out.findings[0].observed, 640);
  assert.deepEqual(out.findings[0].previous, 700);
  assert.equal(out.findings[0].threshold, 40);
});

test("a drop exactly on the line fires; one point short does not", () => {
  assert.equal(evaluateScore({ current: 660, previous: 700 }, { dropPoints: 40 }).findings.length, 1);
  assert.equal(evaluateScore({ current: 661, previous: 700 }, { dropPoints: 40 }).findings.length, 0);
});

test("a rise is reported but raises nothing", () => {
  const out = evaluateScore({ current: 760, previous: 700 }, { dropPoints: 40 });
  assert.equal(out.delta, 60);
  assert.deepEqual(out.findings, [], "an alert queue that fills with good news is a queue nobody reads");
});

test("one reading is not a movement — a missing previous score raises nothing", () => {
  // Treating an absent previous score as 0 would report every first pull as a
  // 700-point catastrophe.
  for (const input of [{ current: 700 }, { current: 700, previous: null }, { current: null, previous: 700 }, {}]) {
    const out = evaluateScore(input, { dropPoints: 40 });
    assert.deepEqual(out.findings, []);
    assert.equal(out.delta, null);
    assert.equal(out.reason, "insufficient_history");
  }
});

// ---------------------------------------------------------------------------
// suggestCardUpgrade
// ---------------------------------------------------------------------------

const CRITERIA = { minLines: 2, maxUtilization: 0.3, minLimitCents: 500_000 };

test("suggestCardUpgrade refuses to run without criteria", () => {
  assert.throws(() => suggestCardUpgrade({ lines: [line()] }), /a threshold is required/);
  assert.throws(() => suggestCardUpgrade({ lines: [line()] }, { minLines: 2 }), /maxUtilization/);
});

test("a comfortable, established client is suggested, with the facts attached", () => {
  const out = suggestCardUpgrade({
    lines: [
      line({ id: "a", credit_limit_cents: 1_000_000, balance_cents: 100_000 }),
      line({ id: "b", credit_limit_cents: 1_000_000, balance_cents: 100_000 })
    ]
  }, CRITERIA);

  assert.equal(out.suggestions.length, 1);
  const s = out.suggestions[0];
  assert.equal(s.kind, "card_upgrade");
  assert.match(s.rationale, /2 measurable revolving lines/);
  assert.equal(s.evidence.source, "tradelines",
    "a suggestion from a credit file is a different object from one from a phone call");
  assert.equal(s.evidence.utilization, 0.1);
  assert.equal(s.evidence.total_limit, "20000.00");
  assert.deepEqual(s.evidence.criteria, CRITERIA, "the criteria travel with the suggestion");
  assert.deepEqual(s.evidence.tradeline_ids, ["a", "b"]);
});

test("a suggestion carries no confidence, no price and no offer", () => {
  const out = suggestCardUpgrade({
    lines: [line({ id: "a" }), line({ id: "b" })]
  }, CRITERIA);
  const s = out.suggestions[0];
  for (const forbidden of ["confidence", "score", "priority", "price", "price_cents", "limit", "apr", "expires_at"]) {
    assert.equal(forbidden in s, false, `${forbidden} would be invented — nothing here can calibrate one`);
    assert.equal(forbidden in s.evidence, false);
  }
});

test("a drawn-down or thin client is not suggested, and the reason says which", () => {
  assert.equal(suggestCardUpgrade({ lines: [line({ id: "a" })] }, CRITERIA).reason, "not_enough_measurable_lines");
  assert.equal(
    suggestCardUpgrade({
      lines: [line({ id: "a", credit_limit_cents: 100_000 }), line({ id: "b", credit_limit_cents: 100_000 })]
    }, CRITERIA).reason,
    "limits_below_floor"
  );
  assert.equal(
    suggestCardUpgrade({
      lines: [
        line({ id: "a", credit_limit_cents: 1_000_000, balance_cents: 900_000 }),
        line({ id: "b", credit_limit_cents: 1_000_000, balance_cents: 900_000 })
      ]
    }, CRITERIA).reason,
    "utilization_above_ceiling"
  );
});

test("unmeasurable cards do not pad the line count that qualifies a client", () => {
  const out = suggestCardUpgrade({
    lines: [
      line({ id: "a", credit_limit_cents: 1_000_000, balance_cents: 100_000 }),
      line({ id: "mystery", credit_limit_cents: null, balance_cents: null })
    ]
  }, CRITERIA);
  assert.deepEqual(out.suggestions, [], "two cards, one measurable — that is one, not two");
  assert.equal(out.reason, "not_enough_measurable_lines");
});

// ---------------------------------------------------------------------------
// monthlyReport
// ---------------------------------------------------------------------------

const PERIOD = { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" };

test("monthlyReport has no clock of its own", () => {
  assert.throws(() => monthlyReport({ lines: [] }), /period .* is required/);
  assert.throws(() => monthlyReport({ lines: [], period: { start: "x", end: "y" } }), /must be dates/);
  assert.throws(() => monthlyReport({ lines: [], period: { start: PERIOD.end, end: PERIOD.start } }), /must be after/);
});

test("monthlyReport counts what happened inside the month and nothing outside it", () => {
  const out = monthlyReport({
    lines: [line({ id: "a", credit_limit_cents: 1000, balance_cents: 400 })],
    alerts: [
      { raised_at: "2026-06-10T00:00:00.000Z", resolved_at: null },
      { raised_at: "2026-06-11T00:00:00.000Z", resolved_at: "2026-06-20T00:00:00.000Z" },
      { raised_at: "2026-05-30T00:00:00.000Z", resolved_at: null }        // last month
    ],
    scores: [
      { scored_at: "2026-06-02T00:00:00.000Z", score: 640 },
      { scored_at: "2026-06-28T00:00:00.000Z", score: 690 },
      { scored_at: "2026-07-02T00:00:00.000Z", score: 720 }               // next month
    ],
    period: PERIOD
  });

  assert.equal(out.alerts_raised, 2);
  assert.equal(out.alerts_resolved, 1);
  assert.equal(out.alerts_open_at_end, 1);
  assert.equal(out.score_start, 640);
  assert.equal(out.score_end, 690, "the reading two days into July belongs to July");
  assert.equal(out.score_delta, 50);
  assert.equal(out.utilization, 0.4);
  assert.equal(out.total_limit, "10.00");
});

test("the period is half-open, so adjacent months never double-count", () => {
  const onTheBoundary = { raised_at: PERIOD.end, resolved_at: null };
  const out = monthlyReport({ alerts: [onTheBoundary], period: PERIOD });
  assert.equal(out.alerts_raised, 0, "midnight on the 1st belongs to the month that starts, not the one that ends");
});

test("a month with no score readings reports null, not zero and not no-change", () => {
  const out = monthlyReport({ lines: [], alerts: [], scores: [], period: PERIOD });
  assert.equal(out.score_start, null);
  assert.equal(out.score_end, null);
  assert.equal(out.score_delta, null, "'no readings' is not 'no movement'");
  assert.equal(out.utilization, null);
});

test("the report says how much of the file it could not measure", () => {
  const out = monthlyReport({
    lines: [
      line({ id: "a", credit_limit_cents: 1000, balance_cents: 100 }),
      line({ id: "b", credit_limit_cents: null }),
      line({ id: "c", credit_limit_cents: null }),
      line({ id: "d", kind: "installment" })
    ],
    period: PERIOD
  });
  assert.equal(out.lines_drawable, 3, "the installment loan is not drawable");
  assert.equal(out.lines_measurable, 1);
  assert.equal(out.lines_unmeasurable, 2,
    "a total covering a third of a client's file is a number people make decisions on");
});

test("the same period re-run later gives the same answer", () => {
  const input = {
    lines: [line({ credit_limit_cents: 1000, balance_cents: 300 })],
    alerts: [{ raised_at: "2026-06-10T00:00:00.000Z", resolved_at: null }],
    scores: [{ scored_at: "2026-06-02T00:00:00.000Z", score: 640 }],
    period: PERIOD
  };
  assert.deepEqual(monthlyReport(input), monthlyReport(input),
    "no clock, no randomness — a past month is reportable forever");
});
