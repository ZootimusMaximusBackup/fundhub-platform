// S-01 — New Lead / Intake.
// Source: GHL-System-Map.md SALES WORKFLOWS section ("ADD WEBHOOK TO ANALYZER").
// The GHL-internal webhook step (POST back to GHL's own webhook-trigger endpoint)
// dies with GHL per Spec §2 — not ported, nothing on our side needs it.
//
// Trigger: entry.captured. client-lifecycle.mjs's onEntryCaptured already creates
// the client row on this same event; this adds the lifecycle-status field + lead
// tag GHL set alongside contact creation.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-lifecycle-status", () => mergeCustomFields(db, clientId, { lifecycle_status: "New Lead" }));
  await step.run("tag-lead-new", () => addTags(db, clientId, ["lead:new"]));

  return { done: true };
}

export const s01NewLeadIntake = inngest.createFunction(
  { id: "s-01-new-lead-intake", name: "S-01 — New Lead / Intake" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
