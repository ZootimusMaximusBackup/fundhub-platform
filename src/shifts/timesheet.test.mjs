// Timesheet + comp math. Pure, exhaustive, and deliberately paranoid: this is
// the file that decides what lands in a person's pay, and every assertion below
// is a rule someone could otherwise "simplify" into a rounding error.
//
// Assertion style follows src/commissions/money.test.mjs — plain assert.equal /
// assert.throws, titles that state the rule rather than name the function.

import { test } from "node:test";
import assert from "node:assert";
import { toCents } from "../commissions/money.mjs";
import {
  ADVISOR_HOURLY_RATE_CENTS,
  SECONDS_PER_HOUR,
  FUNDED_PERCENT,
  CLOSER_DEPOSIT_UNIT_CENTS,
  CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS,
  shiftSeconds,
  secondsWorked,
  hoursWorked,
  hourlyCents,
  advisorComp,
  closerComp
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
const componentFor = (result, key) => result.components.find((c) => c.key === key);

// --- the rates are the rates -------------------------------------------------

test("rates are named constants in cents, not magic numbers: $6.25/hr, $500, $3,000", () => {
  assert.equal(ADVISOR_HOURLY_RATE_CENTS, toCents(6.25));
  assert.equal(CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS, toCents(500));
  assert.equal(CLOSER_DEPOSIT_UNIT_CENTS, toCents(3000));
  assert.equal(SECONDS_PER_HOUR, 3600);
});

test("FUNDED_PERCENT is percent units for percentOf, not a fraction — 0.25 means 0.25%", () => {
  assert.equal(FUNDED_PERCENT, 0.25);
  // The trap: 0.0025 would pay a hundredth of the intended amount and never throw.
  assert.notEqual(FUNDED_PERCENT, 0.0025);
  assert.equal(componentFor(advisorComp({ secondsLogged: 0, fundedCents: toCents(100000) }), "funded_percent").cents,
    toCents(250), "0.25% of $100,000 is $250");
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
  // 20 minutes: a repeating decimal in hours, an exact integer in seconds. The
  // pay path uses the seconds; this number is for a screen.
  assert.equal(secondsWorked([{ started_at: "2026-07-30T09:00:00Z", ended_at: "2026-07-30T09:20:00Z" }]), 1200);
});

test("shiftSeconds: a shift that ends before it starts throws rather than paying zero", () => {
  assert.throws(() => shiftSeconds({
    started_at: "2026-07-30T17:00:00Z",
    ended_at: "2026-07-30T09:00:00Z"
  }), RangeError);
});

test("shiftSeconds: garbage timestamps throw rather than becoming NaN cents", () => {
  assert.throws(() => shiftSeconds({ started_at: "yesterday", ended_at: "2026-07-30T09:00:00Z" }), TypeError);
  assert.throws(() => shiftSeconds({ started_at: "2026-07-30T09:00:00Z", ended_at: "whenever" }), TypeError);
  assert.throws(() => shiftSeconds({ started_at: new Date("nope"), ended_at: null }), TypeError);
  assert.throws(() => shiftSeconds({ ended_at: "2026-07-30T09:00:00Z" }), TypeError, "no started_at at all");
});

test("shiftSeconds: an epoch number is refused, because seconds and ms are a 1000x pay error", () => {
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

// --- the wage line ------------------------------------------------------------

test("hourlyCents: $6.25 an hour, exactly, at whole hours", () => {
  assert.equal(hourlyCents(0), 0);
  assert.equal(hourlyCents(3600), toCents(6.25));
  assert.equal(hourlyCents(8 * 3600), toCents(50));
  assert.equal(hourlyCents(40 * 3600), toCents(250));
});

test("hourlyCents: a part hour is paid to the cent, half up, once", () => {
  assert.equal(hourlyCents(1800), 313, "half an hour is 312.5c, rounded half up");
  assert.equal(hourlyCents(900), 156, "quarter hour is 156.25c -> 156");
  assert.equal(hourlyCents(1), 0, "one second is 0.17c -> 0");
  assert.equal(hourlyCents(3), 1, "three seconds is 0.52c -> 1");
});

test("hourlyCents: the rounding happens once, on the total, not per shift", () => {
  // Three 30-minute shifts. 3 x 312.5c rounded per shift would be 939c; rounded
  // once on 5400 seconds it is 937.5c -> 938c. The seconds are summed first.
  const rows = [shift(0.5), shift(0.5), shift(0.5)];
  assert.equal(secondsWorked(rows), 5400);
  assert.equal(hourlyCents(secondsWorked(rows)), 938);
  assert.notEqual(hourlyCents(secondsWorked(rows)), 3 * hourlyCents(1800));
});

test("hourlyCents: negative or fractional seconds throw rather than becoming NaN cents", () => {
  assert.throws(() => hourlyCents(-3600), RangeError);
  assert.throws(() => hourlyCents(1800.5), TypeError);
  assert.throws(() => hourlyCents("3600"), TypeError);
  assert.throws(() => hourlyCents(NaN), TypeError);
  assert.throws(() => hourlyCents(null), TypeError);
});

// --- advisor ------------------------------------------------------------------

test("advisorComp: $6.25/hr on logged time plus 0.25% of funded", () => {
  const c = advisorComp({ secondsLogged: 40 * 3600, fundedCents: toCents(150000) });
  assert.equal(componentFor(c, "hourly").cents, toCents(250));
  assert.equal(componentFor(c, "funded_percent").cents, toCents(375));
  assert.equal(c.base_cents, toCents(625));
  assert.equal(c.total_cents, toCents(625));
  assert.equal(c.role, "funding_advisor");
});

test("advisorComp: zero hours and zero funded is zero, not an error", () => {
  const c = advisorComp({ secondsLogged: 0, fundedCents: 0 });
  assert.equal(c.base_cents, 0);
  assert.equal(c.total_cents, 0);
});

test("advisorComp: an unknown funded amount stays unknown and does not pay 0.25% of nothing", () => {
  const c = advisorComp({ secondsLogged: 3600, fundedCents: null });
  assert.equal(componentFor(c, "hourly").cents, toCents(6.25), "the wage is still known");
  assert.equal(componentFor(c, "funded_percent").cents, null);
  assert.equal(c.base_cents, null, "an unknown line makes the total unknown, never a confident 0");
  assert.equal(c.total_cents, null);
});

test("advisorComp: unknown hours are unknown too, and zero funded is still a real zero", () => {
  const unknownTime = advisorComp({ fundedCents: 0 });
  assert.equal(componentFor(unknownTime, "hourly").cents, null);
  assert.equal(componentFor(unknownTime, "funded_percent").cents, 0, "nothing funded is a fact, not a gap");
  assert.equal(unknownTime.total_cents, null);
});

test("advisorComp: garbage and negatives throw rather than becoming NaN cents", () => {
  assert.throws(() => advisorComp({ secondsLogged: "40", fundedCents: 0 }), TypeError);
  assert.throws(() => advisorComp({ secondsLogged: 3600, fundedCents: "150000.00" }), TypeError,
    "dollars-as-a-string is not cents");
  assert.throws(() => advisorComp({ secondsLogged: 3600, fundedCents: 1234.5 }), TypeError);
  assert.throws(() => advisorComp({ secondsLogged: -1, fundedCents: 0 }), RangeError);
  assert.throws(() => advisorComp({ secondsLogged: 0, fundedCents: -100 }), RangeError);
  assert.throws(() => advisorComp({ secondsLogged: NaN, fundedCents: 0 }), TypeError);
});

// --- closer -------------------------------------------------------------------

test("closerComp: a deposit of exactly $3,000 pays exactly one $500 flat", () => {
  const c = closerComp({ depositsCents: toCents(3000), fundedCents: 0 });
  const flat = componentFor(c, "deposit_flat");
  assert.equal(flat.units, 1);
  assert.equal(flat.cents, toCents(500));
  assert.equal(c.total_cents, toCents(500));
});

test("closerComp: partial blocks do not pay — $5,999 is one unit, not 1.99", () => {
  assert.equal(componentFor(closerComp({ depositsCents: toCents(5999), fundedCents: 0 }), "deposit_flat").cents,
    toCents(500));
  assert.equal(componentFor(closerComp({ depositsCents: toCents(2999), fundedCents: 0 }), "deposit_flat").cents, 0);
  assert.equal(componentFor(closerComp({ depositsCents: 1, fundedCents: 0 }), "deposit_flat").cents, 0,
    "one cent of deposit is not a $3,000 block");
});

test("closerComp: READING A — the flat scales per whole $3K block ($6,000 pays $1,000)", () => {
  // *** THE AMBIGUITY. src/commissions/calculate.mjs case 'flat' (CHRIS
  // PROVISIONAL #1) implements the other reading and would pay $500 here. This
  // assertion exists to make the disagreement visible and deliberate rather
  // than something discovered on a payout report. See the box in timesheet.mjs.
  assert.equal(componentFor(closerComp({ depositsCents: toCents(6000), fundedCents: 0 }), "deposit_flat").cents,
    toCents(1000));
  assert.equal(componentFor(closerComp({ depositsCents: toCents(9000), fundedCents: 0 }), "deposit_flat").units, 3);
});

test("closerComp: no deposit means no flat, and no funding means no percentage", () => {
  const c = closerComp({ depositsCents: 0, fundedCents: 0 });
  assert.equal(componentFor(c, "deposit_flat").cents, 0);
  assert.equal(componentFor(c, "funded_percent").cents, 0);
  assert.equal(c.total_cents, 0);
});

test("closerComp: the deposit flat and the 0.25% of funded are separate lines that sum", () => {
  const c = closerComp({ depositsCents: toCents(3000), fundedCents: toCents(200000) });
  assert.equal(componentFor(c, "deposit_flat").cents, toCents(500));
  assert.equal(componentFor(c, "funded_percent").cents, toCents(500));
  assert.equal(c.base_cents, toCents(1000));
  assert.equal(c.role, "closer");
});

test("closerComp: an unknown deposit total stays unknown rather than paying no flat", () => {
  const c = closerComp({ depositsCents: null, fundedCents: toCents(100000) });
  assert.equal(componentFor(c, "deposit_flat").cents, null);
  assert.equal(componentFor(c, "deposit_flat").units, null);
  assert.equal(componentFor(c, "funded_percent").cents, toCents(250));
  assert.equal(c.total_cents, null);
});

test("closerComp: garbage and negatives throw rather than becoming NaN cents", () => {
  assert.throws(() => closerComp({ depositsCents: "3000.00", fundedCents: 0 }), TypeError);
  assert.throws(() => closerComp({ depositsCents: 300000.5, fundedCents: 0 }), TypeError);
  assert.throws(() => closerComp({ depositsCents: -300000, fundedCents: 0 }), RangeError);
  assert.throws(() => closerComp({ depositsCents: 0, fundedCents: NaN }), TypeError);
  assert.throws(() => closerComp({ depositsCents: {}, fundedCents: 0 }), TypeError);
});

test("closerComp: called with nothing at all, every line is unknown and nothing is paid", () => {
  const c = closerComp();
  assert.equal(c.base_cents, null);
  assert.equal(c.total_cents, null);
  assert.equal(advisorComp().total_cents, null);
});

// --- the bonus seam -----------------------------------------------------------

test("comp returns a component breakdown a bonus layer can extend without a rewrite", () => {
  const c = advisorComp({ secondsLogged: 3600, fundedCents: toCents(100000) });
  assert.equal(Array.isArray(c.components), true);
  assert.equal(c.components.length, 2);
  for (const line of c.components) {
    assert.equal(typeof line.key, "string");
    assert.ok("cents" in line);
    assert.equal(typeof line.basis, "string", "every line states what it was computed from");
    assert.ok("basis_value" in line, "and the value it used, so a payout row is auditable");
  }
});

test("no bonus, tier, accelerator or multiplier is modelled here — total is exactly the base", () => {
  const cases = [
    advisorComp({ secondsLogged: 40 * 3600, fundedCents: toCents(1000000) }),
    advisorComp({ secondsLogged: 1, fundedCents: 1 }),
    closerComp({ depositsCents: toCents(30000), fundedCents: toCents(5000000) }),
    closerComp({ depositsCents: 0, fundedCents: 0 })
  ];
  for (const c of cases) {
    assert.equal(c.total_cents, c.base_cents,
      "this file must never make these differ — that is the bonus layer's job");
    assert.equal("bonus_cents" in c, false, "no invented bonus key, not even a zero one");
    assert.equal(c.components.some((l) => /bonus|tier|accel|multiplier/i.test(l.key)), false);
  }
});

// --- the float trap -----------------------------------------------------------

test("the classic float trap does not reach a paycheque", () => {
  // 0.1 + 0.2 !== 0.3 in float. Every number above is an integer of cents or of
  // seconds, so a week of odd shifts adds up exactly. Three 20-minute shifts —
  // a third of an hour each, which has no exact decimal representation in hours
  // and an exact one in seconds.
  const twenty = (h) => ({ started_at: `2026-07-30T${h}:00:00Z`, ended_at: `2026-07-30T${h}:20:00Z` });
  const rows = [twenty("09"), twenty("11"), twenty("13")];
  assert.equal(secondsWorked(rows), 3600, "three exact thirds of an hour are one hour of seconds");
  assert.equal(hourlyCents(secondsWorked(rows)), toCents(6.25));
  // And the reason the pay path never touches hoursWorked(): 20 minutes has no
  // exact decimal representation in hours, so a rate multiplied by it is a
  // rounding argument waiting to happen.
  assert.equal(hoursWorked(rows.slice(0, 1)), 1 / 3);
  assert.notEqual(hoursWorked(rows.slice(0, 1)) * 6.25 * 100, 208,
    "$6.25 x a third of an hour in floats is 208.33333333333331 cents, not a payable number");
});
