// AR collections on funding success-fee invoices. Spec 4.7 (2026-08-22).
// COMPLIANCE REVIEW REQUIRED — payment rails.
//
// invoice.sent (funding_success_fee only) → AR-01 now, AR-02 +7d, AR-03 +14d,
// then AR-04 automated handoff (no staff task). Stops on invoice.paid.
// Re-checks payment before every send.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";
import {
  getInvoice,
  markPaid,
  markEscalated,
  announceInvoice,
  invoiceDisplayNumber,
  formatBalanceDue
} from "../invoices/index.mjs";

export const EMAIL_AR_01 = "EMAIL-AR-01-FIRST-NOTICE";
export const SMS_AR_01 = "SMS-AR-01-FIRST-NOTICE";
export const EMAIL_AR_02 = "EMAIL-AR-02-REMINDER";
export const SMS_AR_02 = "SMS-AR-02-REMINDER";
export const EMAIL_AR_03 = "EMAIL-AR-03-FINAL-NOTICE";
export const SMS_AR_03 = "SMS-AR-03-FINAL-NOTICE";

const OPEN = ["draft", "sent", "reminded", "escalated", "partially_paid"];

function isFundingSuccessFee(row = {}, payload = {}) {
  const source = row.source || payload.source;
  const type = row.invoice_type || payload.invoice_type;
  return source === "funding_success_fee" || type === "success_fee";
}

function stillOpen(row) {
  if (!row) return false;
  return OPEN.includes(String(row.status || ""));
}

function arContext(row, payload = {}) {
  return {
    invoice_number: payload.invoice_number || invoiceDisplayNumber(row),
    balance_due: formatBalanceDue(row.amount_due ?? payload.amount_due)
  };
}

async function sendPair(db, { orgId, clientId, eventId, emailKey, smsKey, context }) {
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: emailKey,
    eventId: `${eventId}:${emailKey}`, context
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: smsKey,
    eventId: `${eventId}:${smsKey}`, context
  });
  return { email, sms };
}

async function chase({ event, db, step }) {
  const payload = event.payload || {};
  const invoiceId = payload.invoiceId || payload.invoice_id;
  if (!invoiceId) return { done: false, reason: "no_invoice_id" };
  if (!isFundingSuccessFee({}, payload)) {
    const row = await getInvoice(db, { invoiceId });
    if (!isFundingSuccessFee(row || {}, payload)) {
      return { done: false, reason: "not_success_fee" };
    }
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;

  const first = await step.run("send-ar-01", async () => {
    const row = await getInvoice(db, { invoiceId });
    if (!stillOpen(row)) return { skipped: true, reason: row?.status || "missing" };
    return sendPair(db, {
      orgId, clientId, eventId: `${eventId}:01`,
      emailKey: EMAIL_AR_01, smsKey: SMS_AR_01,
      context: arContext(row, payload)
    });
  });
  if (first.skipped) return { done: true, stoppedAt: "before-ar-01", first };

  await step.sleep("wait-7d", "7d");
  const second = await step.run("send-ar-02", async () => {
    const row = await getInvoice(db, { invoiceId });
    if (!stillOpen(row)) return { skipped: true, reason: row?.status || "missing" };
    return sendPair(db, {
      orgId, clientId, eventId: `${eventId}:02`,
      emailKey: EMAIL_AR_02, smsKey: SMS_AR_02,
      context: arContext(row, payload)
    });
  });
  if (second.skipped) return { done: true, stoppedAt: "before-ar-02", first, second };

  await step.sleep("wait-7d-more", "7d");
  const third = await step.run("send-ar-03", async () => {
    const row = await getInvoice(db, { invoiceId });
    if (!stillOpen(row)) return { skipped: true, reason: row?.status || "missing" };
    return sendPair(db, {
      orgId, clientId, eventId: `${eventId}:03`,
      emailKey: EMAIL_AR_03, smsKey: SMS_AR_03,
      context: arContext(row, payload)
    });
  });
  if (third.skipped) return { done: true, stoppedAt: "before-ar-03", first, second, third };

  const handoff = await step.run("ar-04-handoff", async () => {
    const row = await getInvoice(db, { invoiceId });
    if (!stillOpen(row)) return { skipped: true, reason: row?.status || "missing" };
    const escalated = await markEscalated(db, { invoiceId });
    await addTags(db, clientId, ["ar:collections-handoff"]);
    return { skipped: false, escalated: !!escalated };
  });

  return { done: true, first, second, third, handoff };
}

async function settleOpenSuccessFee({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  return step.run("settle-single-open-invoice", async () => {
    const r = await db.query(
      `SELECT * FROM invoices
        WHERE client_id = $1
          AND (source = 'funding_success_fee' OR invoice_type = 'success_fee')
          AND status = ANY($2)`,
      [clientId, OPEN]
    );
    if (r.rows.length !== 1) {
      return { done: false, reason: r.rows.length === 0 ? "no_open_invoice" : "ambiguous_open_invoices" };
    }
    const paid = await markPaid(db, { invoiceId: r.rows[0].id });
    if (paid) await announceInvoice(db, "invoice.paid", paid);
    return { done: true, invoiceId: r.rows[0].id, paid: !!paid };
  });
}

export async function handle({ event, db, step }) {
  if (event.name === "payment.received") return settleOpenSuccessFee({ event, db, step });
  return chase({ event, db, step });
}

export const arCollections = inngest.createFunction(
  {
    id: "ar-collections",
    name: "AR — Success-Fee Collections",
    cancelOn: [
      {
        event: "invoice.paid",
        if: "event.data.payload.invoiceId != null && event.data.payload.invoiceId == async.data.payload.invoiceId"
      }
    ]
  },
  [{ event: "invoice.sent" }, { event: "payment.received" }],
  ({ event, step }) => handle({ event: { ...event.data, name: event.name }, db, step })
);
