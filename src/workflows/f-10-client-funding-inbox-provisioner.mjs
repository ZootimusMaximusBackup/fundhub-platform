// F-10 — Client Funding Inbox Provisioner.
// Source: GHL workflow b76f38d2-057f-481b-a0e4-13d88fe8ab19 (ghl-crm-source-of-truth.md).
// Ports the live [AGENT DRAFT] definition.
//
// Original action #1 was "Send Webhook -> provision_client_funding_inbox" — an
// external inbox-provisioning system with no adapter in this codebase and no
// documented API contract anywhere read for this port. Rather than invent a new
// adapter/endpoint, this computes the deterministic forwarding address (pure string
// formatting, no external call — same monitor+{{contact.id}}@ pattern GHL used) and
// creates an ops task for the actual provisioning + confirmation call, same as the
// "assign pod roles" fallback already used elsewhere. Logged in
// workflow-migration-table.md. F-10R (the inbound webhook confirming provisioning)
// is BLOCKED for the same reason — no file for it, see the migration table.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { createTask } from "../lib/create-task.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F10-INBOX-SETUP";
export const SMS_TEMPLATE_KEY = "SMS-F10-INBOX-SETUP";
const SOURCE_WORKFLOW = "f-10-client-funding-inbox-provisioner";
const TASK_TITLE = "Provision funding inbox: confirm forwarding + bank-only filter";

async function forwardingAddressMissing(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  return !r.rows[0]?.custom_fields?.funding_email_forwarding_address;
}

async function createTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: TASK_TITLE,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const missing = await step.run("check-forwarding-address", () => forwardingAddressMissing(db, clientId));
  if (!missing) return { done: false, reason: "already_set" };

  const forwardingAddress = `monitor+${clientId}@fundhub.ai`;
  await step.run("set-forwarding-address", () => mergeCustomFields(db, clientId, {
    funding_email_forwarding_address: forwardingAddress,
    cf_inbox_forwarding_verified: false
  }));

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  const task = await step.run("create-provision-task", () => createTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, forwardingAddress, email, sms, task };
}

export const f10ClientFundingInboxProvisioner = inngest.createFunction(
  { id: "f-10-client-funding-inbox-provisioner", name: "F-10 — Client Funding Inbox Provisioner" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
