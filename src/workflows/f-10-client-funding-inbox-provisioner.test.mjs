import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-10-client-funding-inbox-provisioner.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "inbox setup", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "inbox setup sms", compliance_passed: true }
];

test("happy path: no forwarding address yet — sets it, notifies, creates the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.forwardingAddress, "monitor+cl-1@fundhub.ai");
  assert.equal(db.clients[0].custom_fields.funding_email_forwarding_address, "monitor+cl-1@fundhub.ai");
  assert.equal(db.messages.length, 0, "F-10 email + SMS retired 2026-08-22; inbox setup and task still run");
  assert.equal(res.task.created, true);
});

test("branch: forwarding address already set — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { funding_email_forwarding_address: "x@y.com" } }], templates: withTemplates() });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "already_set");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send or double-task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const event = ev("round.started", {}, { id: "evt-dup-f10", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 0, "F-10 email + SMS retired 2026-08-22; replay still sends nothing");
  assert.equal(db.tasks.length, 1);
});
