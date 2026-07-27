import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./dpc-05-no-progress-escalation.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "no progress", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "no progress sms", compliance_passed: true }
];

test("happy path: no decision after 72h escalates", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.clients[0].tags, ["dpc:no-progress-escalated"]);
});

test("branch: decision already made — no escalation", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { decision_status: "yes" } }], templates: withTemplates() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "progress_made");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-escalate", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const event = ev("booking.created", {}, { id: "evt-dup-dpc05", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.messages.length, 2);
});
