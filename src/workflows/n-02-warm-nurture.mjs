// N-02 — Long-Term Warm Nurture.
// Source: the CRM workflow d7e27768-7c48-4329-80f4-f0b6a77980a1 (ghl-crm-source-of-truth.md).
// Same folder-name discrepancy as N-01 (see workflow-migration-table.md); ports the
// live definition, not the [AGENT DRAFT] copy.
//
// Original the CRM trigger was "Tag Added: nurture:warm"; replaced with funnel-depth
// classification (see src/config/lead-temperature.mjs — flagged for Chris). Only
// survey.submitted can newly put a lead into "warm" (booking.created/call.completed
// only ever move a lead OUT of warm, into hot), so that's the only trigger needed.
//
// SMS copy is confirmed missing in the CRM (Chris's tracking note). Wired but gated on a
// template existing.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { currentTemperature } from "../config/lead-temperature.mjs";
import { sendTemplated } from "./messaging.mjs";

// RETIRED 2026-08-22 — N-02 no longer fires on survey.submitted. Kept for the
// seed/audit trail. S-NOBOOK owns the post-survey chase alone.
export const EMAIL_TEMPLATE_KEY = "EMAIL-N02-WARM-NURTURE";
export const SMS_TEMPLATE_KEY = "SMS-N02-WARM-NURTURE";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const temperature = await step.run("classify-temperature", () => currentTemperature(db, clientId));
  if (temperature !== "warm") return { sent: false, reason: `not_warm:${temperature}` };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, email, sms };
}

// RETIRED 2026-08-22 — survey.submitted trigger removed. Same defect as N-01:
// long-term copy was landing on brand-new leads. S-NOBOOK owns that chase.
export const n02WarmNurture = inngest.createFunction(
  { id: "n-02-warm-nurture", name: "N-02 — Long-Term Warm Nurture" },
  [],
  ({ event, step }) => handle({ event: event.data, db, step })
);
