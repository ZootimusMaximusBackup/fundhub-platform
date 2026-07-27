// F-04 — Round Approvals (F3/F5/F7...F21).
// Source: GHL workflow 79c4a7b9-5875-40b6-bfc4-fbbd5f740410 (ghl-crm-source-of-truth.md).
// Audit fix applied: real ready-to-paste SMS/email copy (workflow-coherence-audit.md),
// seeded via src/workflows/templates-seed.mjs — not the original blank SMS + subject.
//
// Trigger: round.approved (exact canonical match). Gate: "Total Approved Amount > 0"
// — this is a validity check (was anything actually approved), not product-amount
// routing, so it doesn't run afoul of Rule 4.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F04-ROUND-APPROVALS";
export const SMS_TEMPLATE_KEY = "SMS-F04-ROUND-APPROVALS";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const approvedAmount = Number(event.payload?.approvedAmount ?? 0);
  if (!(approvedAmount > 0)) return { sent: false, reason: "not_approved" };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Prepare Next Funding Round" }));

  return { sent: true, email, sms };
}

export const f04RoundApprovals = inngest.createFunction(
  { id: "f-04-round-approvals", name: "F-04 — Round Approvals" },
  { event: "round.approved" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
