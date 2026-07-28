// C-06 — CRS Results Router.
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// Trigger: analysis.completed, gated on source === "crs" (same gate as U-03/U-04 —
// this reacts to the CRS pull specifically, not the analyzer estimate). Missing
// results (no scores at all) holds on a missing-snapshot tag instead of routing.
//
// Tier comes from resolveOutcomeTier, not clientOutcomeTier: this fires on the
// analysis.completed that the CRS adapter emits immediately BEFORE decision.rendered,
// so `clients.outcome_tier` is not written yet and the column read routed every run
// to "not_funding" (see workflow-migration-table.md, "Model drift").

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { resolveOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { sendTemplated } from "./messaging.mjs";

export const DECLINE_EMAIL_TEMPLATE_KEY = "EMAIL-C06-DECLINE";
export const DECLINE_SMS_TEMPLATE_KEY = "SMS-C06-DECLINE";
const SOURCE_WORKFLOW = "c-06-crs-results-router";

function hasResults(payload) {
  const s = payload?.scores || {};
  return s.ex != null || s.eq != null || s.tu != null;
}

// --- GATE C-06C: hard decline (OFAC / fraud / severe public record) ----------
// 05/30 doc lines 84-86 and 4204-4211. The DECLINE branch is the third outcome of the
// Stage 5 fork and it was missing from this port entirely — hard declines fell through
// to "not_funding" with no tag, no task and no decline messaging.
//
// ⚠️ DEFERRED — DO NOT FILL THIS IN BY GUESSING. Doc line 4204 marks the gate itself:
//   "GATE C-06C — Hard decline? (OFAC / fraud / severe public record)
//    DEFERRED: exact field/tag names until CRS onboarding finalizes."
// and line 4232 repeats it under DEFERRED: "Map hard-decline signals from CRS/
// UnderwriteIQ to GATE C-06C".
//
// So the branch below is wired end to end but the DETECTOR is a named no-op. Inventing a
// threshold here would send real decline email + SMS and close a real opportunity off a
// guess — a money and compliance decision that is not this port's to make. When CRS
// onboarding lands, replace the body of isHardDecline() with the real signal map; every
// action below is already in place and the branch starts working.
export const HARD_DECLINE_SIGNALS_DEFERRED = true;

export function isHardDecline(_payload) {
  if (HARD_DECLINE_SIGNALS_DEFERRED) return false; // no-op until the signal map exists
  return false;
}

async function createDeclineTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`,
    [clientId, SOURCE_WORKFLOW, eventId]
  );
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, "Declined after CRS — document reason + confirm messaging sent", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

// `detectDecline` is injectable purely so the wiring below can be proven under test
// without inventing a threshold in production code. Default is the deferred no-op.
export async function handle({ event, db, step, detectDecline = isHardDecline }) {
  if (event.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  if (!hasResults(event.payload)) {
    await step.run("tag-snapshot-missing", () => addTags(db, clientId, ["hold:snapshot_missing"]));
    return { done: true, branch: "missing_results" };
  }

  // DECLINE is evaluated first — doc 4210 orders it ahead of REPAIR and FUNDING.
  if (detectDecline(event.payload)) {
    const orgId = event.orgId;
    const eventId = event.id;
    await step.run("tag-hold-declined", () => addTags(db, clientId, ["hold:declined"]));
    await step.run("set-decline-state", () => mergeCustomFields(db, clientId, {
      hard_stop_reason: "disqualified",
      employee_next_action: "Closed/Stop"
    }));
    const task = await step.run("create-decline-task", () => createDeclineTaskOnce(db, { orgId, clientId, eventId }));
    const email = await step.run("send-decline-email", () =>
      sendTemplated(db, { orgId, clientId, channel: "email", templateKey: DECLINE_EMAIL_TEMPLATE_KEY, eventId }));
    const sms = await step.run("send-decline-sms", () =>
      sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: DECLINE_SMS_TEMPLATE_KEY, eventId }));
    return { done: true, branch: "decline", task, email, sms };
  }

  const outcomeTier = await step.run("check-product-path", () => resolveOutcomeTier(db, clientId, event.payload));
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
