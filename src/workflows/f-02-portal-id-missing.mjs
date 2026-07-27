// F-02 — Portal / ID Missing (Onboarding Nudge).
// Source: GHL workflow 4deadbb0-4749-45e5-a1b7-59ccb3d46f4a (ghl-crm-source-of-truth.md).
// Ports the live [AGENT DRAFT] definition (the F-02 in GHL's DECOMMISSIONED folder is
// the DECOM copy per the skip list; this is the other one).
//
// Trigger: round.started (Stage = F1 Funding Intake). Wait 2-4 hours (doc gives a
// range, not a single number — 3h picked as the midpoint; a timing choice, not a
// business-logic one, logged in workflow-migration-table.md). Gate at wake: ID
// Uploaded = false OR Portal Onboarding Status != Complete, both read from
// clients.custom_fields (the interim holder for the carbon-copied GHL fields).
// If still missing after a further 2-day wait, sends a follow-up touch instead of
// repeating the first message.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F02-ID-PORTAL-NEEDED";
export const SMS_TEMPLATE_KEY = "SMS-F02-ID-PORTAL-NEEDED";
export const EMAIL_FOLLOWUP_TEMPLATE_KEY = "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP";

async function docsStillMissing(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields || {};
  return cf.id_uploaded !== true || cf.portal_onboarding_status !== "Complete";
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.sleep("wait-initial", "3h");

  const stillMissing1 = await step.run("check-missing-1", () => docsStillMissing(db, clientId));
  if (!stillMissing1) return { done: true, resolved: true, atCheck: 1 };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-docs-missing", () => addTags(db, clientId, ["docs:missing"]));
  await step.run("set-next-action-1", () => mergeCustomFields(db, clientId, { employee_next_action: "Collect Documents" }));
  const email1 = await step.run("send-email-1", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId: `${eventId}:1` }));
  const sms1 = await step.run("send-sms-1", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId: `${eventId}:1` }));

  await step.sleep("wait-followup", "2d");

  const stillMissing2 = await step.run("check-missing-2", () => docsStillMissing(db, clientId));
  if (!stillMissing2) {
    await step.run("clear-docs-missing", () => removeTags(db, clientId, ["docs:missing"]));
    await step.run("set-completed-progress", () => mergeCustomFields(db, clientId, { last_progress_action: "docs_uploaded" }));
    return { done: true, resolved: true, atCheck: 2, email1, sms1 };
  }

  const email2 = await step.run("send-followup-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_FOLLOWUP_TEMPLATE_KEY, eventId: `${eventId}:2` }));

  return { done: true, resolved: false, email1, sms1, email2 };
}

export const f02PortalIdMissing = inngest.createFunction(
  { id: "f-02-portal-id-missing", name: "F-02 — Portal / ID Missing" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
