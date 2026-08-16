// C-03 — Inquiry Removed -> Resume or Hold (Fraud Alert Gate).
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// Trigger: inquiry.removed (exact canonical match). Gate: fraud alert present in
// the payload (from whatever fraud-screening step runs during removal).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "c-03-inquiry-removed-resume-or-hold";

async function createTaskOnce(db, { orgId, clientId, eventId, title }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: title,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "inquiry_specialist",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;

  if (event.payload?.fraudAlert) {
    await step.run("set-fraud-hold", () => mergeCustomFields(db, clientId, { round_hold_reason: "Fraud Alert", employee_next_action: "Clear Fraud Alert" }));
    await step.run("tag-fraud-alert", () => addTags(db, clientId, ["fraud:alert-present"]));
    const task = await step.run("create-fraud-task", () => createTaskOnce(db, { orgId, clientId, eventId, title: "Fraud alert present — clear before resuming" }));
    return { done: true, branch: "fraud_hold", task };
  }

  await step.run("clear-inquiry-pending", () => removeTags(db, clientId, ["inquiry:pending"]));
  await step.run("tag-inquiry-completed", () => addTags(db, clientId, ["inquiry:completed"]));
  await step.run("set-ready-for-next-round", () => mergeCustomFields(db, clientId, { ready_for_next_round: true, employee_next_action: "Apply for Funding" }));
  const task = await step.run("create-next-round-task", () => createTaskOnce(db, { orgId, clientId, eventId, title: "Start next funding round — clean file" }));
  return { done: true, branch: "resume", task };
}

export const c03InquiryRemovedResumeOrHold = inngest.createFunction(
  { id: "c-03-inquiry-removed-resume-or-hold", name: "C-03 — Inquiry Removed" },
  { event: "inquiry.removed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
