// C-06 — CRS Results Router.
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (same gate as U-03/U-04 —
// this reacts to the CRS pull specifically, not the analyzer estimate). Missing
// results (no scores at all) holds on a missing-snapshot tag instead of routing.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";

function hasResults(payload) {
  const s = payload?.scores || {};
  return s.ex != null || s.eq != null || s.tu != null;
}

export async function handle({ event, db, step }) {
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  if (!hasResults(event.payload)) {
    await step.run("tag-snapshot-missing", () => addTags(db, clientId, ["hold:snapshot_missing"]));
    return { done: true, branch: "missing_results" };
  }

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (isFundingPath(outcomeTier)) {
    await step.run("tag-path-funding", () => addTags(db, clientId, ["path:funding"]));
    return { done: true, branch: "funding" };
  }
  if (isRepairOnlyPath(outcomeTier)) {
    await step.run("tag-path-repair", () => addTags(db, clientId, ["path:repair"]));
    return { done: true, branch: "repair" };
  }
  return { done: true, branch: "not_funding", outcomeTier };
}

export const c06CrsResultsRouter = inngest.createFunction(
  { id: "c-06-crs-results-router", name: "C-06 — CRS Results Router" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
