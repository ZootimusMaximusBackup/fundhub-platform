import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./n-01-cold-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Cold nurture email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Cold nurture sms body", compliance_passed: true }
];

test("happy path: cold lead (entry.captured only) gets email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", { clientId: "cl-1" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.email.sent, true);
  assert.equal(res.sms.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: lead who already submitted the survey is warm, not cold — no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "entry.captured" },
      { client_id: "cl-1", name: "survey.submitted" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_cold:warm");
  assert.equal(db.messages.length, 0);
});

test("branch: no client resolvable — no send, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("entry.captured", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_client");
});

test("branch: template not yet seeded — send is a safe no-op, never invents copy", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: []
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true, "still a 'sent' attempt at the workflow level");
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-1", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() }); // replay
  assert.equal(db.messages.length, 2, "one email + one sms, not four");
});
