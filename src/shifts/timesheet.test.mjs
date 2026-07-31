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
  hoursWorked,
  needsReview,
  timesheet as buildTimesheet,
  estimateSeconds,
  UNRECONSTRUCTABLE
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
    // UNRECONSTRUCTABLE / needsReview / timesheet were added when the auto-close
    // sweep gained the ability to close a shift it could not date the end of.
    // All three are about WHICH TIME COUNTS, which is this file's question. None
    // of them is a rate, and none multiplies anything.
    ["SECONDS_PER_HOUR", "UNRECONSTRUCTABLE", "estimateSeconds", "hoursWorked",
     "needsReview", "secondsWorked", "shiftSeconds", "timesheet"],
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

// =============================================================================
// A SHIFT SOFTWARE GUESSED THE END OF IS NOT A TIMESHEET FACT.
//
// autoCloseStale() falls back to started_at when there is no recorded activity,
// producing a zero-length closed shift. Today that is every forgotten shift
// belonging to anyone outside the Inquiry Remover desk, because no other screen
// writes telemetry. Read naively it says "worked no time", and it is identical
// on (started_at, ended_at) to a real 30-second shift.
// =============================================================================

const at = (iso) => new Date(iso);
const humanShift = (h) => ({
  id: "sh-human", started_at: at("2026-07-31T09:00:00Z"),
  ended_at: at(`2026-07-31T${String(9 + h).padStart(2, "0")}:00:00Z`), closed_by: null
});
const sweptWithEvidence = {
  id: "sh-evidence", started_at: at("2026-07-30T09:00:00Z"),
  ended_at: at("2026-07-30T17:00:00Z"), closed_by: "sweep_idle"
};
const sweptBlind = {
  id: "sh-blind", started_at: at("2026-07-29T09:00:00Z"),
  ended_at: at("2026-07-29T09:00:00Z"), closed_by: UNRECONSTRUCTABLE
};

test("needsReview is true only for the no-evidence auto-close", () => {
  assert.equal(needsReview(sweptBlind), true);
  assert.equal(needsReview(sweptWithEvidence), false, "an estimate with evidence is still the best answer there is");
  assert.equal(needsReview(humanShift(8)), false);
  assert.equal(needsReview({ started_at: at("2026-07-31T09:00:00Z"), ended_at: null, closed_by: null }), false,
    "a shift in progress is not under review");
  assert.equal(needsReview(null), false);
});

test("totalling an unreconstructable shift throws instead of reporting zero", () => {
  // The whole point. Zero looks like an answer. This file already refuses a
  // shift that ends before it starts for the same reason.
  assert.throws(() => shiftSeconds(sweptBlind), RangeError);
  assert.throws(() => secondsWorked([humanShift(8), sweptBlind]), /unknowable, not zero/);
  assert.throws(() => secondsWorked([sweptBlind]), /sh-blind/, "the error must name the row a human has to go and look at");
});

test("timesheet() counts what is known and hands back what is not", () => {
  const out = buildTimesheet([humanShift(8), sweptWithEvidence, sweptBlind]);
  assert.equal(out.seconds, 8 * 3600 + 8 * 3600, "8 clocked hours plus 8 estimated-with-evidence hours");
  assert.equal(out.hours, 16);
  assert.equal(out.counted, 2);
  assert.equal(out.needsReview.length, 1);
  assert.equal(out.needsReview[0].shift.id, "sh-blind", "the row comes back whole, so somebody can be shown it");
});

test("an unvouchable shift with no history to infer from is 0 and stays flagged", () => {
  const out = buildTimesheet([sweptBlind]);
  assert.equal(out.seconds, 0, "no confirmed time");
  assert.equal(out.counted, 0, "and the zero is not presented as a shift that was counted");
  assert.equal(out.estimatedSeconds, 0, "nothing to infer from — a first day has no record of its own");
  assert.equal(out.needsReview.length, 1, "and it is not silently discarded either");
  assert.equal(out.needsReview[0].method, "none", "the caller must be able to say WHY it is zero");
});

test("timesheet() on an ordinary week is just the total, with nothing to review", () => {
  const out = buildTimesheet([humanShift(8), humanShift(6)]);
  assert.equal(out.hours, 14);
  assert.equal(out.counted, 2);
  assert.deepEqual(out.needsReview, []);
});

test("timesheet() refuses anything that is not a list", () => {
  assert.throws(() => buildTimesheet(null), TypeError);
  assert.throws(() => buildTimesheet(humanShift(8)), TypeError);
});

// =============================================================================
// WHAT AN UNVOUCHABLE SHIFT IS WORTH.
//
// Zero is not available. The employer's own record is what failed, and under the
// FLSA (29 CFR 516.2 + Anderson v. Mt. Clemens Pottery) that failure does not
// transfer to the employee. The estimate is drawn from the person's own record —
// the median of their completed shifts — and is still flagged for a human.
// =============================================================================

test("an unvouchable shift is worth the median of that person's own completed shifts", () => {
  const history = [humanShift(6), humanShift(8), humanShift(10)];
  const est = estimateSeconds(sweptBlind, history);
  assert.equal(est.seconds, 8 * 3600, "the middle of 6, 8 and 10 is 8");
  assert.equal(est.method, "own_median");
  assert.equal(est.sampleSize, 3);
});

test("the median, not the mean — one 14-hour day does not stretch everybody's estimate", () => {
  const est = estimateSeconds(sweptBlind, [humanShift(7), humanShift(8), humanShift(9), humanShift(14)]);
  assert.equal(est.seconds, 8.5 * 3600, "the two middle values, averaged — the 14 is shrugged off");
  // A mean would be 9.5h. Over a payroll run that difference is real money.
  assert.notEqual(est.seconds, 9.5 * 3600);
});

test("zero-length rows are not evidence — they are the defect being repaired", () => {
  // A previously-swept shift already in the history reads as 0 seconds. Letting
  // it into the basis would drag every future estimate toward zero, which is the
  // employer's record-keeping failure compounding itself.
  const zeroRow = { id: "sh-zero", started_at: at("2026-07-28T09:00:00Z"), ended_at: at("2026-07-28T09:00:00Z"), closed_by: null };
  const est = estimateSeconds(sweptBlind, [humanShift(8), humanShift(8), zeroRow]);
  assert.equal(est.seconds, 8 * 3600);
  assert.equal(est.sampleSize, 2, "the zero row was excluded, not counted as a short day");
});

test("another unvouchable shift is not evidence either — that would be circular", () => {
  const est = estimateSeconds(sweptBlind, [humanShift(8), sweptBlind]);
  assert.equal(est.sampleSize, 1);
});

test("an open shift is not evidence — it has no span yet", () => {
  const est = estimateSeconds(sweptBlind, [humanShift(8), openShift()]);
  assert.equal(est.sampleSize, 1);
});

test("no history at all is method 'none' and zero — an unanswered flag, not a claim", () => {
  const est = estimateSeconds(sweptBlind, []);
  assert.equal(est.seconds, 0);
  assert.equal(est.method, "none");
  assert.equal(est.sampleSize, 0);
});

test("the estimate cannot exceed the moment the sweep observed the person gone", () => {
  // updated_at is stamped by the sweep on closing. They cannot have worked past
  // it. The bound almost never binds — the sweep only fires after the idle
  // threshold has elapsed — but it stops an absurd estimate on a tiny threshold.
  const shortWindow = {
    ...sweptBlind,
    started_at: at("2026-07-29T09:00:00Z"),
    ended_at: at("2026-07-29T09:00:00Z"),
    updated_at: at("2026-07-29T11:00:00Z")        // observed gone two hours in
  };
  const est = estimateSeconds(shortWindow, [humanShift(8), humanShift(8), humanShift(8)]);
  assert.equal(est.seconds, 2 * 3600, "capped at the observed window, not the 8-hour median");
});

test("timesheet keeps confirmed and estimated time as two separate numbers", () => {
  // A single figure would let a screen show inferred time as though somebody had
  // checked it. That is the whole reason these are not summed into one field.
  const out = buildTimesheet([humanShift(8), humanShift(8), sweptBlind]);
  assert.equal(out.hours, 16, "confirmed");
  assert.equal(out.estimatedHours, 8, "inferred from their own two 8-hour days");
  assert.equal(out.payableHours, 24, "and payable is the sum — the failed record is the employer's");
  assert.equal(out.counted, 2);
  assert.equal(out.needsReview.length, 1, "still flagged: the estimate is what is paid if nobody looks");
  assert.equal(out.needsReview[0].method, "own_median");
});

test("timesheet NEVER pays zero for a shift it has any basis to estimate", () => {
  // The one outcome that is not available. If this ever returns 0 payable
  // seconds for a person with a work history, the file has regressed into
  // letting the employer keep the benefit of its own missing record.
  const out = buildTimesheet([humanShift(8), sweptBlind]);
  assert.ok(out.payableSeconds > out.seconds, "the unvouchable shift must contribute something");
  assert.ok(out.estimatedSeconds > 0);
});

test("timesheet accepts a longer history to infer from than the period being totalled", () => {
  // A week with one forgotten day infers better from a fortnight.
  const week = [humanShift(4), sweptBlind];
  const fortnight = [humanShift(9), humanShift(9), humanShift(9), humanShift(4)];
  const out = buildTimesheet(week, { basis: fortnight });
  assert.equal(out.estimatedHours, 9, "the median of the longer record, not of the one short day in scope");
  assert.equal(buildTimesheet(week).estimatedHours, 4, "and without a basis it falls back to what is in scope");
});

test("an ordinary week reports no estimate and nothing to review", () => {
  const out = buildTimesheet([humanShift(8), humanShift(6)]);
  assert.equal(out.payableHours, 14);
  assert.equal(out.estimatedSeconds, 0);
  assert.deepEqual(out.needsReview, []);
});

test("estimateSeconds refuses a basis that is not a list", () => {
  assert.throws(() => estimateSeconds(sweptBlind, null), TypeError);
  assert.throws(() => estimateSeconds(sweptBlind, humanShift(8)), TypeError);
});
