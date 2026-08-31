/* Decline Autopsy scoring — does the reduced-input path into the engine behave,
 * and does NULL survive it?
 *
 * The spec's open question Q6 asks whether computeUnderwrite behaves sensibly on
 * reduced input, because it has never been run this way. These tests are the
 * measurement. They also pin the DRIFT between src/underwrite/engine.mjs's
 * header comment and what src/underwrite/vendor/underwriter.cjs actually does —
 * the vendored file is the truth and this file proves which one is right.
 *
 * Pure: no database, no storage. `now` is injected so nothing depends on today.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import { bureauShapeFor, scoreAutopsyRow, scoreAutopsyRows, ENGINE_THRESHOLDS } from "./score.mjs";
import { BUCKETS } from "./fields.mjs";
import { computeUnderwrite } from "../underwrite/engine.mjs";
import { parseAutopsyRows } from "./parse.mjs";

/* One lender that takes everybody, so the lender leg of the bucket rule is
   satisfied without depending on the live list. matchLenders' own rule is that
   an unknown state restriction means "include", never a made-up one. */
const ANY_LENDER = [{ id: "l1", name: "Lender One", active: true, eligible_states: null, bureaus_pulled: "EX", priority_tier: 1 }];

const row = (over = {}) => parseAutopsyRows({
  rows: [{
    row_label: "A-1",
    fico_band: "720+",
    state: "TX",
    business_age_months: "30",
    highest_revolving_limit_usd: "10000",
    revolving_opened_month: "2015-01",
    ...over
  }]
}).rows[0];

describe("*** NULL SURVIVES SCORING — it never becomes zero ***", () => {
  test("no FICO band means no estimate at all", () => {
    const s = scoreAutopsyRow(row({ fico_band: "unknown" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.NOT_ENOUGH_INFORMATION);
    assert.equal(s.estimated_capacity_cents, null);
    assert.notEqual(s.estimated_capacity_cents, 0, "an unknown became a measured zero");
    assert.match(s.assumptions.join(" "), /FICO band/);
  });

  test("no revolving limit means no estimate at all", () => {
    const s = scoreAutopsyRow(row({ highest_revolving_limit_usd: "" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.NOT_ENOUGH_INFORMATION);
    assert.equal(s.estimated_capacity_cents, null);
    assert.match(s.assumptions.join(" "), /highest revolving limit/);
  });

  test("no opened month means no estimate at all — the engine needs seasoning", () => {
    const s = scoreAutopsyRow(row({ revolving_opened_month: "" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.NOT_ENOUGH_INFORMATION);
    assert.equal(s.estimated_capacity_cents, null);
  });

  test("a row with no estimate carries no fee and no partner share either", () => {
    const s = scoreAutopsyRow(row({ fico_band: "unknown" }), { lenders: ANY_LENDER });
    assert.equal(s.estimated_fee_cents, null);
    assert.equal(s.estimated_partner_share_cents, null);
  });

  test("*** a lender list we never saw is NOT an empty lender list ***", () => {
    // Claiming "not fundable through our stack" because we failed to read our
    // own lender table would be a finding we did not make.
    const s = scoreAutopsyRow(row(), { lenders: null });
    assert.equal(s.bucket, BUCKETS.NOT_ENOUGH_INFORMATION);
    assert.equal(s.lender_match_count, null);
    assert.match(s.assumptions.join(" "), /lender list was not available/);
  });

  test("the reason a row could not be scored is printed, not swallowed", () => {
    const s = scoreAutopsyRow(row({ fico_band: "unknown", highest_revolving_limit_usd: "" }), { lenders: ANY_LENDER });
    assert.match(s.assumptions[0], /Not scored/);
    assert.match(s.assumptions[0], /FICO band/);
    assert.match(s.assumptions[0], /highest revolving limit/);
    assert.match(s.assumptions[0], /do not estimate from a blank/);
  });
});

describe("the reduced-input path reaches the real engine", () => {
  test("the bureau shape is one slot, and it carries no invented counts", () => {
    const shape = bureauShapeFor(row());
    assert.ok(shape.experian, "no bureau was built");
    assert.equal(shape.equifax, undefined, "a second bureau slot was invented");
    assert.equal(shape.transunion, undefined, "a third bureau slot was invented");
    assert.equal(shape.experian.score, 740, "the 720+ band midpoint");
    assert.equal("negatives" in shape.experian, false, "negatives were defaulted");
    assert.equal("inquiries" in shape.experian, false, "inquiries were defaulted");
    assert.equal("late_payment_events" in shape.experian, false, "late payments were defaulted");
    assert.equal(shape.experian.tradelines[0].limit, 10000, "the engine works in dollars, not cents");
  });

  test("a seasoned $10,000 limit produces the engine's own arithmetic, not ours", () => {
    const r = row();
    const s = scoreAutopsyRow(r, { lenders: ANY_LENDER });
    const uw = computeUnderwrite(bureauShapeFor(r), 30);
    const expectedCents = Math.round(uw.totals.total_combined_funding * 100);
    assert.equal(s.estimated_capacity_cents, expectedCents,
      "the capacity figure did not come from computeUnderwrite");
    assert.ok(expectedCents > 0, "the engine produced nothing from a seasoned $10k limit");
  });

  test("the 10% success fee and the 50% partner half are integer cents", () => {
    const s = scoreAutopsyRow(row(), { lenders: ANY_LENDER });
    assert.equal(s.estimated_fee_cents, Math.round(s.estimated_capacity_cents * 0.10));
    assert.equal(s.estimated_partner_share_cents, Math.round(s.estimated_fee_cents * 0.50));
    assert.ok(Number.isInteger(s.estimated_capacity_cents));
    assert.ok(Number.isInteger(s.estimated_fee_cents));
    assert.ok(Number.isInteger(s.estimated_partner_share_cents));
  });

  test("a limit under the engine's $5,000 floor gives no capacity, and says so", () => {
    const s = scoreAutopsyRow(row({ highest_revolving_limit_usd: "3000" }), { lenders: ANY_LENDER });
    assert.equal(s.estimated_capacity_cents, 0);
    assert.equal(s.bucket, BUCKETS.NOT_FUNDABLE);
    assert.match(s.assumptions.join(" "),
      new RegExp(`\\$${ENGINE_THRESHOLDS.minRevolvingLimit.toLocaleString("en-US")} revolving limit`));
  });

  test("an unseasoned account gives no capacity — 24 months is the engine's line", () => {
    const s = scoreAutopsyRow(row({ revolving_opened_month: "2026-07" }), { lenders: ANY_LENDER, now: new Date("2026-08-31") });
    assert.equal(s.estimated_capacity_cents, 0);
  });

  test("business age adds the engine's own multiplier, and its absence is a floor", () => {
    const withAge = scoreAutopsyRow(row({ business_age_months: "30" }), { lenders: ANY_LENDER });
    const without = scoreAutopsyRow(row({ business_age_months: "" }), { lenders: ANY_LENDER });
    assert.ok(withAge.estimated_capacity_cents > without.estimated_capacity_cents);
    assert.match(without.assumptions.join(" "), /floor, not a ceiling/);
    assert.match(withAge.assumptions.join(" "), /2x business multiplier/);
  });

  test("every estimate carries the assumptions that produced it", () => {
    const s = scoreAutopsyRow(row(), { lenders: ANY_LENDER });
    const text = s.assumptions.join(" ");
    assert.match(text, /midpoint/, "the band-to-midpoint assumption is not printed");
    assert.match(text, /left unknown. They were not counted as zero/,
      "the report does not say the unknowns were left unknown");
  });
});

describe("*** DRIFT: the vendored engine, not engine.mjs's header, is the truth ***", () => {
  /* src/underwrite/engine.mjs note (2) says the engine "COLLAPSES UNKNOWN TO
     ZERO", that numOrZero() turns a null negatives count into 0, and therefore
     "an unknown reads as a clean file". The vendored file does not do that:
     measuredCount() returns NULL for an unknown ("Unknown stays null — never
     0"), numOrZero() is applied to tradeline limit/balance only, and `fundable`
     requires `neg === 0` — which is FALSE on a null. An unknown reads as NOT
     clean, the opposite of the header. */
  test("an unsupplied negatives count stays null in the engine's own metrics", () => {
    const uw = computeUnderwrite(bureauShapeFor(row()), 30);
    assert.equal(uw.metrics.negative_accounts, null,
      "the engine collapsed an unknown negatives count to zero after all — engine.mjs's header would then be right and this file wrong");
  });

  test("so `fundable` is FALSE on autopsy input, and the bucket does not use it", () => {
    const r = row();                       // a 720+ band, clean on everything we know
    const uw = computeUnderwrite(bureauShapeFor(r), 30);
    assert.equal(uw.fundable, false, "the engine's fundable gate passed with negatives unknown");
    const s = scoreAutopsyRow(r, { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.FUNDABLE_NOW,
      "the bucket was read off uw.fundable, which is always false here — every row would land in the same pile");
  });

  test("what IS still true of the header: a missing score is reported as 0 per bureau", () => {
    const uw = computeUnderwrite({ experian: { tradelines: [] } }, null);
    assert.equal(uw.per_bureau.experian.score, 0, "the `score ?? 0` collapse is gone — update the drift note");
  });
});

describe("the four buckets", () => {
  test("fundable now — capacity, a lender, and nothing blocking the file", () => {
    const s = scoreAutopsyRow(row({ fico_band: "720+", revolving_utilization_pct: "10" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.FUNDABLE_NOW);
    assert.ok(s.lender_match_count > 0);
  });

  test("fundable after repair — capacity, blocked by the band, fixable reason", () => {
    const s = scoreAutopsyRow(row({ fico_band: "600-639", decline_reason: "credit_score" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.FUNDABLE_AFTER_REPAIR);
    assert.ok(s.estimated_capacity_cents > 0);
  });

  test("high utilisation blocks it too, and the threshold is named", () => {
    const s = scoreAutopsyRow(row({ revolving_utilization_pct: "70", decline_reason: "high_utilization" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.FUNDABLE_AFTER_REPAIR);
    assert.match(s.assumptions.join(" "), new RegExp(`${ENGINE_THRESHOLDS.utilizationPct}%`));
  });

  test("a reason repair cannot move is not sold as repairable", () => {
    const s = scoreAutopsyRow(row({ fico_band: "600-639", decline_reason: "insufficient_revenue" }), { lenders: ANY_LENDER });
    assert.equal(s.bucket, BUCKETS.NOT_FUNDABLE);
  });

  test("no eligible lender is not fundable through our stack", () => {
    const restricted = [{ id: "l1", name: "NY only", active: true, eligible_states: ["NY"], bureaus_pulled: "EX" }];
    const s = scoreAutopsyRow(row({ state: "TX" }), { lenders: restricted });
    assert.equal(s.lender_match_count, 0);
    assert.equal(s.bucket, BUCKETS.NOT_FUNDABLE);
  });

  test("every row lands in exactly one bucket", () => {
    const rows = parseAutopsyRows({
      rows: [
        { row_label: "A", fico_band: "720+", state: "TX", highest_revolving_limit_usd: "10000", revolving_opened_month: "2015-01" },
        { row_label: "B", fico_band: "600-639", state: "TX", decline_reason: "credit_score", highest_revolving_limit_usd: "9000", revolving_opened_month: "2015-01" },
        { row_label: "C", fico_band: "unknown" },
        { row_label: "D", fico_band: "720+", state: "TX", highest_revolving_limit_usd: "1000", revolving_opened_month: "2015-01" }
      ]
    }).rows;
    const scored = scoreAutopsyRows(rows, { lenders: ANY_LENDER });
    assert.deepEqual(scored.map((s) => s.bucket), [
      BUCKETS.FUNDABLE_NOW,
      BUCKETS.FUNDABLE_AFTER_REPAIR,
      BUCKETS.NOT_ENOUGH_INFORMATION,
      BUCKETS.NOT_FUNDABLE
    ]);
    // and the scored rows still carry the parsed fields
    assert.equal(scored[0].row_label, "A");
  });
});
