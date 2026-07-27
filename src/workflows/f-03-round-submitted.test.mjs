import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-03-round-submitted.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Round submitted email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Round submitted sms", compliance_passed: true }
];

test("happy path: round.submitted with a round number sends email + sms", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", { roundNumber: 3 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Remove Inquiries");
});

test("branch: missing round number exits without sending", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_round_number");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.submitted", { roundNumber: 1 }, { id: "evt-dup-f03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
