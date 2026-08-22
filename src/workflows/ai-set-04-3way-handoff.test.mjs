import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_TEMPLATE_KEY } from "./ai-set-04-3way-handoff.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: sends the handoff SMS + advisor task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const res = await handle({ event: ev("booking.created", { startTime: "2026-08-01T15:00:00Z" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 1);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks[0].assignee_role, "closer");
});

test("branch: no start time — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_start_time");
});

test("duplicate delivery: replaying does not double-send or double-task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const event = ev("booking.created", { startTime: "2026-08-01T15:00:00Z" }, { id: "evt-dup-aiset04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
});
