// The client's own clock. Two things matter here and both are about somebody's
// phone buzzing at the wrong hour:
//
//   1. daytime is measured where THEY are, not where we are
//   2. when we cannot tell what time it is where they are, the answer is no

import { test } from "node:test";
import assert from "node:assert";
import {
  zoneForClient, isDaytime, localDate, isUsableZone, FALLBACK_TZ,
  QUIET_START_HOUR, QUIET_END_HOUR
} from "./clock.mjs";

test("the window is the same one the dispatcher uses, imported not restated", () => {
  assert.equal(QUIET_END_HOUR, 8);
  assert.equal(QUIET_START_HOUR, 20);
});

test("a client's own zone is read from custom_fields, under any of the four keys", () => {
  assert.deepEqual(zoneForClient({ custom_fields: { timezone: "America/New_York" } }),
    { zone: "America/New_York", known: true });
  assert.deepEqual(zoneForClient({ custom_fields: { time_zone: "Europe/London" } }),
    { zone: "Europe/London", known: true });
  assert.deepEqual(zoneForClient({ custom_fields: { tz: "Pacific/Honolulu" } }),
    { zone: "Pacific/Honolulu", known: true });
  assert.deepEqual(zoneForClient({ custom_fields: { tzid: "Asia/Tokyo" } }),
    { zone: "Asia/Tokyo", known: true });
});

test("no zone on the record falls back to the company clock and says it is a fallback", () => {
  assert.deepEqual(zoneForClient({}), { zone: FALLBACK_TZ, known: false });
  assert.deepEqual(zoneForClient({ custom_fields: {} }), { zone: FALLBACK_TZ, known: false });
  assert.equal(FALLBACK_TZ, "America/Phoenix");
});

test("a typo'd zone is not trusted and is not thrown either", () => {
  assert.equal(isUsableZone("Amerika/Phoenix"), false);
  assert.equal(isUsableZone(""), false);
  assert.equal(isUsableZone(null), false);
  assert.deepEqual(zoneForClient({ custom_fields: { timezone: "Amerika/Phoenix" } }),
    { zone: FALLBACK_TZ, known: false });
});

test("the SAME instant is daytime in one client's zone and not in another's", () => {
  // 15:00 UTC. 08:00 in Phoenix (open), 05:00 in Honolulu (closed).
  const instant = new Date("2026-09-10T15:00:00.000Z");
  assert.equal(isDaytime(instant, "America/Phoenix"), true);
  assert.equal(isDaytime(instant, "Pacific/Honolulu"), false);
});

test("the window opens at 08:00 local and closes at 20:00 local", () => {
  const zone = "America/Phoenix"; // UTC-7 all year, so no DST arithmetic here
  assert.equal(isDaytime(new Date("2026-09-10T14:59:00.000Z"), zone), false); // 07:59
  assert.equal(isDaytime(new Date("2026-09-10T15:00:00.000Z"), zone), true);  // 08:00
  assert.equal(isDaytime(new Date("2026-09-11T02:59:00.000Z"), zone), true);  // 19:59
  assert.equal(isDaytime(new Date("2026-09-11T03:00:00.000Z"), zone), false); // 20:00
});

test("an unreadable clock is not daytime — we do not text what we cannot time", () => {
  assert.equal(isDaytime(new Date("2026-09-10T15:00:00.000Z"), "Amerika/Phoenix"), false);
});

test("the calendar day is the client's own, so two clients roll over at different instants", () => {
  // 06:00 UTC on the 11th: still the 10th in Phoenix, already the 11th in Tokyo.
  const instant = new Date("2026-09-11T06:00:00.000Z");
  assert.equal(localDate(instant, "America/Phoenix"), "2026-09-10");
  assert.equal(localDate(instant, "Asia/Tokyo"), "2026-09-11");
});

test("the local date is ISO-shaped, so it binds straight to a date column", () => {
  assert.match(localDate(new Date("2026-01-05T12:00:00.000Z"), "UTC"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDate(new Date("2026-01-05T12:00:00.000Z"), "UTC"), "2026-01-05");
});
