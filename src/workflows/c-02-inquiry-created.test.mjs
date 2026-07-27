import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-02-inquiry-created.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: new inquiries logged, hold + tags set, task created", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { newInquiries: [{ bureau: "EX", inquiry: "Bank A" }, { bureau: "TU", inquiry: "Bank B" }] }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.logged, 2);
  assert.equal(db.inquiryLog.length, 2);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, "New Inquiries");
  assert.deepEqual(db.clients[0].tags.sort(), ["inquiry:pending", "ops:action-required"]);
  assert.equal(db.tasks.length, 1);
});

test("branch: no new inquiries — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying does not re-log the same inquiries or re-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("analysis.completed", { newInquiries: [{ bureau: "EX", inquiry: "Bank A" }] }, { id: "evt-dup-c02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.inquiryLog.length, 1);
  assert.equal(db.tasks.length, 1);
});
