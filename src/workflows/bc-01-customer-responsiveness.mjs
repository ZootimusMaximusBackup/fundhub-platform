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

// crs_paid — written by client-lifecycle.mjs:onCrsPaid (real writer exists).
// hold_reason on latest round: when F-06 clears the hold on docs.received it sets
// hold_reason = null. If hold_reason is still "Missing Documents" docs are not cleared.
// docs_missing_cleared was invented and never written — replaced with real signals.
// 05/30 doc lines 667-672 (GATE BC-01B — "Which Path?") makes these two paths mutually
// exclusive, chosen by Round Hold Reason:
//   Round Hold Reason = "Awaiting CRS"  -> score CRS-payment responsiveness (CRS Paid)
//   otherwise                            -> score docs responsiveness (docs:missing alone)
//
// The old version tested `crs_paid === true` FIRST, on both paths. Every funding client
// pays the CRS diagnostic, so that short-circuit returned true for all of them and the
// docs path could never produce anything but "fast" — the two paths collapsed into one.
async function responded(db, clientId) {
  const cfRow = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = cfRow.rows[0]?.custom_fields || {};

  // Which path? Round Hold Reason lives on the contact (doc 184-190), same field C-02
  // and C-03 read.
  if (cf.round_hold_reason === "Awaiting CRS") {
    return cf.crs_paid === true; // CRS-payment path (doc 703-715)
  }

  // Docs path (doc 677-688): the docs-missing signal alone, never CRS payment.
  const tagRow = await db.query(`SELECT tags FROM clients WHERE id = $1`, [clientId]);
  return !(tagRow.rows[0]?.tags || []).includes("docs:missing");
}

async function recordScore(db, { orgId, clientId, responsiveness }) {
  await db.query(
    `INSERT INTO behavior_scores (org_id, client_id, responsiveness) VALUES ($1,$2,$3)`,
    [orgId, clientId, responsiveness]
  );
}

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.sleep("wait-24h", "24h");
  const clearedFast = await step.run("check-24h", () => responded(db, clientId));
  if (clearedFast) {
    await step.run("record-fast", () => recordScore(db, { orgId: event.orgId, clientId, responsiveness: RESPONSIVENESS.fast }));
    return { done: true, responsiveness: "fast" };
  }

  await step.sleep("wait-48h", "48h");
  const clearedNormal = await step.run("check-48h", () => responded(db, clientId));
  const level = clearedNormal ? "normal" : "slow";
  await step.run("record-final", () => recordScore(db, { orgId: event.orgId, clientId, responsiveness: RESPONSIVENESS[level] }));
  return { done: true, responsiveness: level };
}

export const bc01CustomerResponsiveness = inngest.createFunction(
  { id: "bc-01-customer-responsiveness", name: "BC-01 — Customer Responsiveness Classifier" },
  { event: "round.started" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
