// The seven-day clock. The rule under test is: it starts at the FIRST AD
// IMPRESSION, not at checkout, and a trial with no impression has no clock at
// all rather than a clock that quietly starts today.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  startClock, trialDayIndex, daysRemaining, hasEnded, frozenUntil,
  conversionWindow, phaseFor, DAY_PLAN
} from "./clock.mjs";
import { TRIAL_DAYS, TRIAL_STATUS } from "./constants.mjs";

const DAY = 86400000;
const START = new Date("2026-09-01T15:00:00.000Z");

describe("startClock", () => {
  test("seven days from the first impression", () => {
    const c = startClock(START);
    assert.equal(c.startsAt.toISOString(), START.toISOString());
    assert.equal(c.endsAt.getTime() - c.startsAt.getTime(), TRIAL_DAYS * DAY);
  });

  test("no impression, no clock — and it is null, not now()", () => {
    assert.equal(startClock(null), null);
    assert.equal(startClock(""), null);
    assert.equal(startClock(undefined), null);
  });

  test("garbage in is null out rather than an Invalid Date clock", () => {
    assert.equal(startClock("not a date"), null);
  });
});

describe("trialDayIndex", () => {
  test("the first 24 hours are day 1", () => {
    assert.equal(trialDayIndex(START, START), 1);
    assert.equal(trialDayIndex(new Date(START.getTime() + DAY - 1000), START), 1);
  });

  test("the next day is day 2", () => {
    assert.equal(trialDayIndex(new Date(START.getTime() + DAY), START), 2);
  });

  test("day 8 is reachable — it is the conversion call, not an overflow", () => {
    assert.equal(trialDayIndex(new Date(START.getTime() + 7 * DAY), START), 8);
  });

  test("unstarted is null", () => {
    assert.equal(trialDayIndex(START, null), null);
  });

  test("before the start is null, never a negative day", () => {
    assert.equal(trialDayIndex(new Date(START.getTime() - DAY), START), null);
  });
});

describe("daysRemaining", () => {
  test("seven on day one, one on day seven, zero after", () => {
    assert.equal(daysRemaining(START, START), 7);
    assert.equal(daysRemaining(new Date(START.getTime() + 6 * DAY), START), 1);
    assert.equal(daysRemaining(new Date(START.getTime() + 9 * DAY), START), 0);
  });

  test("never negative", () => {
    assert.equal(daysRemaining(new Date(START.getTime() + 40 * DAY), START), 0);
  });
});

describe("hasEnded", () => {
  test("false during the seven days, true at the boundary", () => {
    assert.equal(hasEnded(new Date(START.getTime() + 6 * DAY), START), false);
    assert.equal(hasEnded(new Date(START.getTime() + 7 * DAY), START), true);
  });

  test("an unstarted trial has not ended", () => {
    assert.equal(hasEnded(START, null), false);
  });
});

describe("freeze and conversion windows", () => {
  test("readable for 30 days after the end", () => {
    const end = new Date(START.getTime() + 7 * DAY);
    assert.equal(frozenUntil(end).getTime() - end.getTime(), 30 * DAY);
  });

  test("the $297 credit expires 30 days after the end", () => {
    const end = new Date(START.getTime() + 7 * DAY);
    const w = conversionWindow(end);
    assert.equal(w.dueAt.getTime(), end.getTime());
    assert.equal(w.creditExpiresAt.getTime() - end.getTime(), 30 * DAY);
  });

  test("no end, no windows", () => {
    assert.equal(frozenUntil(null), null);
    assert.equal(conversionWindow(null), null);
  });
});

describe("phaseFor", () => {
  test("a held-start trial is held, whatever the date says", () => {
    assert.equal(phaseFor(TRIAL_STATUS.HELD_START, new Date(), null), "held_start");
  });

  test("provisioned but unstarted is waiting for the first impression", () => {
    assert.equal(
      phaseFor(TRIAL_STATUS.PROVISIONED, START, null),
      "waiting_for_first_impression"
    );
  });

  test("day seven is the final day, day eight is the call", () => {
    assert.equal(phaseFor(TRIAL_STATUS.RUNNING, new Date(START.getTime() + 6 * DAY), START), "final_day");
    assert.equal(phaseFor(TRIAL_STATUS.RUNNING, new Date(START.getTime() + 7 * DAY), START), "conversion_call");
  });

  test("outcomes win over the clock", () => {
    assert.equal(phaseFor(TRIAL_STATUS.CONVERTED, new Date(), START), "converted");
    assert.equal(phaseFor(TRIAL_STATUS.DECLINED, new Date(), START), "declined");
    assert.equal(phaseFor(TRIAL_STATUS.REFUNDED, new Date(), START), "refunded");
  });
});

describe("DAY_PLAN", () => {
  test("covers days one to eight with no gaps", () => {
    assert.deepEqual(DAY_PLAN.map((d) => d.day), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("the four human steps are days 3, 4, 5 and 8", () => {
    assert.deepEqual(DAY_PLAN.filter((d) => d.human).map((d) => d.day), [3, 4, 5, 8]);
  });

  test("no day promises a result", () => {
    // The plan describes what FundHub does. It never says how many calls book.
    for (const d of DAY_PLAN) {
      const text = `${d.title} ${d.detail}`.toLowerCase();
      assert.ok(!/\b\d+\s*(calls?|leads?|closes?)\b/.test(text),
        `day ${d.day} states a count of results: ${text}`);
    }
  });
});
