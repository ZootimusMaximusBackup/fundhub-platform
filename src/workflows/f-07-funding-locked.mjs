// F-07 — Funding Locked (F22).
// Source: GHL workflow 992e1734-3d5b-4d51-91cb-7b665650f407 (ghl-crm-source-of-truth.md).
// Audit fix applied: real ready-to-paste SMS + email-subject copy (the FR22 "Total
// Funding Locked" body from EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md, grepped for this one
// key only), seeded via src/workflows/templates-seed.mjs.
//
// Trigger: round.funded (F22 "Funding Locked" is the funded-round terminal stage).
// Gate: Approved Amount + Funding Fee % both present.
//
// DELIBERATELY NOT PORTED: GHL's own field-copy steps set "Commission Owed" =
// total_approved_amount and "Balance Due" = commission_owed with no visible
// fee-percent multiplication anywhere in the crawl — it's unclear whether
// total_approved_amount already IS the fee amount or something else entirely, and
// getting this wrong writes an incorrect balance owed to a real client's file. This
// touches money with a genuinely unclear formula, so per the standing rule it's left
// for a human: this handler creates the "Invoice Client" task carrying the raw
// approvedAmount/feePercent for whoever calculates and sends the real invoice,
// rather than computing (and possibly miscalculating) it here. Logged in
// workflow-migration-table.md.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F07-FUNDING-LOCKED";
export const SMS_TEMPLATE_KEY = "SMS-F07-FUNDING-LOCKED";
const INVOICE_TASK_SOURCE = "f-07-funding-locked";
const FEE_FIX_TASK_SOURCE = "f-07-funding-locked-fee-not-ready";

async function createTaskOnce(db, { orgId, clientId, eventId, source, title }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, source, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, clientId, null, title, eventId, null, source]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const { approvedAmount, feePercent } = event.payload || {};
  const feeReady = approvedAmount != null && feePercent != null;
  const orgId = event.orgId;
  const eventId = event.id;

  if (!feeReady) {
    await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
    const task = await step.run("create-fee-fix-task", () =>
      createTaskOnce(db, { orgId, clientId, eventId, source: FEE_FIX_TASK_SOURCE, title: "Fix fee lock/percent before invoicing" }));
    return { done: true, feeReady: false, task };
  }

  await step.run("set-funding-locked-date", () => mergeCustomFields(db, clientId, { funding_locked_date: event.payload?.lockedAt || null }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  const invoiceTask = await step.run("create-invoice-task", () =>
    createTaskOnce(db, { orgId, clientId, eventId, source: INVOICE_TASK_SOURCE, title: `Invoice client — approved ${approvedAmount} @ ${feePercent}% (calculate + send)` }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { last_progress_action: "invoice_sent" }));

  return { done: true, feeReady: true, email, sms, invoiceTask };
}

export const f07FundingLocked = inngest.createFunction(
  { id: "f-07-funding-locked", name: "F-07 — Funding Locked" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
