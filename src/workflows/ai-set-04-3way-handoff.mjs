// AI-SET-04 — 3-Way Text Handoff.
// Source: GHL-System-Map.md AI SETTER section.
// Audit fix applied (Spec §6 + workflow-coherence-audit.md: "draft, never fires, no
// trigger, no advisor follow-up. Publish, wire into DPC-03, add advisor message") —
// this file IS that publish + wiring: real trigger (T-15 off Cal.com), real
// compliance-scrubbed copy (Workflow-SMS-Fixes-Ready-to-Paste.md), plus the advisor
// follow-up task the original lacked.
//
// Trigger: booking.created. Fires 15 minutes before the appointment's start time via
// a durable sleepUntil — not a poll, a single scheduled wake.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";

export const SMS_TEMPLATE_KEY = "SMS-AISET04-HANDOFF";
const SOURCE_WORKFLOW = "ai-set-04-3way-handoff";

async function createAdvisorTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, clientId, null, "3-way handoff — advisor follow-up on UnderwriteIQ results", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const startTime = event.payload?.startTime;
  if (!startTime) return { done: false, reason: "no_start_time" };

  const target = new Date(new Date(startTime).getTime() - 15 * 60 * 1000);
  await step.sleepUntil("wait-until-t-minus-15", target);

  const orgId = event.orgId;
  const eventId = event.id;
  const sms = await step.run("send-handoff-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  const task = await step.run("create-advisor-task", () => createAdvisorTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, sms, task };
}

export const aiSet043WayHandoff = inngest.createFunction(
  { id: "ai-set-04-3way-handoff", name: "AI-SET-04 — 3-Way Text Handoff" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
