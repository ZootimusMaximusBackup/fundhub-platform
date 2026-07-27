// DPC-01 — Analyzer Lock.
// Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section.
// Trigger: analysis.completed. Locks in the analyzer path + progress markers.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("lock-analyzer-path", () => mergeCustomFields(db, clientId, {
    analyzer_path: event.payload?.analyzerPath || null,
    last_progress_action: "analyzer_completed",
    last_progress_timestamp: "now"
  }));

  return { done: true };
}

export const dpc01AnalyzerLock = inngest.createFunction(
  { id: "dpc-01-analyzer-lock", name: "DPC-01 — Analyzer Lock" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
