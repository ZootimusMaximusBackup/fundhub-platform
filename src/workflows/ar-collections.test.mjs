import { test } from "node:test";
import assert from "node:assert";
import {
  handle, EMAIL_AR_01, SMS_AR_01, EMAIL_AR_02, SMS_AR_02, EMAIL_AR_03, SMS_AR_03,
  AR_04_TASK_TITLE, AR_04_SOURCE_WORKFLOW
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

test("AR: partial payment keeps chase going and {{balance_due}} is the remainder", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates().map((t) =>
      t.template_key === EMAIL_AR_01
        ? { ...t, body: "ar1 {{invoice_number}} {{balance_due}}" }
        : t),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 400, paymentId: "pay_partial"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.allocated, true);
  assert.equal(pay.settled, false);
  assert.equal(db.invoices[0].status, "partially_paid");
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(Number(db.invoicePayments[0].amount), 400);

  const chase = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chase.done, true);
  assert.equal(chase.handoff.skipped, false);
  assert.match(db.messages[0].rendered_body, /\$600\.00/);
});

test("AR: exact payment settles that invoice and stops only that chase", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({ amount_due: 1250, funding_round_id: "round-a" }),
      openInvoice({ id: "inv-2", amount_due: 800, funding_round_id: "round-b" })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1250, paymentId: "pay_exact"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.settled, true);
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.invoices[1].status, "sent");

  const chasePaid = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chasePaid.stoppedAt, "before-ar-01");

  const chaseOpen = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-2", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chaseOpen.handoff.skipped, false);
  assert.equal(db.invoices[1].status, "escalated");
});

test("AR: overpay settles the matched invoice and leaves leftover unallocated", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({ amount_due: 1000, funding_round_id: "round-a" }),
      openInvoice({ id: "inv-2", amount_due: 500, funding_round_id: "round-b" })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1500, paymentId: "pay_over"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.settled, true);
  assert.equal(pay.surplusCents, 50000);
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.invoices[1].status, "sent");
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(Number(db.invoicePayments[0].amount), 1000);
  assert.equal(db.tasks.length, 1);
  assert.match(db.tasks[0].title, /Overpayment leftover/);
});

test("AR: two open invoices — payment with a round lands on that round only", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({
        id: "inv-old", amount_due: 1000, funding_round_id: "round-a",
        created_at: "2026-01-01", external_ref: null
      }),
      openInvoice({
        id: "inv-new", amount_due: 2000, funding_round_id: "round-b",
        created_at: "2026-06-01", external_ref: null
      })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "success_fee", amount: 2000, paymentId: "pay_round",
      fundingRoundId: "round-b"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.path, "round");
  assert.equal(pay.invoiceId, "inv-new");
  assert.equal(db.invoices.find((i) => i.id === "inv-new").status, "paid");
  assert.equal(db.invoices.find((i) => i.id === "inv-old").status, "sent");
});

test("AR: replayed webhook does not double-settle", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const event = ev("payment.received", {
    invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay_replay"
  }, { clientId: "cl-1" });
  const first = await handle({ event, db, step: fakeStep() });
  const second = await handle({ event, db, step: fakeStep() });
  assert.equal(first.settled, true);
  assert.equal(second.replay, true);
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(db.invoices[0].status, "paid");
});

test("AR: unmatched success-fee payment stays unallocated and opens a staff task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000, funding_round_id: "round-a" })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "success_fee", amount: 1000, paymentId: "pay_orphan"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.allocated, false);
  assert.equal(pay.reason, "unresolved");
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 1);
});

test("AR: a deposit payment does not settle an open success-fee invoice", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "deposit", amount: 3000, paymentId: "pay_dep", purpose: "deposit"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.skipped, true);
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 0);
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


/* AR-04 used to end in a tag nobody read. These two pin the thing that changed:
   the ladder now ends with a named person, and it ends with exactly one. */

test("AR: the handoff opens a CSM task, not just a tag", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.handoff.skipped, false);
  assert.equal(res.handoff.taskCreated, true, "AR-04 must hand the client to a person");

  const tasks = (db.tasks || []).filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW);
  assert.equal(tasks.length, 1, "exactly one handoff task");
  assert.equal(tasks[0].assignee_role, "csm");
  assert.equal(tasks[0].title, AR_04_TASK_TITLE);
  assert.match(tasks[0].body, /Balance due/);
});

test("AR: replaying the run does not stack a second handoff task", async () => {
  const seed = () => ({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const db = pgFake(seed());
  const event = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" });

  await handle({ event, db, step: fakeStep() });
  // Same event id, same invoice — an Inngest replay, which is normal, not an error.
  db.invoices[0].status = "sent";
  await handle({ event, db, step: fakeStep() });

  const tasks = (db.tasks || []).filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW);
  assert.equal(tasks.length, 1, "a replay must find the existing task, not open a second");
});
