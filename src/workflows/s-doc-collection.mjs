// Document collection after deposit. Spec 4.6 (2026-08-22).
// On deposit.paid: request docs and close the funding gate until GHL-DOC accepts.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields, claimCustomFieldLock } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { FUNDING_DOC_HOLD } from "../inquiry-ops/doc-gate.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DOC-01-REQUEST";
export const SMS_TEMPLATE_KEY = "SMS-DOC-01-REQUEST";
export const LOCK_FIELD = "doc_01_request_sent_at";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const claimed = await step.run("claim-doc-request", () =>
    claimCustomFieldLock(db, clientId, LOCK_FIELD));
  if (!claimed) return { done: false, reason: "already_locked" };

  const orgId = event.orgId;
  const eventId = event.id;

  await step.run("set-doc-gate", () => mergeCustomFields(db, clientId, {
    round_hold_reason: FUNDING_DOC_HOLD,
    employee_next_action: "Collect Documents"
  }));
  await step.run("tag-docs-missing", () => addTags(db, clientId, ["docs:missing"]));

  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, email, sms };
}

export const sDocCollection = inngest.createFunction(
  { id: "s-doc-collection", name: "S-DOC — Document Collection Request" },
  { event: "deposit.paid" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
