// C-05 — Pre-Funding Review Logic.
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// Trigger: round.started. If CRS is already complete, raises the pre-funding review
// task; otherwise flags that CRS still needs to be pulled before funding can start.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

const SOURCE_WORKFLOW = "c-05-pre-funding-review";

async function createTaskOnce(db, { orgId, clientId, eventId, title }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, title, eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const r = await step.run("check-crs-status", () => db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]));
  const crsComplete = r.rows[0]?.custom_fields?.crs_status === "Complete";
  const orgId = event.orgId;
  const eventId = event.id;

  if (crsComplete) {
    await step.run("set-review-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Review Funding File" }));
    const task = await step.run("create-review-task", () => createTaskOnce(db, { orgId, clientId, eventId, title: "Pre-funding review — CRS complete" }));
    return { done: true, branch: "review", task };
  }

  await step.run("set-awaiting-crs", () => mergeCustomFields(db, clientId, { round_hold_reason: "Awaiting CRS", employee_next_action: "Pull CRS" }));
  await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
  const task = await step.run("create-cannot-start-task", () => createTaskOnce(db, { orgId, clientId, eventId, title: "Cannot start funding — CRS incomplete" }));
  return { done: true, branch: "awaiting_crs", task };
}

export const c05PreFundingReview = inngest.createFunction(
  { id: "c-05-pre-funding-review", name: "C-05 — Pre-Funding Review Logic" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
