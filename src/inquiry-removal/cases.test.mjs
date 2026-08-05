import { test } from "node:test";
import assert from "node:assert";
import { holdDurationDisplay, isActiveCaseStatus } from "./cases.mjs";

test("holdDurationDisplay: formats minutes and seconds from hold_started_at", () => {
  const start = new Date("2026-08-04T12:00:00Z");
  const now = new Date("2026-08-04T12:03:12Z");
  assert.equal(holdDurationDisplay(start, now), "3m 12s");
});

test("holdDurationDisplay: null when no start", () => {
  assert.equal(holdDurationDisplay(null), null);
});

test("isActiveCaseStatus: closed/cleared/completed are inactive", () => {
  assert.equal(isActiveCaseStatus("Calling"), true);
  assert.equal(isActiveCaseStatus("Awaiting Remover"), true);
  assert.equal(isActiveCaseStatus("Cleared"), false);
  assert.equal(isActiveCaseStatus("Closed"), false);
  assert.equal(isActiveCaseStatus("Completed"), false);
});
