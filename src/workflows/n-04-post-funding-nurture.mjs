// N-04 — Post-Funding Nurture.
// Source: GHL workflow e7607d09-4882-470a-ac56-8ed216c573a8 (ghl-crm-source-of-truth.md).
// Ports the live [AGENT DRAFT] definition (the sole draft copy for this key; nothing
// to dedupe against).
//
// Original GHL trigger: "Pipeline Stage Changed -> Funding Pipeline -> F23
// Post-Funding Monitoring", gated on tag client:funding present. F23 is the stage a
// client enters immediately after round.funded (Spec §5.2 funding pipeline), and
// having fired round.funded already implies the client:funding gate — so round.funded
// is both the trigger and the gate here, no separate check needed.
//
// SMS copy is confirmed missing in GHL (Chris's tracking note). Wired but gated on a
// template existing.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-N04-POST-FUNDING";
export const SMS_TEMPLATE_KEY = "SMS-N04-POST-FUNDING";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, email, sms };
}

export const n04PostFundingNurture = inngest.createFunction(
  { id: "n-04-post-funding-nurture", name: "N-04 — Post-Funding Nurture" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
