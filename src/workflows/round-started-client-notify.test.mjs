import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_TEMPLATE_KEY } from "./round-started-client-notify.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: round.started sends the client-notify SMS", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "underway", compliance_passed: true }]
  });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.sms.sent, true);
  assert.equal(db.messages.length, 1);
});

test("branch: no resolvable client — no send, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("round.started", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "underway", compliance_passed: true }]
  });
  const event = ev("round.started", {}, { id: "evt-dup-rs", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});
