import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, SOURCE_WORKFLOW } from "./n-06-renewal-second-wave.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Renewal email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Renewal sms body", compliance_passed: true }
];

test("happy path: still a funding client after the wait — task + email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", funded: true }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].source_workflow, SOURCE_WORKFLOW);
  assert.equal(db.messages.length, 2);
});

test("branch: no longer a funding client at wake time — no task, no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", funded: false }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_longer_funding_client");
  assert.equal(db.tasks.length, 0);
  assert.equal(db.messages.length, 0);
});

test("branch: template not yet seeded — task still created, send is a safe no-op", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", funded: true }],
    templates: []
  });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.task.created, true);
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-create the task or double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", funded: true }],
    templates: withTemplates()
  });
  const event = ev("round.funded", {}, { id: "evt-dup-6", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.messages.length, 2);
});
