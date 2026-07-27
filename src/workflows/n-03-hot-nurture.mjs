// N-03 — Long-Term Hot Nurture.
// Source: GHL workflow 831135dd-175d-4854-b555-1d7582a30249 (ghl-crm-source-of-truth.md).
// Same folder-name discrepancy as N-01/N-02; ports the live definition, not the
// [AGENT DRAFT] copy.
//
// Original GHL trigger was "Tag Added: nurture:hot"; replaced with funnel-depth
// classification (see src/config/lead-temperature.mjs — flagged for Chris). Either
// booking.created or call.completed can newly put a lead into "hot", so both are
// triggers here (diagnostic.paid only ever moves a lead OUT of hot, into exit).
//
// SMS copy is confirmed missing in GHL (Chris's tracking note). Wired but gated on a
// template existing.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { currentTemperature } from "../config/lead-temperature.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-N03-HOT-NURTURE";
export const SMS_TEMPLATE_KEY = "SMS-N03-HOT-NURTURE";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const temperature = await step.run("classify-temperature", () => currentTemperature(db, clientId));
  if (temperature !== "hot") return { sent: false, reason: `not_hot:${temperature}` };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, email, sms };
}

export const n03HotNurture = inngest.createFunction(
  { id: "n-03-hot-nurture", name: "N-03 — Long-Term Hot Nurture" },
  [{ event: "booking.created" }, { event: "call.completed" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
