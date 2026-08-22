import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, n03HotNurture } from "./n-03-hot-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Hot nurture email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Hot nurture sms body", compliance_passed: true }
];

test("RETIRED 2026-08-22: both triggers removed and the workflow is disabled", () => {
  assert.deepEqual(n03HotNurture.opts.triggers, []);
  assert.equal(n03HotNurture.opts.enabled, false);
});

test("happy path: hot lead via booking.created gets email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "survey.submitted" },
      { client_id: "cl-1", name: "booking.created" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
});

test("happy path: hot lead via call.completed (no booking) also qualifies", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "call.completed" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("call.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
});

test("branch: lead who already paid the diagnostic has exited nurture — no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "booking.created" },
      { client_id: "cl-1", name: "diagnostic.paid" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_hot:null");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "booking.created" }],
    templates: withTemplates()
  });
  const event = ev("booking.created", {}, { id: "evt-dup-3", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
