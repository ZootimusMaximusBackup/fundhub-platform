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
import { DELIVER_LETTERS_URL } from "./ds-02-diy-letters.mjs";
import { createTask } from "../lib/create-task.mjs";

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

// Placeholder — CRS onboarding will replace this body with the real signal map (doc
// 4232). `deferred`/`signalMap` are injectable purely so the flag-gating in
// isHardDecline can be proven under test end to end (flip the flag, plug in a stand-in
// map) without inventing a threshold in production code: HARD_DECLINE_SIGNALS_DEFERRED
// is a `const`, so nothing outside this module can flip it directly.
function defaultHardDeclineSignalMap(_payload) {
  return false;
}

export function isHardDecline(payload, { deferred = HARD_DECLINE_SIGNALS_DEFERRED, signalMap = defaultHardDeclineSignalMap } = {}) {
  if (deferred) return false; // no-op until the signal map exists
  return Boolean(signalMap(payload));
}

async function createDeclineTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`,
    [clientId, SOURCE_WORKFLOW, eventId]
  );
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "Declined after CRS — document reason + confirm messaging sent",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

// Row 20 (workflow-migration-table.md): the FUNDING branch never fired the deliver-
// letters webhook with the funding letter set. Reuses ds-02's DELIVER_LETTERS_URL —
// same webhook, `letterSet` is what tells UnderwriteIQ-lite which pack to send.
async function deliverFundingLetters(fetchImpl, { clientId, orgId }) {
  if (typeof fetchImpl !== "function") return { delivered: false, reason: "no_fetch_available" };
  try {
    const res = await fetchImpl(DELIVER_LETTERS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, orgId, letterSet: "funding" })
    });
    return { delivered: Boolean(res && res.ok), status: res?.status };
  } catch (err) {
    return { delivered: false, error: String(err?.message || err) };
  }
}

async function deliverFundingLettersOnce(db, fetchImpl, { clientId, orgId, eventId }) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  if (r.rows[0]?.custom_fields?.funding_letters_delivered_event_id === eventId) {
    return { delivered: true, skipped: true };
  }
  const result = await deliverFundingLetters(fetchImpl, { clientId, orgId });
  if (result.delivered) {
    await db.query(`UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
      [clientId, JSON.stringify({ funding_letters_delivered_event_id: eventId })]);
  }
  return result;
}

// `detectDecline` is injectable purely so the wiring below can be proven under test
// without inventing a threshold in production code. Default is the deferred no-op.
// `fetchImpl` defaults to global fetch (mirrors ds-02) so tests can supply a fake
// instead of making a real network call.
export async function handle({ event, db, step, detectDecline = isHardDecline, fetchImpl = globalThis.fetch }) {
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
    const delivery = await step.run("deliver-funding-letters", () =>
      deliverFundingLettersOnce(db, fetchImpl, { clientId, orgId: event.orgId, eventId: event.id }));
    return { done: true, branch: "funding", delivery };
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
