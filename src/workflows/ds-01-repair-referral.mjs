// DS-01 — Repair Referral.
// Source: GHL DOWNSELL WORKFLOWS section (draft status).
// Audit fix: real, compliance-scrubbed SMS copy exists (Workflow-SMS-Fixes-Ready-to-
// Paste.md), but needs the real partner referral link filled in before activation
// (spec §6: "DS-01: partner referral link filled before activation") — still a
// placeholder today, so the send stays gated on the template existing, same as every
// other pending-copy case in this directory. Never invented here.
//
// Trigger: call.completed with a "declined funding" outcome — the same underlying
// signal S-08 (Post-Call: Funding Didn't Buy) reacts to, since neither the map nor
// the CRM doc gives DS-01 its own distinct trigger definition. Gated additionally on
// NOT being on the funding path (same product-path check DS-02 uses), so this and
// DS-02 can never both fire for the same outcome.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export const SMS_TEMPLATE_KEY = "SMS-DS01-REPAIR-REFERRAL";
export const EMAIL_TEMPLATE_KEY = "EMAIL-DS01-REPAIR-REFERRAL";

export async function handle({ event, db, step }) {
  if (event.payload?.outcome !== "declined") return { done: false, reason: "not_declined" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (isFundingPath(outcomeTier)) return { done: false, reason: `blocked_funding_route:${outcomeTier}` };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-repair-referral", () => addTags(db, clientId, ["client:repair-referral"]));
  await step.run("set-product-path", () => mergeCustomFields(db, clientId, { product_path: "Referred" }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, email, sms };
}

export const ds01RepairReferral = inngest.createFunction(
  { id: "ds-01-repair-referral", name: "DS-01 — Repair Referral" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
