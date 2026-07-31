// Timesheet. Pure, exhaustive, and deliberately paranoid: this file decides how
// much time a person is recorded as having worked, and every assertion below is
// a rule someone could otherwise "simplify" into a wrong number.
//
// There is no compensation math here any more, and the last test in this file
// is what keeps it that way. See the header of timesheet.mjs for why.
//
// Assertion style follows src/commissions/money.test.mjs — plain assert.equal /
// assert.throws, titles that state the rule rather than name the function.

import { test } from "node:test";
import assert from "node:assert";
import * as timesheet from "./timesheet.mjs";
import {
  SECONDS_PER_HOUR,
  shiftSeconds,
  secondsWorked,
  hoursWorked
} from "./timesheet.mjs";

// A closed shift of exactly `hours` hours, as a pg row would arrive (Date
// objects, snake_case columns).
const shift = (hours, startIso = "2026-07-30T09:00:00.000Z") => ({
  started_at: new Date(startIso),
  ended_at: new Date(Date.parse(startIso) + hours * 3600 * 1000)
});
const openShift = (startIso = "2026-07-30T09:00:00.000Z") => ({
  started_at: new Date(startIso),
  ended_at: null
});

// --- time ---------------------------------------------------------------------

test("shiftSeconds: a closed shift is its own elapsed seconds, to the second", () => {
  assert.equal(shiftSeconds(shift(8)), 8 * 3600);
  assert.equal(shiftSeconds({
    started_at: "2026-07-30T09:00:00.000Z",
    ended_at: "2026-07-30T09:00:01.000Z"
  }), 1, "ISO strings are accepted as well as Dates");
});

test("shiftSeconds: an open shift contributes nothing — not 'now minus started_at'", () => {
  assert.equal(shiftSeconds(openShift()), 0);
  assert.equal(shiftSeconds({ started_at: new Date("2026-07-30T09:00:00Z") }), 0,
    "an absent ended_at reads the same as an explicit null");
});

test("hoursWorked: an open shift in the middle of a week does not inflate the week", () => {
  assert.equal(hoursWorked([shift(8), openShift(), shift(4)]), 12);
});

test("secondsWorked: partial seconds are floored per shift, so ms jitter cannot wobble a total", () => {
  const s = {
    started_at: new Date("2026-07-30T09:00:00.000Z"),
    ended_at: new Date("2026-07-30T09:00:00.999Z")
  };
  assert.equal(shiftSeconds(s), 0);
  assert.equal(secondsWorked([s, s, s]), 0, "three 999ms shifts are still zero whole seconds");
});

test("secondsWorked: no shifts is zero, which is a real answer and not an error", () => {
  assert.equal(secondsWorked([]), 0);
  assert.equal(hoursWorked([]), 0);
});

test("hoursWorked: the hours figure is exact division and is never the thing multiplied by a rate", () => {
  assert.equal(hoursWorked([shift(0.5)]), 0.5);
  // 20 minutes: a repeating decimal in hours, an exact integer in seconds.
  // Whatever eventually pays for time uses the seconds; this number is for a screen.
  assert.equal(secondsWorked([{ started_at: "2026-07-30T09:00:00Z", ended_at: "2026-07-30T09:20:00Z" }]), 1200);
});

test("shiftSeconds: a shift that ends before it starts throws rather than reporting zero", () => {
  assert.throws(() => shiftSeconds({
    started_at: "2026-07-30T17:00:00Z",
    ended_at: "2026-07-30T09:00:00Z"
  }), RangeError);
});

test("shiftSeconds: garbage timestamps throw rather than becoming NaN", () => {
  assert.throws(() => shiftSeconds({ started_at: "yesterday", ended_at: "2026-07-30T09:00:00Z" }), TypeError);
  assert.throws(() => shiftSeconds({ started_at: "2026-07-30T09:00:00Z", ended_at: "whenever" }), TypeError);
  assert.throws(() => shiftSeconds({ started_at: new Date("nope"), ended_at: null }), TypeError);
  assert.throws(() => shiftSeconds({ ended_at: "2026-07-30T09:00:00Z" }), TypeError, "no started_at at all");
});

test("shiftSeconds: an epoch number is refused, because seconds and ms are a 1000x error", () => {
  assert.throws(() => shiftSeconds({ started_at: 1785000000, ended_at: 1785003600 }), TypeError);
});

test("shiftSeconds: camelCase keys throw instead of silently timing from undefined", () => {
  assert.throws(() => shiftSeconds({ startedAt: "2026-07-30T09:00:00Z", endedAt: "2026-07-30T17:00:00Z" }), TypeError);
});

test("secondsWorked: a non-array, including null, throws rather than reading as no shifts", () => {
  assert.throws(() => secondsWorked(null), TypeError);
  assert.throws(() => secondsWorked(undefined), TypeError);
  assert.throws(() => secondsWorked({ started_at: "2026-07-30T09:00:00Z" }), TypeError);
  assert.throws(() => shiftSeconds(null), TypeError);
  assert.throws(() => shiftSeconds([]), TypeError, "an array is not a shift row");
});

// --- no money lives here ------------------------------------------------------

/* This module used to export advisorComp(), closerComp(), hourlyCents() and the
   four rates they needed. All of it was deleted on 2026-07-31: the two
   commission rates belong in commission_rules ("every rate is a row, there are
   no rates in code" — 013_commission_rules.sql:1) and the hourly wage is not
   modelled anywhere in this system, because commission_rules cannot express it.

   This test is the guard. Re-adding a rate constant or a comp function here
   recreates a second, divergent answer to a question src/commissions/ already
   owns — which is exactly the defect that was removed: closerComp() paid $1,000
   on a $6,000 deposit where calculate.mjs pays $500. */
test("timesheet exports time only — no rate, no comp function, no money import", () => {
  assert.deepEqual(
    Object.keys(timesheet).sort(),
    ["SECONDS_PER_HOUR", "hoursWorked", "secondsWorked", "shiftSeconds"],
    "a new export here is either time or it is in the wrong file"
  );
  assert.equal(SECONDS_PER_HOUR, 3600, "not money — the divisor that makes hoursWorked a formula");

  // Named individually so a failure says which one came back.
  for (const gone of [
    "advisorComp", "closerComp", "hourlyCents",
    "ADVISOR_HOURLY_RATE_CENTS", "FUNDED_PERCENT",
    "CLOSER_DEPOSIT_UNIT_CENTS", "CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS"
  ]) {
    assert.equal(timesheet[gone], undefined,
      `${gone} is back. Rates are rows in commission_rules; the calculator is src/commissions/calculate.mjs.`);
  }
});
