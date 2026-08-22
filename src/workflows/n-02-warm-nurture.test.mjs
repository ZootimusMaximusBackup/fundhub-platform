import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, n02WarmNurture } from "./n-02-warm-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Warm nurture email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Warm nurture sms body", compliance_passed: true }
];

test("RETIRED 2026-08-22: survey.submitted trigger is not registered", () => {
  assert.deepEqual(n02WarmNurture.opts.triggers, []);
});

test("happy path: warm lead (survey.submitted, no booking) gets email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "entry.captured" },
      { client_id: "cl-1", name: "survey.submitted" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("survey.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: lead who already booked a call is hot, not warm — no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "survey.submitted" },
      { client_id: "cl-1", name: "booking.created" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("survey.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_warm:hot");
  assert.equal(db.messages.length, 0);
});

test("branch: template not yet seeded — safe no-op", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "survey.submitted" }],
    templates: []
  });
  const res = await handle({ event: ev("survey.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "survey.submitted" }],
    templates: withTemplates()
  });
  const event = ev("survey.submitted", {}, { id: "evt-dup-2", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
