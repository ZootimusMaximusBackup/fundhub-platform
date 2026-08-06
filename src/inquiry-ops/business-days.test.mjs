import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, usFederalHolidays } from "./business-days.mjs";

test("Tue 16:00 + 1 business day → Wed 16:00 hour-preserved", () => {
  // 2026-08-04 is a Tuesday
  const from = new Date("2026-08-04T16:00:00.000Z");
  const due = addBusinessDays(from, 1);
  assert.equal(due.toISOString(), "2026-08-05T16:00:00.000Z");
});

test("Friday 14:00 + 1 business day → Monday 14:00", () => {
  // 2026-08-07 is a Friday
  const from = new Date("2026-08-07T14:00:00.000Z");
  const due = addBusinessDays(from, 1);
  assert.equal(due.toISOString(), "2026-08-10T14:00:00.000Z");
});

test("mail default 3 business days skips weekend", () => {
  const from = new Date("2026-08-07T14:00:00.000Z"); // Fri
  const due = addBusinessDays(from, 3);
  // Fri+1=Mon, +2=Tue, +3=Wed
  assert.equal(due.toISOString(), "2026-08-12T14:00:00.000Z");
});

test("holiday respected — Jul 3 + 1 business day skips Jul 4", () => {
  // 2026-07-03 is a Friday; +1 would be Mon Jul 6 if Jul 4 were weekend-only,
  // but Jul 4 is Saturday in 2026 — use Thanksgiving week instead.
  // 2026-11-25 is Wednesday before Thanksgiving (Thu 11/26).
  const holidays = usFederalHolidays(2026);
  assert.ok(holidays.has("2026-11-26"));
  const from = new Date("2026-11-25T15:00:00.000Z");
  const due = addBusinessDays(from, 1, { holidays });
  // Skip Thu holiday → Friday
  assert.equal(due.toISOString(), "2026-11-27T15:00:00.000Z");
});
