// U-05 — UnderwriteIQ Data Health Monitor (CRS-free).
// Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section.
// Trigger: analysis.completed. Checks the payload for the critical fields the
// analyzer is expected to have populated (scores + utilization); missing any of
// them tags analyzer:data-incomplete + raises a mapping-fix task, otherwise clears
// the tag if it was set.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { addTags, removeTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";

const SOURCE_WORKFLOW = "u-05-data-health-monitor";

function criticalFieldsOk(payload) {
  const scores = payload?.scores || {};
  return (scores.ex != null || scores.eq != null || scores.tu != null) && payload?.utilization != null;
}

async function createMappingTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "Fix UnderwriteIQ mapping — critical fields missing",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const ok = criticalFieldsOk(event.payload);
  if (!ok) {
    await step.run("tag-incomplete", () => addTags(db, clientId, ["analyzer:data-incomplete"]));
    const task = await step.run("create-mapping-task", () => createMappingTaskOnce(db, { orgId: event.orgId, clientId, eventId: event.id }));
    return { done: true, healthy: false, task };
  }

  await step.run("clear-incomplete-tag", () => removeTags(db, clientId, ["analyzer:data-incomplete"]));
  return { done: true, healthy: true };
}

export const u05DataHealthMonitor = inngest.createFunction(
  { id: "u-05-data-health-monitor", name: "U-05 — UnderwriteIQ Data Health Monitor" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
