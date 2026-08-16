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
import { createTask } from "../lib/create-task.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DPC05-NO-PROGRESS-72H";
export const SMS_TEMPLATE_KEY = "SMS-DPC05-NO-PROGRESS-72H";
const SOURCE_WORKFLOW = "dpc-05-no-progress-escalation";

// The 05/30 rule (doc lines 178-179, 197-199) is a single sliding test: escalate when
// cf_last_progress_timestamp is older than 72 hours, the contact is a client, and it has
// not already been escalated. It is NOT "did anything happen since the booking".
//
// The old version had two defects this replaces:
//   1. It compared progress against the BOOKING time, so a client who did one thing an
//      hour after booking and then went silent for weeks read as "progress made" forever.
//   2. It short-circuited on decision_status being set at all — a contact who decided and
//      then stalled could never be escalated.
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

export function isStalled(customFields, nowMs = Date.now()) {
  const cf = customFields || {};
  const ts = cf.last_progress_timestamp;
  if (!ts || ts === "now") return true; // never progressed — that is the stalled case
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t > SEVENTY_TWO_HOURS_MS;
}

// Doc line 198: escalation targets "any contact ... [that] is a client". These are the
// Part A client tags (lines 78, 83, 88) — note 05/30 replaced the old blanket
// client:repair with the two outsourced-lane tags.
export const CLIENT_TAGS = ["client:funding", "client:repair-referral", "client:diy-letters"];

// Doc line 198: "and has not already been escalated".
export const ESCALATED_TAG = "dpc:no-progress-escalated";

// Doc line 179 + Part B line 154: a hard-stopped contact is out of the pipeline.
export function isHardStopped(customFields) {
  return Boolean((customFields || {}).hard_stop_reason);
}

async function escalationState(db, clientId) {
  const r = await db.query(`SELECT custom_fields, tags FROM clients WHERE id = $1`, [clientId]);
  const row = r.rows[0] || {};
  const tags = row.tags || [];
  return {
    customFields: row.custom_fields || {},
    isClient: CLIENT_TAGS.some((t) => tags.includes(t)),
    alreadyEscalated: tags.includes(ESCALATED_TAG)
  };
}

async function createEscalationTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "No progress 72h — investigate",
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

  await step.sleep("wait-72h", "72h");

  const state = await step.run("check-escalation-state", () => escalationState(db, clientId));

  // Gate order matters: the client-type check comes FIRST because failing it means we
  // must not send anything. Before this, a lead who booked a call and never became a
  // client still received the escalation email AND SMS 72 hours later.
  if (!state.isClient) return { done: false, reason: "not_a_client" };
  if (state.alreadyEscalated) return { done: false, reason: "already_escalated" };
  if (isHardStopped(state.customFields)) return { done: false, reason: "hard_stopped" };
  if (!isStalled(state.customFields)) return { done: false, reason: "progress_made" };

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
