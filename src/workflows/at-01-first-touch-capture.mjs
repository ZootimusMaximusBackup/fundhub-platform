// AT-01 — First Touch Capture.
// Source: GHL-System-Map.md ATTRIBUTION WORKFLOWS section.
// AT-02 (Attribution Normalizer) is a defensive re-check of the same "don't
// overwrite First Touch Date once set" rule this file already enforces via its own
// gate — merged in rather than built as a separate file (see workflow-migration-table.md).
// The other "S-02 — Attribution Capture" entry in the map sets the exact same field
// for the exact same reason — also merged in here, not built separately.
//
// Trigger: entry.captured. Sticky: only ever set once (gate on currently empty).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const r = await step.run("check-first-touch", () => db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]));
  if (r.rows[0]?.custom_fields?.first_touch_date) return { done: false, reason: "already_locked" };

  await step.run("set-first-touch", () => mergeCustomFields(db, clientId, { first_touch_date: "now", lead_magnet_type: "Survey" }));
  return { done: true };
}

export const at01FirstTouchCapture = inngest.createFunction(
  { id: "at-01-first-touch-capture", name: "AT-01 — First Touch Capture" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
