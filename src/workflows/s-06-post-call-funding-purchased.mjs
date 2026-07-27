// S-06 — Post-Call Outcome: Funding Purchased.
// Source: GHL-System-Map.md SALES WORKFLOWS section.
// Trigger: sale.closed, gated on the funding path (outcome_tier already set by
// decision.rendered, which always precedes sale.closed in the canonical spine).
// Marks the sale-side commitment; F-01 (Funding Intake) handles the funding-ops-side
// kickoff later, when round.started fires — these are sequential, not duplicated.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";

const SOURCE_WORKFLOW = "s-06-post-call-funding-purchased";

async function createIntakeTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, clientId, null, "Funding intake — pull CRS", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isFundingPath(outcomeTier)) return { done: false, reason: `not_funding_path:${outcomeTier}` };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("set-lifecycle-and-path", () => mergeCustomFields(db, clientId, { lifecycle_status: "Funding Client", product_path: "Funding", employee_next_action: "Pull CRS" }));
  await step.run("tag-client-funding", () => addTags(db, clientId, ["client:funding"]));
  await step.run("remove-client-repair-tag", () => removeTags(db, clientId, ["client:repair"]));
  const task = await step.run("create-intake-task", () => createIntakeTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, task };
}

export const s06PostCallFundingPurchased = inngest.createFunction(
  { id: "s-06-post-call-funding-purchased", name: "S-06 — Post-Call Outcome: Funding Purchased" },
  { event: "sale.closed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
