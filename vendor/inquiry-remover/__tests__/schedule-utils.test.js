"use strict";

const {
  isBusinessHours,
  nextBusinessHourSlot,
  getETComponents,
  BUSINESS_HOUR_START,
  BUSINESS_HOUR_END
} = require("../src/lib/schedule-utils");

// -----------------------------------------------------------------------
// Reference times — all dates are in March 2026 (after DST spring-forward,
// so Eastern = EDT = UTC-4).
//   10am EDT  = UTC 14:00
//    9am EDT  = UTC 13:00
//    8am EDT  = UTC 12:00
//    5pm EDT  = UTC 21:00
// 4:59pm EDT  = UTC 20:59  (hour=16 ET, within hours)
//    6pm EDT  = UTC 22:00
// -----------------------------------------------------------------------

const MON_10AM_EDT = "2026-03-23T14:00:00.000Z"; // Mon 10am ET -> hour=10, day=1
const MON_8AM_EDT  = "2026-03-23T12:00:00.000Z"; // Mon 8am ET  -> hour=8,  day=1
const MON_9AM_EDT  = "2026-03-23T13:00:00.000Z"; // Mon 9am ET  -> hour=9,  day=1
const MON_5PM_EDT  = "2026-03-23T21:00:00.000Z"; // Mon 5pm ET  -> hour=17, day=1 (exclusive boundary)
const MON_459PM    = "2026-03-23T20:59:00.000Z"; // Mon 4:59pm ET -> hour=16, day=1 (within hours)
const SAT_10AM_EDT = "2026-03-21T14:00:00.000Z"; // Sat 10am ET -> hour=10, day=6
const SUN_10AM_EDT = "2026-03-22T14:00:00.000Z"; // Sun 10am ET -> hour=10, day=0
const FRI_6PM_EDT  = "2026-03-20T22:00:00.000Z"; // Fri 6pm ET  -> hour=18, day=5

describe("schedule-utils — constants", () => {
  test("BUSINESS_HOUR_START is 9", () => {
    expect(BUSINESS_HOUR_START).toBe(9);
  });

  test("BUSINESS_HOUR_END is 17", () => {
    expect(BUSINESS_HOUR_END).toBe(17);
  });
});

describe("getETComponents", () => {
  test("returns hour=10, minute=0, day=1 (Monday) for Mon 10am EDT", () => {
    const { hour, minute, day } = getETComponents(new Date(MON_10AM_EDT));
    expect(hour).toBe(10);
    expect(minute).toBe(0);
    expect(day).toBe(1);
  });

  test("returns day=6 for Saturday", () => {
    const { day } = getETComponents(new Date(SAT_10AM_EDT));
    expect(day).toBe(6);
  });

  test("returns day=0 for Sunday", () => {
    const { day } = getETComponents(new Date(SUN_10AM_EDT));
    expect(day).toBe(0);
  });

  test("returns hour=9 for Mon 9am EDT", () => {
    const { hour } = getETComponents(new Date(MON_9AM_EDT));
    expect(hour).toBe(9);
  });

  test("returns hour=17 for Mon 5pm EDT", () => {
    const { hour } = getETComponents(new Date(MON_5PM_EDT));
    expect(hour).toBe(17);
  });
});

describe("isBusinessHours", () => {
  test("returns true for Monday 10am ET", () => {
    expect(isBusinessHours(new Date(MON_10AM_EDT))).toBe(true);
  });

  test("returns true for Monday exactly 9am ET (inclusive open boundary)", () => {
    expect(isBusinessHours(new Date(MON_9AM_EDT))).toBe(true);
  });

  test("returns true for Monday 4:59pm ET (one minute before close)", () => {
    expect(isBusinessHours(new Date(MON_459PM))).toBe(true);
  });

  test("returns false for Monday exactly 5pm ET (exclusive close boundary)", () => {
    expect(isBusinessHours(new Date(MON_5PM_EDT))).toBe(false);
  });

  test("returns false for Monday 8am ET (before open)", () => {
    expect(isBusinessHours(new Date(MON_8AM_EDT))).toBe(false);
  });

  test("returns false for Saturday 10am ET (weekend)", () => {
    expect(isBusinessHours(new Date(SAT_10AM_EDT))).toBe(false);
  });

  test("returns false for Sunday 10am ET (weekend)", () => {
    expect(isBusinessHours(new Date(SUN_10AM_EDT))).toBe(false);
  });

  test("returns false for Friday 6pm ET (after hours)", () => {
    expect(isBusinessHours(new Date(FRI_6PM_EDT))).toBe(false);
  });

  test("returns a boolean when called with no argument (uses current time)", () => {
    expect(typeof isBusinessHours()).toBe("boolean");
  });
});

describe("nextBusinessHourSlot", () => {
  test("returns the same instant (copy) when already in business hours", () => {
    const input = new Date(MON_10AM_EDT);
    const result = nextBusinessHourSlot(input);
    expect(result).not.toBe(input); // different object reference
    expect(result.getTime()).toBe(input.getTime());
  });

  test("result is within business hours when starting from Saturday", () => {
    const result = nextBusinessHourSlot(new Date(SAT_10AM_EDT));
    expect(isBusinessHours(result)).toBe(true);
  });

  test("result is within business hours when starting from Sunday", () => {
    const result = nextBusinessHourSlot(new Date(SUN_10AM_EDT));
    expect(isBusinessHours(result)).toBe(true);
  });

  test("result is within business hours when starting from Friday after-hours", () => {
    const result = nextBusinessHourSlot(new Date(FRI_6PM_EDT));
    expect(isBusinessHours(result)).toBe(true);
  });

  test("next slot from Saturday lands on Monday (day=1)", () => {
    const result = nextBusinessHourSlot(new Date(SAT_10AM_EDT));
    const { day } = getETComponents(result);
    expect(day).toBe(1); // Monday
  });

  test("result is in the future when starting from outside hours", () => {
    const input = new Date(SAT_10AM_EDT);
    const result = nextBusinessHourSlot(input);
    expect(result.getTime()).toBeGreaterThan(input.getTime());
  });

  test("next slot hour is 9am ET", () => {
    const result = nextBusinessHourSlot(new Date(SAT_10AM_EDT));
    const { hour } = getETComponents(result);
    expect(hour).toBe(9);
  });

  test("returns a Date object", () => {
    const result = nextBusinessHourSlot(new Date(SAT_10AM_EDT));
    expect(result).toBeInstanceOf(Date);
  });
});
