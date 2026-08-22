import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-07-funding-locked.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Locked email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Locked sms", compliance_passed: true }
];

test("happy path: fee ready sends email + sms and creates an invoice task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const res = await handle({ event: ev("round.funded", { approvedAmount: 25000, feePercent: 12 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.feeReady, true);
  assert.equal(res.invoiceTask.created, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.tasks.length, 1);
  assert.ok(res.invoice);
  assert.equal(res.invoice.source, "funding_success_fee");
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].status, "sent");
});

test("branch: fee not ready flags ops + creates a fix-fee task, no send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.funded", { approvedAmount: 25000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.feeReady, false);
  assert.equal(res.task.created, true);
  assert.equal(db.messages.length, 0);
  assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
});

test("duplicate delivery: replaying the same event does not double-send or double-invoice", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], templates: withTemplates() });
  const event = ev("round.funded", { approvedAmount: 10000, feePercent: 10 }, { id: "evt-dup-f07", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
  assert.equal(db.tasks.length, 1);
});
