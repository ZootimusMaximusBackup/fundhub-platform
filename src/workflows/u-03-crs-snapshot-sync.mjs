// U-03 — CRS Snapshot Sync (Soft Pull Complete).
// Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (the CRS adapter always
// tags its analysis.completed events this way — src/adapters/crs.mjs).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export async function handle({ event, db, step }) {
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-crs-fields", () => mergeCustomFields(db, clientId, {
    crs_status: "Complete",
    crs_snapshot_date: event.payload?.occurredAt || new Date().toISOString(),
    crs_fico_score: event.payload?.scores?.ex ?? null
  }));
  await step.run("tag-crs-snapshot", () => addTags(db, clientId, ["crs:snapshot"]));

  return { done: true };
}

export const u03CrsSnapshotSync = inngest.createFunction(
  { id: "u-03-crs-snapshot-sync", name: "U-03 — CRS Snapshot Sync" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
