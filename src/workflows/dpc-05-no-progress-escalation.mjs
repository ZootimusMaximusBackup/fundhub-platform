// DPC-05 — 72-Hour No-Progress Escalation.
// Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section.
// Audit fix applied (workflow-coherence-audit.md: "{{booking_link}} renders blank —
// use {{contact.calendar_booking_link}}") — real copy below uses the corrected
// merge field. Seeded via src/workflows/templates-seed.mjs.
//
// Trigger: booking.created -> step.sleep(72h) -> if no decision has been made yet
// (decision_status still unset — DPC-03 sets it), escalate.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DPC05-NO-PROGRESS-72H";
export const SMS_TEMPLATE_KEY = "SMS-DPC05-NO-PROGRESS-72H";
const SOURCE_WORKFLOW = "dpc-05-no-progress-escalation";

// Progress is genuine if last_progress_timestamp was updated after the booking was
// created (i.e. something happened beyond the booking itself), OR if decision_status
// is set. Checking last_progress_timestamp covers clients who advance through the
// pipeline without ever sending the DPC-03 SMS keywords.
async function progressMade(db, clientId, bookingTime) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields || {};
  if (cf.decision_status) return true;
  if (cf.last_progress_timestamp && cf.last_progress_timestamp !== "now") {
    return new Date(cf.last_progress_timestamp) > new Date(bookingTime);
  }
  return false;
}

async function createEscalationTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, "No progress 72h — investigate", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const bookingTime = event.payload?.occurredAt || event.ts || new Date().toISOString();
  await step.sleep("wait-72h", "72h");

  const madeProgress = await step.run("check-progress-made", () => progressMade(db, clientId, bookingTime));
  if (madeProgress) return { done: false, reason: "progress_made" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-escalated", () => addTags(db, clientId, ["dpc:no-progress-escalated"]));
  const task = await step.run("create-escalation-task", () => createEscalationTaskOnce(db, { orgId, clientId, eventId }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, task, email, sms };
}

export const dpc05NoProgressEscalation = inngest.createFunction(
  { id: "dpc-05-no-progress-escalation", name: "DPC-05 — 72-Hour No-Progress Escalation" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
