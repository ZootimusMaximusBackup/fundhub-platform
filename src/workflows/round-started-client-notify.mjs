// Round Started — Client Notify.
// Source: GHL (root)-level workflow, no folder, 1 step (GHL-System-Map.md line 32-34).
// Audit fix (workflow-coherence-audit.md): "orphaned root-level 1-step SMS, no
// folder. Move into Funding folder" — this file IS that move; it lives alongside
// the rest of the funding workflows now. Spec §6: "the enroll-API workaround dies
// with GHL; direct Twilio send with contact context" — sendTemplated below IS that
// direct send (through our own messages/Twilio path, no GHL enroll-API involved).
//
// Real, compliance-scrubbed copy exists (Workflow-SMS-Fixes-Ready-to-Paste.md):
// "Hi {{first_name}}, your FundHub capital round is officially underway — we're
// submitting now and will keep you posted at each step. Reply STOP to opt out."
// Seeded via src/workflows/templates-seed.mjs — still gated on the row actually
// being present, same as every other send in this directory.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";

export const SMS_TEMPLATE_KEY = "SMS-ROUND-STARTED-NOTIFY";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId: event.orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId: event.id }));

  return { sent: true, sms };
}

export const roundStartedClientNotify = inngest.createFunction(
  { id: "round-started-client-notify", name: "Round Started — Client Notify" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
