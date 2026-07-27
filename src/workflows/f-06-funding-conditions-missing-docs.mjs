// F-06 — Funding Conditions / Missing Docs.
// Source: GHL workflow 6e296a07-a758-49cb-ac71-686b1ec1da54 (ghl-crm-source-of-truth.md).
// Ports the live [AGENT DRAFT] definition.
//
// Original trigger was "Custom Field: Funding Condition Required = true" — a
// downstream consequence of the bank actually asking for more docs, which is exactly
// what F-11's Bank Email Event Router already classifies as MISSING_DOCS off
// mail.response. Rather than invent a synthetic "custom field updated" event, this
// reacts to mail.response directly (classification === "MISSING_DOCS"), gated on a
// non-empty condition description in the payload. The "docs received, clear the
// hold" half reacts to docs.received (already a canonical event) for the same client.
//
// Sets hold_reason on the most recent funding_round (same "no funding_round_id on
// bank_inbox" limitation as F-09 — logged in workflow-migration-table.md).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags, removeTags } from "./tags.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F06-MISSING-DOCS";
export const SMS_TEMPLATE_KEY = "SMS-F06-MISSING-DOCS";

async function setLatestRoundHoldReason(db, clientId, reason) {
  const r = await db.query(`SELECT id, hold_reason FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`, [clientId]);
  const round = r.rows[0];
  if (!round) return { updated: false };
  await db.query(`UPDATE funding_rounds SET hold_reason = $2 WHERE id = $1`, [round.id, reason]);
  return { updated: true };
}

async function handleMissingDocs({ event, db, step }) {
  if (event.payload?.classification !== "MISSING_DOCS") return { done: false, reason: "not_missing_docs" };
  if (!event.payload?.conditionDescription) return { done: false, reason: "no_condition_description" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-docs-missing", () => addTags(db, clientId, ["docs:missing"]));
  const round = await step.run("set-hold-reason", () => setLatestRoundHoldReason(db, clientId, "Missing Documents"));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { employee_next_action: "Collect Documents" }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, branch: "missing_docs", round, email, sms };
}

async function handleDocsReceived({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("clear-docs-missing", () => removeTags(db, clientId, ["docs:missing"]));
  // Only clear hold_reason when this workflow set it — do not clobber F-09's "Internal Review".
  const round = await step.run("clear-hold-reason", () => clearHoldIfMissingDocs(db, clientId));

  return { done: true, branch: "docs_received", round };
}

async function clearHoldIfMissingDocs(db, clientId) {
  const r = await db.query(`SELECT id, hold_reason FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`, [clientId]);
  const round = r.rows[0];
  if (!round) return { updated: false };
  if (round.hold_reason !== "Missing Documents") return { updated: false, reason: "hold_reason_not_ours" };
  await db.query(`UPDATE funding_rounds SET hold_reason = $2 WHERE id = $1`, [round.id, null]);
  return { updated: true };
}

export async function handle({ event, db, step }) {
  if (event.name === "docs.received") return handleDocsReceived({ event, db, step });
  return handleMissingDocs({ event, db, step });
}

export const f06FundingConditionsMissingDocs = inngest.createFunction(
  { id: "f-06-funding-conditions-missing-docs", name: "F-06 — Funding Conditions / Missing Docs" },
  [{ event: "mail.response" }, { event: "docs.received" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
