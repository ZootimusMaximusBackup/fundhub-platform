import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-04-round-approvals.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Approvals email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Approvals sms", compliance_passed: true }
];

test("happy path: approved amount > 0 sends email + sms", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.approved", { approvedAmount: 15000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: zero/no approval exits without sending", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.approved", { approvedAmount: 0 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_approved");
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.approved", { approvedAmount: 5000 }, { id: "evt-dup-f04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
