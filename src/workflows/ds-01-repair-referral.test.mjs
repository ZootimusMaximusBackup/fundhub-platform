import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./ds-01-repair-referral.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "repair referral email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "repair referral sms", compliance_passed: true }
];

test("happy path: declined + non-funding path sends the referral", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.product_path, "Referred");
});

test("branch: never fires on the funding route", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }], templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "blocked_funding_route:FULL_FUNDING");
});

test("branch: pending copy — template not seeded yet, safe no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: [] });
  const res = await handle({ event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sms.reason, "template_pending");
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplates() });
  const event = ev("call.completed", { outcome: "declined" }, { id: "evt-dup-ds01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
