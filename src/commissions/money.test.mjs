import { test } from "node:test";
import assert from "node:assert";
import {
  toCents, fromCents, percentOf, applySplit, wholeUnits, clampAmount, roundHalfUp
} from "./money.mjs";

test("toCents: numbers, numeric strings and pg numerics all land on cents", () => {
  assert.equal(toCents(32), 3200);
  assert.equal(toCents("3000.00"), 300000);
  assert.equal(toCents(" 1234.56 "), 123456);
  assert.equal(toCents(0.1), 10);
});

test("toCents: absent value is zero, because 'no payments yet' is a real zero", () => {
  assert.equal(toCents(null), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents(""), 0);
});

test("toCents: garbage throws rather than becoming NaN cents", () => {
  assert.throws(() => toCents("three thousand"), TypeError);
  assert.throws(() => toCents({}), TypeError);
});

test("toCents: absurd amounts are rejected, not silently computed", () => {
  assert.throws(() => toCents(2_000_000_000), RangeError);
});

test("toCents: the classic float trap does not reach the ledger", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in float. Cents make it exact.
  assert.equal(toCents(0.1) + toCents(0.2), toCents(0.3));
});

test("fromCents: fixed 2dp, ready for numeric(14,2)", () => {
  assert.equal(fromCents(300000), "3000.00");
  assert.equal(fromCents(5), "0.05");
  assert.equal(fromCents(0), "0.00");
  assert.equal(fromCents(-50000), "-500.00");
});

test("roundHalfUp: symmetric around zero so a reversal exactly cancels", () => {
  assert.equal(roundHalfUp(0.5), 1);
  assert.equal(roundHalfUp(-0.5), -1);
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(-2.5), -3);
  // Math.round(-0.5) is -0, which is the bug this exists to avoid.
  assert.notEqual(roundHalfUp(-0.5), Math.round(-0.5));
});

test("percentOf: percent units, not fractions — 0.25 means a quarter of one percent", () => {
  assert.equal(percentOf(toCents(50000), 0.25), toCents(125));   // 0.25% of $50,000
  assert.equal(percentOf(toCents(30000), 10), toCents(3000));    // 10% success fee
  assert.equal(percentOf(toCents(1000), 100), toCents(1000));
  assert.equal(percentOf(0, 10), 0);
});

test("percentOf: a negative rate is a configuration error, not a clawback", () => {
  assert.throws(() => percentOf(1000, -5), RangeError);
});

test("applySplit: two people on one deal", () => {
  assert.equal(applySplit(toCents(500), 50), toCents(250));
  assert.equal(applySplit(toCents(500), 100), toCents(500));
  assert.equal(applySplit(toCents(333.33), 50), 16667); // 16666.5 -> half up
});

test("applySplit: out-of-range splits throw", () => {
  assert.throws(() => applySplit(1000, 0), RangeError);
  assert.throws(() => applySplit(1000, 101), RangeError);
});

test("wholeUnits: partial units do not pay", () => {
  assert.equal(wholeUnits(toCents(3000), toCents(3000)), 1);
  assert.equal(wholeUnits(toCents(5999), toCents(3000)), 1);
  assert.equal(wholeUnits(toCents(6000), toCents(3000)), 2);
  assert.equal(wholeUnits(toCents(2999), toCents(3000)), 0);
});

test("clampAmount: guardrails apply on magnitude, both directions", () => {
  assert.equal(clampAmount(toCents(50), toCents(100), null), toCents(100));
  assert.equal(clampAmount(toCents(5000), null, toCents(1000)), toCents(1000));
  assert.equal(clampAmount(toCents(500), null, null), toCents(500));
  // A reversal is clamped identically, so it stays equal and opposite.
  assert.equal(clampAmount(toCents(-5000), null, toCents(1000)), toCents(-1000));
});

test("clampAmount: a floor does not manufacture commission out of a zero base", () => {
  assert.equal(clampAmount(0, toCents(500), null), 0);
});
