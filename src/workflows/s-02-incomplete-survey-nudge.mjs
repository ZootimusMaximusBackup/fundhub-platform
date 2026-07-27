// S-02 — Incomplete App (Survey).
// Source: GHL-System-Map.md SALES WORKFLOWS section.
// Audit fix applied (workflow-coherence-audit.md: "S-02 — 2-min wait before
// survey-complete check; too short. Bump to 15-30 min") — 20 min picked (midpoint
// of the given range, a timing choice not a business one).
//
// (A second, unrelated "S-02 — Attribution Capture" also exists in the map with the
// same key; that one is a duplicate of AT-01's First Touch Date logic and isn't
// ported separately — see workflow-migration-table.md.)
//
// Trigger: entry.captured -> step.sleep(20m) -> check whether survey.submitted has
// since fired. If yes, tag survey:complete and stop (no nudge). If not, send the
// "finish your application" nudge.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S02-FINISH-APPLICATION";

async function surveyCompleted(db, clientId) {
  const r = await db.query(`SELECT DISTINCT name FROM events WHERE client_id = $1 AND name = ANY($2)`, [clientId, ["survey.submitted"]]);
  return r.rows.some((row) => row.name === "survey.submitted");
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.sleep("wait-20-min", "20m");

  const completed = await step.run("check-survey-complete", () => surveyCompleted(db, clientId));
  if (completed) {
    await step.run("tag-survey-complete", () => addTags(db, clientId, ["survey:complete"]));
    return { done: true, nudged: false };
  }

  const email = await step.run("send-nudge-email", () =>
    sendTemplated(db, { orgId: event.orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId: event.id }));

  return { done: true, nudged: true, email };
}

export const s02IncompleteSurveyNudge = inngest.createFunction(
  { id: "s-02-incomplete-survey-nudge", name: "S-02 — Incomplete App (Survey)" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
