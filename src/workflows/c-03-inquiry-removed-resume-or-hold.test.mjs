import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-03-inquiry-removed-resume-or-hold.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding client — resumes, tags completed, ready for next round", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: { product_path: "Funding" } }] });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "resume");
  assert.equal(db.clients[0].tags.includes("inquiry:pending"), false);
  assert.ok(db.clients[0].tags.includes("inquiry:completed"));
  assert.equal(db.clients[0].custom_fields.ready_for_next_round, true);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Apply for Funding");
});

test("inquiry-only file does not say Apply for Funding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: {} }] });
  const res = await handle({ event: ev("inquiry.removed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "inquiry_done");
  assert.ok(db.clients[0].tags.includes("inquiry:completed"));
  assert.equal(db.clients[0].custom_fields.ready_for_next_round, undefined);
  assert.notEqual(db.clients[0].custom_fields.employee_next_action, "Apply for Funding");
  assert.equal(db.tasks.length, 0);
});

test("branch: fraud alert holds the file instead", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("inquiry.removed", { fraudAlert: true }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "fraud_hold");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, "Fraud Alert");
  assert.deepEqual(db.clients[0].tags, ["fraud:alert-present"]);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { product_path: "Funding" } }] });
  const event = ev("inquiry.removed", {}, { id: "evt-dup-c03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
