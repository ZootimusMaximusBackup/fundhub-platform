import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-06-post-call-funding-purchased.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding-path sale.closed tags + sets lifecycle, creates intake task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", tags: ["client:repair"], custom_fields: {} }] });
  const res = await handle({ event: ev("sale.closed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "Funding Client");
  assert.equal(db.clients[0].custom_fields.product_path, "Funding");
  assert.deepEqual(db.clients[0].tags, ["client:funding"]);
});

test("branch: repair-only path is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }] });
  const res = await handle({ event: ev("sale.closed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_funding_path:REPAIR_ONLY");
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const event = ev("sale.closed", {}, { id: "evt-dup-s06", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
