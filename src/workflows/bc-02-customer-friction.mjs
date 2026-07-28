// BC-02 — Customer Friction Level Detector.
// Source: GHL-System-Map.md BEHAVIORAL COMPLIANCE section.
// Writes to behavior_scores.friction (numeric). GHL's High/Medium/Low mapped to
// 1.0/0.5/0.0 (same mapping convention as BC-01's responsiveness).
//
// Trigger: round.started (same trigger as BC-01 — recomputes friction from whichever
// escalation tags are present on the client at that moment: ar:collections = High,
// docs:missing or ops:action-required = Medium, otherwise Low).
//
// KNOWN GAP (see bc-01-customer-responsiveness.mjs / workflow-migration-table.md):
// behavior_scores has no idempotency hook in this schema — a replayed event writes
// a second row. Low-risk (analytics only), logged rather than hidden.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";

export const FRICTION = { high: 1.0, medium: 0.5, low: 0.0 };

// Priority order is the doc's (05/30 lines 787-825). call:no_show was missing from this
// router entirely, so a no-show fell through to "low" — the opposite of doc line 794,
// which sets Customer Friction Level = High and exits.
function classifyFriction(tags) {
  const t = tags || [];
  if (t.includes("ar:collections")) return "high";
  if (t.includes("call:no_show")) return "high";
  if (t.includes("docs:missing") || t.includes("ops:action-required")) return "medium";
  return "low";
}

async function recordScore(db, { orgId, clientId, friction }) {
  await db.query(`INSERT INTO behavior_scores (org_id, client_id, friction) VALUES ($1,$2,$3)`, [orgId, clientId, friction]);
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const r = await step.run("read-tags", () => db.query(`SELECT tags FROM clients WHERE id = $1`, [clientId]));
  const level = classifyFriction(r.rows[0]?.tags);
  await step.run("record-score", () => recordScore(db, { orgId: event.orgId, clientId, friction: FRICTION[level] }));

  return { done: true, friction: level };
}

export const bc02CustomerFriction = inngest.createFunction(
  { id: "bc-02-customer-friction", name: "BC-02 — Customer Friction Level Detector" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
