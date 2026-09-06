// DPC-02 — Call Outcome Enforcement + Call Held.
// Source: the CRM system map DECISION & PROGRESS CONTROL section.
// Trigger: booking.created. Waits until 5 minutes after the appointment's end time,
// then checks whether the call actually happened (call.completed fired for this
// client) — Showed moves the sales card to "showed" and tags call_held; No-Show
// moves it to "downsell" no-show handling.
//
// Simplification (logged in workflow-migration-table.md): "did the call happen" is
// checked as "has this client fired call.completed at all", not matched to this
// specific booking — the schema has no booking<->call correlation column. Fine for
// the common one-booking-in-flight case; could misfire if a client has two
// concurrent bookings.
//
// Stage mapping (also logged): db/seed/002_pipelines.sql's sales pipeline has no
// distinct "no_show" stage (the CRM's "S4 No Show") — mapped to the closest existing
// stage, "lost", rather than inventing a new seed row. Also folds in S-05 (No Show)
// and merges DPC-04's decision-related actions where they overlap.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { emit } from "../events/bus.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { moveCardToStage } from "./cards.mjs";
import { addTags } from "./tags.mjs";

// Exported because BS-01's pre-call drip gates on the same question ("has the call
// been held?") and this workflow owns the concept — better one definition than two
// copies of the same SQL drifting apart.
export async function callHappened(db, clientId) {
  const r = await db.query(`SELECT DISTINCT name FROM events WHERE client_id = $1 AND name = ANY($2)`, [clientId, ["call.completed"]]);
  return r.rows.some((row) => row.name === "call.completed");
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const endTime = event.payload?.endTime ?? event.payload?.startTime;
  if (!endTime) return { done: false, reason: "no_appointment_time" };
  const wakeAt = new Date(new Date(endTime).getTime() + 5 * 60 * 1000);
  await step.sleepUntil("wait-until-5-min-after-end", wakeAt);

  const showed = await step.run("check-call-happened", () => callHappened(db, clientId));
  const orgId = event.orgId;

  if (showed) {
    await step.run("set-call-outcome-showed", () => mergeCustomFields(db, clientId, { call_outcome: "showed", last_progress_action: "call_held" }));
    const card = await step.run("move-to-showed", () => moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "showed" }));
    return { done: true, outcome: "showed", card };
  }

  await step.run("set-call-outcome-no-show", () => mergeCustomFields(db, clientId, { call_outcome: "no_show" }));
  await step.run("tag-no-show", () => addTags(db, clientId, ["call:no_show"]));
  const card = await step.run("move-to-no-show", () => moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "lost" }));
  // Live detector: emit booking.noshow so S-05A can start.
  const payload = event.payload || {};
  await step.run("emit-booking-noshow", () =>
    emit(db, "booking.noshow", payload, {
      orgId,
      clientId,
      idempotencyKey: `dpc-02:${payload.bookingUid || event.id}:booking.noshow`
    })
  );
  return { done: true, outcome: "no_show", card };
}

export const dpc02CallOutcomeEnforcement = inngest.createFunction(
  { id: "dpc-02-call-outcome-enforcement", name: "DPC-02 — Call Outcome Enforcement" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
