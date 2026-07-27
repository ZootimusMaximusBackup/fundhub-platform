import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-05-pre-funding-review.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: CRS complete raises the review task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { crs_status: "Complete" } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "review");
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Review Funding File");
});

test("branch: CRS incomplete flags awaiting-CRS", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "awaiting_crs");
  assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { crs_status: "Complete" } }] });
  const event = ev("round.started", {}, { id: "evt-dup-c05", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
