import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./s-doc-collection.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { FUNDING_DOC_HOLD } from "../inquiry-ops/doc-gate.mjs";

const templates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "docs", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "docs sms", compliance_passed: true }
];

test("doc collection: deposit.paid sends request and closes the gate", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const res = await handle({
    event: ev("deposit.paid", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_DOC_HOLD);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Collect Documents");
  assert.deepEqual(db.clients[0].tags, ["docs:missing"]);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY]);
});

test("doc collection: second deposit.paid does not send again", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const first = await handle({
    event: ev("deposit.paid", {}, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const second = await handle({
    event: ev("deposit.paid", {}, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(first.done, true);
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_locked");
  assert.equal(db.messages.length, 2);
});
