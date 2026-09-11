// The ladder terminates. That is the property under test here, and it is
// tested three different ways because it is the one that, when it was absent
// elsewhere in this product, sent 51 texts to one phone in two hours.

import { test } from "node:test";
import assert from "node:assert";
import { STEPS, FINAL_STEP, TEMPLATE_KEYS, stepFor, dueStep } from "./ladder.mjs";

const DAY = 24 * 60 * 60 * 1000;
const DUE = new Date("2026-09-01T15:00:00.000Z");
const at = (days) => new Date(DUE.getTime() + days * DAY);

test("there are exactly four rungs, numbered 1 to 4", () => {
  assert.equal(STEPS.length, 4);
  assert.deepEqual(STEPS.map((s) => s.step), [1, 2, 3, 4]);
  assert.equal(FINAL_STEP, 4);
});

test("the last rung is a staff task and carries no channel and no template", () => {
  const last = STEPS[STEPS.length - 1];
  assert.equal(last.kind, "staff_task");
  assert.equal(last.channel, null);
  assert.equal(last.templateKey, null);
});

test("there is no fifth rung, however far past the end you ask", () => {
  assert.equal(stepFor(5), null);
  assert.equal(stepFor(6), null);
  assert.equal(stepFor(99), null);
  assert.equal(stepFor(0), null);
});

test("no rung past 4 exists however overdue the waypoint gets", () => {
  for (const days of [9, 10, 30, 365, 4000]) {
    assert.equal(dueStep(DUE, at(days)).step, 4, `${days} days overdue`);
  }
});

test("the client-facing rungs are sms, email, sms — and only three of them", () => {
  assert.deepEqual(
    STEPS.filter((s) => s.kind === "client_message").map((s) => s.channel),
    ["sms", "email", "sms"]
  );
  assert.deepEqual(TEMPLATE_KEYS, [
    "SMS-WAYPOINT-DUE", "EMAIL-WAYPOINT-NUDGE-1", "SMS-WAYPOINT-NUDGE-2"
  ]);
});

test("a waypoint that is not overdue yet reaches no rung at all", () => {
  assert.equal(dueStep(DUE, new Date(DUE.getTime() - 1)), null);
  assert.equal(dueStep(DUE, at(-3)), null);
});

test("NULL due_at is not overdue — unknown is never a reason to text somebody", () => {
  assert.equal(dueStep(null, at(100)), null);
  assert.equal(dueStep(undefined, at(100)), null);
  assert.equal(dueStep("not a date", at(100)), null);
});

test("the rungs open on their day and not before", () => {
  assert.equal(dueStep(DUE, DUE).step, 1);
  assert.equal(dueStep(DUE, at(1.9)).step, 1);
  assert.equal(dueStep(DUE, at(2)).step, 2);
  assert.equal(dueStep(DUE, at(4.9)).step, 2);
  assert.equal(dueStep(DUE, at(5)).step, 3);
  assert.equal(dueStep(DUE, at(8.9)).step, 3);
  assert.equal(dueStep(DUE, at(9)).step, 4);
});

test("a waypoint overdue for a fortnight lands on the human, not on three texts", () => {
  // The alternative — walking them up rungs 1, 2, 3 over the next week — would
  // send a "this is due today" text about something two weeks late.
  assert.equal(dueStep(DUE, at(14)).step, 4);
});

test("the rung table is frozen, so nothing can bolt a fifth one on at runtime", () => {
  assert.ok(Object.isFrozen(STEPS));
  assert.throws(() => { STEPS.push({ step: 5 }); });
  assert.equal(STEPS.length, 4);
});
