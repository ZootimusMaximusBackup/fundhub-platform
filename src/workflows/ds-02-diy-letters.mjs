// DS-02 — DIY Letters.
// Source: GHL workflow (GHL-System-Map.md DOWNSELL WORKFLOWS section).
//
// HARD RULE 1 — the reason this file exists in this exact shape: dispute letters
// fire ONLY on the not-qualified downsell path, never on the funding route. The
// product-name gate (Rule 4: route by NAME, "Consulting Services Package" — the
// $1,000 DIY product per Spec §4.2 — never by dollar amount) and the funding-route
// block below are BOTH covered by tests proving each direction
// (ds-02-diy-letters.test.mjs) — that test is the actual point of this file.
//
// The invoice stub is now wired to src/invoices/ (017_invoices migration).
// Commas outbound checkout is still a manual task — the invoice record here is
// the platform's internal ledger entry (money owed), not a Commas API call.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isRepairOnlyPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { createInvoice, depositKey } from "../invoices/index.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DS02-DIY-LETTERS-READY";
const SOURCE_WORKFLOW = "ds-02-diy-letters";
export const DELIVER_LETTERS_URL = process.env.UIQ_DELIVER_LETTERS_URL || "https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters";

function isDiyProduct(productName) {
  const n = String(productName || "").toLowerCase();
  return n.includes("consulting services package") || n.includes("diy");
}

async function createInvoiceTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, "Send DIY invoice (Commas checkout) — confirm payment captured", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

async function deliverLetters(fetchImpl, { clientId, orgId }) {
  if (typeof fetchImpl !== "function") return { delivered: false, reason: "no_fetch_available" };
  try {
    const res = await fetchImpl(DELIVER_LETTERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, orgId })
    });
    return { delivered: Boolean(res && res.ok), status: res?.status };
  } catch (err) {
    return { delivered: false, error: String(err?.message || err) };
  }
}

async function deliverLettersOnce(db, fetchImpl, { clientId, orgId, eventId }) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  if (r.rows[0]?.custom_fields?.diy_delivered_event_id === eventId) {
    return { delivered: true, skipped: true };
  }
  const result = await deliverLetters(fetchImpl, { clientId, orgId });
  if (result.delivered) {
    await db.query(`UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
      [clientId, JSON.stringify({ diy_delivered_event_id: eventId })]);
  }
  return result;
}

// handle — pure business logic. `fetchImpl` is injected (defaults to global fetch)
// so tests can supply a fake instead of making a real network call.
export async function handle({ event, db, step, fetchImpl = globalThis.fetch }) {
  if (!isDiyProduct(event.payload?.productName ?? event.payload?.product)) {
    return { done: false, reason: "not_diy_product" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // HARD RULE 1 — only REPAIR_ONLY gets DIY letters. Fail closed: null/unknown tier = do NOT send.
  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isRepairOnlyPath(outcomeTier)) return { done: false, reason: `blocked_not_repair_only:${outcomeTier ?? "null"}` };

  const orgId = event.orgId;
  const eventId = event.id;

  await step.run("set-diy-status-processing", () => mergeCustomFields(db, clientId, { diy_status: "Processing" }));
  const { saleId, amount } = event.payload || {};
  const invoice = await step.run("create-deposit-invoice", () =>
    createInvoice(db, {
      orgId,
      clientId,
      invoiceType: "deposit",
      amount: Number(amount) || 0,
      saleId: saleId ?? null,
      idempotencyKey: saleId ? depositKey(saleId) : null,
      notes: "DS-02 DIY Consulting Services Package",
    }));
  const invoiceTask = await step.run("create-invoice-task", () => createInvoiceTaskOnce(db, { orgId, clientId, eventId }));
  const delivery = await step.run("deliver-letters", () => deliverLettersOnce(db, fetchImpl, { clientId, orgId, eventId }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  await step.run("tag-diy-letters", () => addTags(db, clientId, ["client:diy-letters"]));
  await step.run("set-diy-status-final", () =>
    mergeCustomFields(db, clientId, { diy_status: delivery.delivered ? "Delivered" : "Delivery Failed — Retry" }));

  return { done: true, invoice, invoiceTask, delivery, email };
}

export const ds02DiyLetters = inngest.createFunction(
  { id: "ds-02-diy-letters", name: "DS-02 — DIY Letters" },
  { event: "payment.received" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
