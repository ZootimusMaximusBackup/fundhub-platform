// BC-01 — Customer Responsiveness Classifier.
// Source: GHL-System-Map.md BEHAVIORAL COMPLIANCE section.
// Writes to behavior_scores.responsiveness (numeric) — the schema's nightly-scoring
// column already anticipated this. GHL's categorical Fast/Normal/Slow is mapped to
// 1.0/0.5/0.0 (decision logged in workflow-migration-table.md — the schema column is
// numeric, GHL's was a select field).
//
// Trigger: round.started. Checks docs-missing clearance (crs_paid, or docs:missing
// no longer tagged) at 24h and 48h waits, same wait ladder as the original.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";

export const RESPONSIVENESS = { fast: 1.0, normal: 0.5, slow: 0.0 };

async function docsCleared(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields || {};
  return cf.crs_paid === true || cf.docs_missing_cleared === true;
}

async function recordScore(db, { orgId, clientId, responsiveness }) {
  await db.query(
    `INSERT INTO behavior_scores (org_id, client_id, responsiveness) VALUES ($1,$2,$3)`,
    [orgId, clientId, responsiveness]
  );
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.sleep("wait-24h", "24h");
  const clearedFast = await step.run("check-24h", () => docsCleared(db, clientId));
  if (clearedFast) {
    await step.run("record-fast", () => recordScore(db, { orgId: event.orgId, clientId, responsiveness: RESPONSIVENESS.fast }));
    return { done: true, responsiveness: "fast" };
  }

  await step.sleep("wait-48h", "48h");
  const clearedNormal = await step.run("check-48h", () => docsCleared(db, clientId));
  const level = clearedNormal ? "normal" : "slow";
  await step.run("record-final", () => recordScore(db, { orgId: event.orgId, clientId, responsiveness: RESPONSIVENESS[level] }));
  return { done: true, responsiveness: level };
}

export const bc01CustomerResponsiveness = inngest.createFunction(
  { id: "bc-01-customer-responsiveness", name: "BC-01 — Customer Responsiveness Classifier" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
