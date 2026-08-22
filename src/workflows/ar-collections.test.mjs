import { test } from "node:test";
import assert from "node:assert";
import {
  handle, EMAIL_AR_01, SMS_AR_01, EMAIL_AR_02, SMS_AR_02, EMAIL_AR_03, SMS_AR_03
} from "./ar-collections.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templates = () => [
  { org_id: "org-1", template_key: EMAIL_AR_01, channel: "email", body: "ar1 {{invoice_number}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_01, channel: "sms", body: "ar1s", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_AR_02, channel: "email", body: "ar2", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_02, channel: "sms", body: "ar2s", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_AR_03, channel: "email", body: "ar3", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_03, channel: "sms", body: "ar3s", compliance_passed: true }
];

function openInvoice(over = {}) {
  return {
    id: "inv-1",
    org_id: "org-1",
    client_id: "cl-1",
    source: "funding_success_fee",
    invoice_type: "success_fee",
    amount_due: 1250,
    status: "sent",
    ...over
  };
}

test("AR: unpaid success-fee invoice gets three notices then handoff", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.handoff.skipped, false);
  assert.equal(db.invoices[0].status, "escalated");
  assert.deepEqual(db.clients[0].tags, ["ar:collections-handoff"]);
  assert.equal(db.messages.length, 6);
});

test("AR: paid invoice skips remaining chase", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  let sends = 0;
  const step = {
    run: async (id, fn) => {
      const out = await fn();
      if (id === "send-ar-01") db.invoices[0].status = "paid";
      if (id.startsWith("send-")) sends += 1;
      return out;
    },
    sleep: async () => {}
  };
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(res.stoppedAt, "before-ar-02");
  assert.equal(db.messages.length, 2);
});

test("AR: DIY invoice is ignored", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: templates(),
    invoices: [openInvoice({ source: "diy_letters", invoice_type: "deposit" })]
  });
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "diy_letters" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_success_fee");
  assert.equal(db.messages.length, 0);
});
