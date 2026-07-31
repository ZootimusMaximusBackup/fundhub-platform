/* parseUtilizationThreshold — the band, and the refusals.
 *
 * WHAT THIS IS ABOUT. api/read/tradelines.mjs:65 accepted
 * `?utilization_threshold=` straight off the query string and handed
 * `Number(raw)` to calcFunding. That is one expression away from a product with
 * no guardrail at all: 0.99 makes `causedBreach` unreachable for any draw a real
 * card can carry, and "abc" becomes NaN, which loses every comparison and
 * reports no breach while looking exactly like a gate that ran.
 *
 * The band is a policy decision written down in the module that acts on the
 * number, so both callers (that endpoint and /api/finance/model) refuse the same
 * values with the same sentence. This file pins the edges of it, because an
 * off-by-one on a boundary here does not crash anything — it quietly widens the
 * door.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseUtilizationThreshold,
  UTILIZATION_THRESHOLD_MIN,
  UTILIZATION_THRESHOLD_MAX,
  UTILIZATION_THRESHOLD_REFUSALS,
  calcFunding
} from "./deal-funding.mjs";

describe("the values that are accepted", () => {

  test("the ordinary 30% line", () => {
    assert.deepEqual(parseUtilizationThreshold(0.30), { ok: true, value: 0.30, reason: null });
  });

  test("a string, because a query parameter is always a string", () => {
    assert.equal(parseUtilizationThreshold("0.25").value, 0.25);
    assert.equal(parseUtilizationThreshold(" 0.25 ").value, 0.25);
  });

  test("both edges of the band are IN the band", () => {
    assert.equal(parseUtilizationThreshold(UTILIZATION_THRESHOLD_MIN).ok, true);
    assert.equal(parseUtilizationThreshold(UTILIZATION_THRESHOLD_MAX).ok, true);
  });
});

describe("the values that are refused, and named", () => {

  test("0.99 — the value that switched the hard stop off", () => {
    const r = parseUtilizationThreshold(0.99);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "above_maximum");
    assert.equal(r.value, null, "a refused threshold must not carry a usable number");
  });

  test("just past each edge", () => {
    assert.equal(parseUtilizationThreshold(UTILIZATION_THRESHOLD_MAX + 0.01).reason, "above_maximum");
    assert.equal(parseUtilizationThreshold(UTILIZATION_THRESHOLD_MIN - 0.001).reason, "below_minimum");
  });

  test("percent units are refused rather than divided by a hundred", () => {
    // 30 could be 30% or 3000% and money.mjs really does use percent units
    // elsewhere in this repo. Guessing is not available; saying so is.
    assert.equal(parseUtilizationThreshold(30).reason, "not_a_fraction");
    assert.match(UTILIZATION_THRESHOLD_REFUSALS.not_a_fraction, /0\.30 means 30%/);
  });

  test("NaN by any route — this is the one that hid", () => {
    assert.equal(parseUtilizationThreshold("abc").reason, "not_a_number");
    assert.equal(parseUtilizationThreshold(NaN).reason, "not_a_number");
    assert.equal(parseUtilizationThreshold(Infinity).reason, "not_a_number");
  });

  test("things that are not numbers but survive Number()", () => {
    // Number(true) is 1 and Number([]) is 0; neither is a threshold anybody
    // typed, and both would otherwise land inside or beside the band.
    assert.equal(parseUtilizationThreshold(true).reason, "not_a_number");
    assert.equal(parseUtilizationThreshold([]).reason, "not_a_number");
    assert.equal(parseUtilizationThreshold({}).reason, "not_a_number");
  });

  test("absent is its own answer — it is not an error, it is 'nobody said'", () => {
    for (const v of [null, undefined, "", "   "]) {
      assert.equal(parseUtilizationThreshold(v).reason, "absent");
    }
  });

  test("every refusal has a sentence a person can act on", () => {
    for (const reason of ["absent", "not_a_number", "not_a_fraction", "below_minimum", "above_maximum"]) {
      assert.equal(typeof UTILIZATION_THRESHOLD_REFUSALS[reason], "string");
      assert.ok(UTILIZATION_THRESHOLD_REFUSALS[reason].length > 20, `${reason} has no explanation`);
    }
  });
});

describe("the band is the band the guardrail actually uses", () => {

  test("a threshold this parser accepts is one calcFunding applies unchanged", () => {
    const parsed = parseUtilizationThreshold("0.25");
    const r = calcFunding({
      cards: [{ lender: "X", creditLimit: 10000, currentBalance: 0, apr: 0.2 }],
      requestedAmount: 3000,
      utilizationThreshold: parsed.value
    });
    assert.equal(r.guardrail.threshold, 0.25);
    // 30% after the draw, against a 25% line, caused entirely by the draw.
    assert.equal(r.guardrail.hardStop, true);
  });

  test("and the refused 0.99 would indeed have hidden that same breach", () => {
    // Not a test of the parser — a test of WHY the parser exists. If this ever
    // stops being true the band can be revisited; while it is true, the band is
    // the only thing standing between a URL and a disabled guardrail.
    const r = calcFunding({
      cards: [{ lender: "X", creditLimit: 10000, currentBalance: 0, apr: 0.2 }],
      requestedAmount: 3000,
      utilizationThreshold: 0.99
    });
    assert.equal(r.guardrail.hardStop, false);
  });
});
