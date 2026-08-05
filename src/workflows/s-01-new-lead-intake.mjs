// S-01 — New Lead / Intake.
// Trigger: entry.captured. Creates lifecycle status + lead tag and places a
// Sales board card on new_lead so the client is visible on pipeline.html.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { moveCardToStage } from "./cards.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-lifecycle-status", () => mergeCustomFields(db, clientId, { lifecycle_status: "New Lead" }));
  await step.run("tag-lead-new", () => addTags(db, clientId, ["lead:new"]));

  const orgId = event.orgId;
  let card = null;
  if (orgId) {
    card = await step.run("place-on-new-lead", () =>
      moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "new_lead" }));
  }

  return { done: true, card };
}

export const s01NewLeadIntake = inngest.createFunction(
  { id: "s-01-new-lead-intake", name: "S-01 — New Lead / Intake" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
