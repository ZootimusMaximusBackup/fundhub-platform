// DPC-03 — Inbound Reply Router (merges in DPC-04 — Decision Finalizer, AND the
// separate "DPC-04 — Reschedule Rebooking" workflow filed under the AS-Series
// heading in the map — same key, unrelated content: a 2-step SMS + tag reacting to
// the identical "reschedule" reply this file already parses).
// Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section.
// DPC-04 (Decision Finalizer) reacts to the decision status DPC-03 sets, in the same
// request — no separate trigger event exists for "decision status changed", so it's
// the second half of this same handler rather than its own file.
//
// Trigger: message.inbound (exact canonical match). Parses the reply body for
// YES / RESCHEDULE / CLOSE keywords (case-insensitive), sets cf_decision_status,
// and finalizes: YES -> task to send contract + collect payment, move to closed;
// RESCHEDULE -> real SMS with the booking link (real copy exists,
// Workflow-SMS-Stragglers.md) + task + setter:reschedule tag; CLOSE -> move to
// closed, remove nurture tags (matches DPC-04's original "Remove tag:
// nurture:cold,warm,hot" step).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { removeTags, addTags } from "./tags.mjs";
import { moveCardToStage } from "./cards.mjs";
import { sendTemplated } from "./messaging.mjs";

export const SMS_RESCHEDULE_TEMPLATE_KEY = "SMS-DPC04-RESCHEDULE-REBOOKING";
const SOURCE_WORKFLOW = "dpc-03-inbound-reply-router";

// Non-creating lookup by phone — an inbound reply must only ever LINK to an
// existing client, never mint one (same rule src/handlers/comms.mjs follows for
// every inbound-message handler: could be spam).
async function findClientByPhone(db, orgId, phone) {
  if (!orgId || !phone) return null;
  const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`, [orgId, phone]);
  return r.rows[0]?.id || null;
}

function parseDecision(body) {
  const b = String(body || "").trim().toLowerCase();
  if (/\byes\b/.test(b)) return "yes";
  if (/\breschedule\b/.test(b)) return "reschedule";
  if (/\bclose\b|\bstop\b|\bno\b/.test(b)) return "close_file";
  return null;
}

async function createTaskOnce(db, { orgId, clientId, eventId, title, source }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, source, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, title, eventId, null, source]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const decision = parseDecision(event.payload?.body);
  if (!decision) return { done: false, reason: "no_decision_keyword" };

  const clientId = event.clientId || await step.run("resolve-client", () => findClientByPhone(db, event.orgId, event.payload?.from));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("set-decision-status", () => mergeCustomFields(db, clientId, { decision_status: decision, last_progress_timestamp: "now" }));

  if (decision === "yes") {
    const task = await step.run("create-yes-task", () =>
      createTaskOnce(db, { orgId, clientId, eventId, title: "Yes — send contract + collect payment", source: SOURCE_WORKFLOW }));
    const card = await step.run("move-to-closed", () => moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "closed_won" }));
    return { done: true, decision, task, card };
  }

  if (decision === "reschedule") {
    const task = await step.run("create-reschedule-task", () =>
      createTaskOnce(db, { orgId, clientId, eventId, title: "Reschedule — send booking link", source: SOURCE_WORKFLOW }));
    const sms = await step.run("send-reschedule-sms", () =>
      sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_RESCHEDULE_TEMPLATE_KEY, eventId }));
    await step.run("tag-setter-reschedule", () => addTags(db, clientId, ["setter:reschedule"]));
    return { done: true, decision, task, sms };
  }

  // close_file
  const card = await step.run("move-to-closed-file", () => moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "downsell" }));
  await step.run("clear-nurture-tags", () => removeTags(db, clientId, ["nurture:cold", "nurture:warm", "nurture:hot"]));
  return { done: true, decision, card };
}

export const dpc03InboundReplyRouter = inngest.createFunction(
  { id: "dpc-03-inbound-reply-router", name: "DPC-03 — Inbound Reply Router" },
  { event: "message.inbound" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
