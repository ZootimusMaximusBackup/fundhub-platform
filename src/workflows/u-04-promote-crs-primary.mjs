// U-04 — Promote CRS as Primary Snapshot.
// Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (same gate as U-03 — the
// Primary Snapshot rule is "CRS always wins over the Analyzer estimate once it
// lands").
//
// When the event names a crsResultId, that row must exist and belong to this
// org/client — soft-skip (no throw) on missing or wrong-org. Already-primary is
// idempotent. This workflow never pulls live CRS and never emails.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const crsResultId = event.payload?.crsResultId ?? null;
  if (crsResultId) {
    const anchored = await step.run("verify-crs-row", async () => {
      const row = (await db.query(
        `SELECT id, org_id, client_id FROM crs_results WHERE id = $1`,
        [crsResultId]
      )).rows[0];
      return row || null;
    });
    if (!anchored) return { done: false, reason: "missing_crs_row" };
    if (String(anchored.org_id) !== String(event.orgId)
        || String(anchored.client_id) !== String(clientId)) {
      return { done: false, reason: "wrong_org" };
    }
  }

  const cf = await step.run("read-primary-fields", async () => {
    const row = (await db.query(
      `SELECT custom_fields FROM clients WHERE id = $1`,
      [clientId]
    )).rows[0];
    return row?.custom_fields || {};
  });
  const alreadyPrimary = String(cf?.primary_snapshot_source || "") === "CRS";

  // Skip absent metrics so a partial re-pull cannot null an existing primary FICO.
  const patch = { primary_snapshot_source: "CRS" };
  const ex = event.payload?.scores?.ex;
  if (ex != null) patch.primary_fico_score = ex;

  await step.run("promote-crs", () => mergeCustomFields(db, clientId, patch));
  await step.run("remove-primary-analyzer-tag", () => removeTags(db, clientId, ["primary:analyzer"]));
  await step.run("tag-primary-crs", () => addTags(db, clientId, ["primary:crs"]));

  return alreadyPrimary ? { done: true, reason: "already_primary" } : { done: true };
}

export const u04PromoteCrsPrimary = inngest.createFunction(
  { id: "u-04-promote-crs-primary", name: "U-04 — Promote CRS as Primary Snapshot" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
