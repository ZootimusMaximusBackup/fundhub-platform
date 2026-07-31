// Monthly optimization report tests.
//
// The two properties that make it a SUBSCRIPTION artifact rather than a one-off
// deliverable, and both are asserted here:
//
//   1. It is produced every period, including the quiet ones. A month with no
//      artifact is indistinguishable from a month the job failed, so a period in
//      which nothing fired still returns a full artifact with signal_count 0 and
//      blanks saying why.
//   2. Regenerating a period replaces it. The artifact key is stable per
//      (client, month), so re-running July cannot produce a second July.
//
// The third property is compliance rather than product: the artifact carries
// numbers and stated reasons and NOT ONE sentence of customer-facing claim about
// a credit outcome. That is asserted too, because it is the kind of thing that
// gets added later by someone being helpful.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  buildMonthlyOptimizationReport, monthKey, nextMonthStart,
  DOCUMENT_KIND, ENTITLEMENT_CODE, CADENCE
} from "./optimization-report.mjs";

const line = (over = {}) => ({
  id: "tl-1", lender: "Amex Blue Business", kind: "revolving",
  credit_limit_cents: 1_000_000, balance_cents: 250_000, apr: 0.1899, closed_at: null, ...over
});

const rule = (params, over = {}) => ({ active: true, needs_config: false, severity: "info", params, ...over });

const LIVE = {
  utilization_drop_clean_pull: rule({
    utilization_ceiling_pct: 30, min_drop_basis_points: null,
    clean_pull_max_inquiries_per_bureau: 2, clean_pull_max_late_payments: 0
  }, { severity: "warning" })
};

const OFF = { active: false, needs_config: true };
const SEEDED_AS_SHIPPED = {
  utilization_drop_clean_pull: rule({
    utilization_ceiling_pct: null, min_drop_basis_points: null,
    clean_pull_max_inquiries_per_bureau: null, clean_pull_max_late_payments: null
  }, OFF),
  seasoned_tradelines: rule({ min_age_months: null, min_seasoned_lines: null }, OFF),
  strength_signals: rule({ min_total_limit_cents: null, min_open_revolving_lines: null, max_utilization_pct: null }, OFF),
  score_improvement: rule({ min_score_gain: null, min_score: null }, OFF),
  card_upgrade_candidate: rule({ apr_at_or_above: null, min_balance_cents: null }, OFF)
};

const CLEAN = { crs_inquiries_ex: 1, crs_inquiries_eq: 0, crs_inquiries_tu: 0, crs_late_payments_count: 0 };
const PRIOR = [line({ balance_cents: 500_000 })];

const build = (over = {}) => buildMonthlyOptimizationReport({
  clientId: "c1", orgId: "o1",
  periodStart: "2026-07-01T00:00:00Z",
  tradelines: [line()], previousTradelines: PRIOR, pull: CLEAN,
  rules: LIVE, now: "2026-08-03T09:00:00Z", ...over
});

describe("the period is an argument, and the key is stable inside it", () => {
  test("monthKey and nextMonthStart work in UTC and roll the year over", () => {
    assert.strictEqual(monthKey("2026-07-31T23:59:59Z"), "2026-07");
    assert.strictEqual(nextMonthStart("2026-12-15T00:00:00Z").toISOString(), "2027-01-01T00:00:00.000Z");
  });

  test("the period defaults to the calendar month the start falls in", () => {
    const r = build();
    assert.strictEqual(r.artifact.period.key, "2026-07");
    assert.strictEqual(r.artifact.period.start, "2026-07-01T00:00:00.000Z");
    assert.strictEqual(r.artifact.period.end, "2026-08-01T00:00:00.000Z");
  });

  test("regenerating the same month produces the same artifact key, so July replaces July", () => {
    const first = build({ now: "2026-08-01T00:00:00Z" });
    const second = build({ now: "2026-08-20T00:00:00Z", tradelines: [line({ balance_cents: 100_000 })] });
    assert.strictEqual(first.artifact.key, second.artifact.key);
    assert.strictEqual(first.artifact.key, "credit_optimization_roadmap|c1|2026-07");
  });

  test("a different month and a different client get different keys", () => {
    assert.notStrictEqual(build().artifact.key, build({ periodStart: "2026-08-01T00:00:00Z" }).artifact.key);
    assert.notStrictEqual(build().artifact.key, build({ clientId: "c2" }).artifact.key);
  });

  test("it names the document kind and entitlement the schema already has, rather than a new one", () => {
    const r = build();
    assert.strictEqual(r.artifact.document_kind, DOCUMENT_KIND);
    assert.strictEqual(DOCUMENT_KIND, "credit_optimization_roadmap");        // 030_documents.sql
    assert.strictEqual(r.artifact.entitlement_code, ENTITLEMENT_CODE);
    assert.strictEqual(ENTITLEMENT_CODE, "credit-optimization-roadmap");     // 032_entitlements.sql
    assert.strictEqual(r.artifact.cadence, CADENCE);
    assert.strictEqual(r.artifact.recurring, true);
  });

  test("a period that does not move forward is refused", () => {
    assert.throws(() => build({ periodEnd: "2026-06-01T00:00:00Z" }), RangeError);
    assert.throws(() => build({ periodStart: null }), TypeError);
    assert.throws(() => build({ clientId: null }), TypeError);
  });
});

describe("the artifact is produced every period, including the quiet ones", () => {
  test("a month in which a condition fires carries the signal and the alert to raise", () => {
    const r = build();
    assert.strictEqual(r.signal_count, 1);
    assert.strictEqual(r.alerts.length, 1);
    assert.strictEqual(r.alerts[0].kind, "utilization_drop_clean_pull");
    assert.strictEqual(r.alerts[0].severity, "warning");
    assert.strictEqual(r.alerts[0].payload.metrics.headroom_increase_cents, 250_000);
  });

  test("a quiet month still returns a full artifact, with zero signals and a stated reason", () => {
    const r = build({ rules: SEEDED_AS_SHIPPED });
    assert.strictEqual(r.signal_count, 0);
    assert.deepStrictEqual(r.alerts, []);
    assert.strictEqual(r.blanks.length, 5, "one blank per unconfigured condition");
    assert.ok(r.artifact.key, "the artifact exists even though nothing happened");
    for (const b of r.blanks) assert.match(b.reason, /threshold\(s\) not set|inactive/);
  });

  test("an unmeasurable position is reported once at the top, not inferred from three rule reasons", () => {
    const r = build({ tradelines: [line({ balance_cents: null })], rules: SEEDED_AS_SHIPPED });
    assert.strictEqual(r.position.complete, false);
    assert.strictEqual(r.blanks[0].rule_key, null);
    assert.match(r.blanks[0].reason, /position could not be measured/);
    assert.match(r.blanks[0].reason, /no balance/);
  });

  test("with no previous period there is no previous position, and it is null rather than empty", () => {
    const r = build({ previousTradelines: null });
    assert.strictEqual(r.previous_position, null);
    assert.strictEqual(r.signal_count, 0, "nothing can be said to have dropped");
  });

  test("both positions are reported so the comparison is visible, not just its verdict", () => {
    const r = build();
    assert.strictEqual(r.position.utilization_bp, 2500);
    assert.strictEqual(r.previous_position.utilization_bp, 5000);
    assert.strictEqual(r.position.headroom_cents, 750_000);
    assert.strictEqual(r.previous_position.headroom_cents, 500_000);
  });
});

describe("the artifact carries evidence, never a claim", () => {
  test("no string anywhere in it addresses the client or promises an outcome", () => {
    const text = JSON.stringify(build()).toLowerCase();
    for (const phrase of [
      "you are", "you're", "you qualify", "you have been", "congratulations",
      "approved", "pre-approved", "guarantee", "guaranteed", "we can get you", "dear "
    ]) {
      assert.ok(!text.includes(phrase), `the artifact must not contain customer-facing claim text: "${phrase}"`);
    }
  });

  test("it is pure: same inputs, same output, and no clock is consulted", () => {
    assert.deepStrictEqual(build(), build());
    assert.strictEqual(build({ now: null }).built_at, null,
      "with no time supplied it reports none rather than reading the machine's clock");
  });

  test("it writes nothing — the alerts come back as values for the caller to store", () => {
    const r = build();
    assert.ok(Array.isArray(r.alerts));
    assert.ok(r.alerts.every((a) => a.kind && a.payload), "each alert is ready for raiseAlerts(), already shaped for 078");
  });
});

describe("the report carries the score conditions too (W4 second pass)", () => {
  test("a score gain fires inside the artifact and shows up as an alert to raise", () => {
    const r = build({
      rules: { score_improvement: rule({ min_score_gain: 20, min_score: 680 }, { severity: "info" }) },
      scores: { previous: 640, current: 700 }
    });
    assert.strictEqual(r.signal_count, 1);
    assert.strictEqual(r.alerts[0].kind, "score_improvement");
    assert.strictEqual(r.alerts[0].payload.metrics.score_gain, 60);
  });

  test("with no score readings the condition is a blank with a reason, not a silent pass", () => {
    const r = build({
      rules: { score_improvement: rule({ min_score_gain: 20, min_score: 680 }) },
      scores: null
    });
    assert.strictEqual(r.signal_count, 0);
    assert.match(r.blanks[0].reason, /no current credit score supplied/);
  });

  test("monthlyReport is the same function under the build plan's name", async () => {
    const { monthlyReport } = await import("./optimization-report.mjs");
    assert.strictEqual(monthlyReport, buildMonthlyOptimizationReport);
  });
});
