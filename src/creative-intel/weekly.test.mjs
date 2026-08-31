// ISO week arithmetic.
//
// Small, boring, and worth its own file: the answer differs from "day of year
// divided by seven" for about a week every January, and the difference is
// invisible until a New Year roll-up puts two weeks of data in one bucket and
// the board silently reports last week's leaders as this week's.

import { test, describe } from "node:test";
import assert from "node:assert";
import { isoWeek, weekBounds, previousWeek } from "./weekly.mjs";
import { WEEKLY_CRON } from "./job.mjs";

describe("isoWeek", () => {
  test("a mid-year Sunday belongs to the week that started the Monday before", () => {
    // 2026-08-30 is a Sunday; its week runs Mon 24th to Sun 30th.
    assert.equal(isoWeek("2026-08-30"), "2026-W35");
    assert.equal(isoWeek("2026-08-24"), "2026-W35");
    assert.equal(isoWeek("2026-08-23"), "2026-W34");
  });

  test("the January boundary follows ISO-8601, not the calendar year", () => {
    // 1 Jan 2027 is a Friday, so it sits in the week containing Thursday
    // 31 Dec 2026 — which is week 53 OF 2026, not week 1 of 2027.
    assert.equal(isoWeek("2027-01-01"), "2026-W53");
    assert.equal(isoWeek("2027-01-04"), "2027-W01");
  });

  test("weeks are zero-padded, so they sort as strings", () => {
    // iso_week is a text column and every ORDER BY on it is lexical.
    assert.match(isoWeek("2026-02-02"), /^\d{4}-W\d{2}$/);
    assert.ok("2026-W02" < "2026-W10");
  });

  test("a bad date throws rather than producing a plausible week", () => {
    assert.throws(() => isoWeek("not-a-date"), /bad date/);
  });
});

describe("weekBounds", () => {
  test("Monday to Sunday", () => {
    assert.deepEqual(weekBounds("2026-W35"), { start: "2026-08-24", end: "2026-08-30" });
  });

  test("round-trips with isoWeek at both ends of the week", () => {
    for (const week of ["2026-W01", "2026-W35", "2026-W53", "2027-W01"]) {
      const { start, end } = weekBounds(week);
      assert.equal(isoWeek(start), week, `${week} start`);
      assert.equal(isoWeek(end), week, `${week} end`);
    }
  });

  test("a malformed week is refused", () => {
    assert.throws(() => weekBounds("2026-35"), /bad ISO week/);
  });
});

describe("previousWeek", () => {
  test("steps back one week", () => {
    assert.equal(previousWeek("2026-W35"), "2026-W34");
  });

  test("crosses the year boundary correctly", () => {
    assert.equal(previousWeek("2027-W01"), "2026-W53");
  });
});

describe("the cron", () => {
  test("is five fields and runs weekly, not daily", () => {
    const fields = WEEKLY_CRON.trim().split(/\s+/);
    assert.equal(fields.length, 5);
    assert.notEqual(fields[4], "*", "a day-of-week of * would make this a daily job");
  });
});
