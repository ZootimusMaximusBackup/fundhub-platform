import { test } from "node:test";
import assert from "node:assert";
import { handle, FUNDING_EMAIL_TEMPLATE_KEY, REPAIR_EMAIL_TEMPLATE_KEY } from "./u-02-analyzer-complete-delivery.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding path sends the funding letter pack delivery", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "funding");
  assert.equal(db.messages.length, 1);
  assert.equal(db.clients[0].custom_fields.funding_delivery_sent, true);
});

test("branch: repair path sends the repair letter pack delivery", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: REPAIR_EMAIL_TEMPLATE_KEY, channel: "email", body: "repair letters", compliance_passed: true }]
  });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "repair");
});

test("branch: missing identity tags data-incomplete + creates a task, no send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { identityOk: false }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "data_incomplete");
  assert.equal(res.task.created, true);
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const event = ev("analysis.completed", {}, { id: "evt-dup-u02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});
