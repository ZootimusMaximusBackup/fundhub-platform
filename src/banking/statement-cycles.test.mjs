// Unit tests for statement-cycle arithmetic. PURE — no database, no clock, no
// network. Every test pins `today` and asserts an exact date string.
//
// WHAT THESE TESTS ARE FOR. The month-end rule is the whole reason this module
// exists, and the failure it prevents is silent: a due date that lands in the
// wrong month still looks like a date, and a payment planned around it is late
// with no error anywhere. So the tests below pin the boundary cases by hand —
// 31 January into February, leap years, December rolling into January — rather
// than trusting a Date object to do it.
//
// SEVERAL TESTS ASSERT AN ABSENCE. A missing due day must produce null AND a
// named reason, never a guessed date. Following recurring.test.mjs's lesson from
// AUDIT-FINDINGS: assert the over-broad direction too, or a module that answers
// when it should refuse passes happily for months.

import { test } from "node:test";
import assert from "node:assert";

import {
  daysInMonth,
  clampDayToMonth,
  parseIsoDate,
  formatIsoDate,
  nextOccurrence,
  daysBetween,
  nextDueDate,
  nextStatementClose,
  UNKNOWN_REASONS
} from "./statement-cycles.mjs";

/* ---------------------------------------------------------------- calendar */

test("daysInMonth knows the short months and leap years", () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29, "2024 is a leap year");
  assert.equal(daysInMonth(2000, 2), 29, "2000 is a leap year — divisible by 400");
  assert.equal(daysInMonth(1900, 2), 28, "1900 is NOT a leap year — divisible by 100, not 400");
  assert.equal(daysInMonth(2026, 4), 30);
});

test("daysInMonth uses human 1-12 months, not Date's 0-11", () => {
  // If this module ever slipped to 0-based internally, month 12 would read as
  // January of the next year and return 31 instead of 31 — indistinguishable.
  // Month 2 is the one that catches it.
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.throws(() => daysInMonth(2026, 0), TypeError, "month 0 is not a month");
  assert.throws(() => daysInMonth(2026, 13), TypeError);
});

test("clampDayToMonth clamps rather than spilling into the next month", () => {
  assert.equal(clampDayToMonth(2026, 2, 31), 28);
  assert.equal(clampDayToMonth(2024, 2, 31), 29);
  assert.equal(clampDayToMonth(2026, 4, 31), 30);
  assert.equal(clampDayToMonth(2026, 1, 31), 31, "a real day is left alone");
  assert.equal(clampDayToMonth(2026, 1, 5), 5);
});

/* ------------------------------------------------------------------ parsing */

test("parseIsoDate rejects rather than guessing", () => {
  assert.deepEqual(parseIsoDate("2026-07-31"), { year: 2026, month: 7, day: 31 });
  assert.equal(parseIsoDate("2026-02-30"), null, "30 February is not a date");
  assert.equal(parseIsoDate("2026-13-01"), null);
  assert.equal(parseIsoDate("2026-7-1"), null, "unpadded is not the format");
  assert.equal(parseIsoDate("not a date"), null);
  assert.equal(parseIsoDate(null), null);
  assert.equal(parseIsoDate(new Date()), null, "a Date object is not an ISO string");
});

test("formatIsoDate round-trips parseIsoDate", () => {
  for (const iso of ["2026-07-31", "2024-02-29", "2026-01-01", "2026-12-31"]) {
    assert.equal(formatIsoDate(parseIsoDate(iso)), iso);
  }
});

/* --------------------------------------------------------- next occurrence */

test("nextOccurrence returns today when the day is today", () => {
  // ON OR AFTER, not strictly after. A payment due today is the one that
  // matters most; pushing it to next month would hide it.
  assert.equal(nextOccurrence(15, "2026-07-15"), "2026-07-15");
});

test("nextOccurrence stays in this month when the day is still ahead", () => {
  assert.equal(nextOccurrence(20, "2026-07-15"), "2026-07-20");
});

test("nextOccurrence rolls to next month when the day has passed", () => {
  assert.equal(nextOccurrence(4, "2026-07-15"), "2026-08-04");
});

test("nextOccurrence rolls December into January of the next year", () => {
  assert.equal(nextOccurrence(4, "2026-12-15"), "2027-01-04");
});

test("nextOccurrence clamps day 31 into February — the whole point of the module", () => {
  assert.equal(nextOccurrence(31, "2026-02-01"), "2026-02-28");
  assert.equal(nextOccurrence(31, "2024-02-01"), "2024-02-29", "leap year");
  // And the case that proves it clamps rather than spills: asking on 28 Feb for
  // a day-31 cycle must return 28 Feb, NOT 3 March.
  assert.equal(nextOccurrence(31, "2026-02-28"), "2026-02-28");
});

test("nextOccurrence clamps into a 30-day month", () => {
  assert.equal(nextOccurrence(31, "2026-04-10"), "2026-04-30");
});

test("nextOccurrence refuses a day that is not a day", () => {
  assert.equal(nextOccurrence(0, "2026-07-15"), null);
  assert.equal(nextOccurrence(32, "2026-07-15"), null);
  assert.equal(nextOccurrence(null, "2026-07-15"), null);
  assert.equal(nextOccurrence(15.5, "2026-07-15"), null);
  assert.equal(nextOccurrence(15, "garbage"), null);
});

/* ------------------------------------------------------------ daysBetween */

test("daysBetween counts whole calendar days in both directions", () => {
  assert.equal(daysBetween("2026-07-15", "2026-07-20"), 5);
  assert.equal(daysBetween("2026-07-15", "2026-07-15"), 0);
  assert.equal(daysBetween("2026-07-20", "2026-07-15"), -5, "a past date is negative");
  assert.equal(daysBetween("2026-02-27", "2026-03-01"), 2, "across a short month");
  assert.equal(daysBetween("2024-02-27", "2024-03-01"), 3, "across a leap February");
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1, "across a year");
});

test("daysBetween survives a daylight-saving boundary", () => {
  // US DST starts 8 March 2026. A Date-arithmetic implementation loses an hour
  // here and Math.floor's it to 20 days.
  assert.equal(daysBetween("2026-03-01", "2026-03-21"), 20);
});

test("daysBetween returns null on unparseable input rather than NaN", () => {
  assert.equal(daysBetween("nope", "2026-07-15"), null);
  assert.equal(daysBetween("2026-07-15", null), null);
});

/* -------------------------------------------------------------- nextDueDate */

test("nextDueDate answers with a date and a countdown", () => {
  const out = nextDueDate({ payment_due_day: 20 }, { today: "2026-07-15" });
  assert.deepEqual(out, { dueOn: "2026-07-20", daysAway: 5, unknownReason: null });
});

test("nextDueDate NEVER guesses when the due day is missing", () => {
  for (const cycle of [{}, { payment_due_day: null }, { payment_due_day: undefined }]) {
    const out = nextDueDate(cycle, { today: "2026-07-15" });
    assert.equal(out.dueOn, null, "no invented date");
    assert.equal(out.daysAway, null);
    assert.equal(out.unknownReason, UNKNOWN_REASONS.NO_DUE_DAY,
      "an unanswerable question gets a NAMED reason, not a bare null");
  }
});

test("nextDueDate refuses an invalid reference date instead of falling back to now", () => {
  const out = nextDueDate({ payment_due_day: 20 }, { today: "not-a-date" });
  assert.equal(out.dueOn, null);
  assert.equal(out.unknownReason, UNKNOWN_REASONS.BAD_TODAY);
  // And with no `today` at all — the module must not reach for the clock.
  assert.equal(nextDueDate({ payment_due_day: 20 }).unknownReason, UNKNOWN_REASONS.BAD_TODAY);
});

test("nextDueDate applies the month-end rule", () => {
  const out = nextDueDate({ payment_due_day: 31 }, { today: "2026-02-10" });
  assert.equal(out.dueOn, "2026-02-28");
});

test("nextDueDate takes 096's column names verbatim", () => {
  // A row read straight out of the database must work with no mapping layer in
  // between, because a mapping layer is a thing that drifts when a column moves.
  const rowFromDb = {
    id: "…", org_id: "…", client_id: "…", bank_account_id: "…",
    statement_close_day: 5, payment_due_day: 2,
    last_statement_date: "2026-07-05", last_statement_balance_cents: 233517,
    minimum_payment_cents: 4670, apr: "0.21860", source: "manual"
  };
  assert.equal(nextDueDate(rowFromDb, { today: "2026-07-15" }).dueOn, "2026-08-02");
  assert.equal(nextStatementClose(rowFromDb, { today: "2026-07-15" }).closesOn, "2026-08-05");
});

/* ------------------------------------------------------- nextStatementClose */

test("nextStatementClose is independent of the due date", () => {
  // A card can have one known and the other not. Answering for the missing one
  // by borrowing the other would be an invention.
  const out = nextStatementClose({ payment_due_day: 2 }, { today: "2026-07-15" });
  assert.equal(out.closesOn, null);
  assert.equal(out.unknownReason, UNKNOWN_REASONS.NO_CLOSE_DAY);
});

test("nextStatementClose answers when it can", () => {
  const out = nextStatementClose({ statement_close_day: 5 }, { today: "2026-07-01" });
  assert.deepEqual(out, { closesOn: "2026-07-05", daysAway: 4, unknownReason: null });
});
