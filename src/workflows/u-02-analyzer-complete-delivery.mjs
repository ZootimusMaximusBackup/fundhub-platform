// U-02 — Analyzer Complete -> Map + Letters + Delivery Email.
// Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section.
// Real copy exists (EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md: "U-02 Analyzer Funding
// Delivery" / "U-02 Analyzer Repair Delivery") — not seeded here (this port only
// seeded the audit-flagged blank-milestone copy in templates-seed.mjs), so the send
// stays gated on the template existing, same default as everywhere else.
//
// Trigger: analysis.completed. Gate: identity OK (payload.identityOk !== false) —
// if missing, tags analyzer:data-incomplete + a task instead of sending. Routes to
// the Funding or Repair letter-pack delivery template by product path.
//
// Tier comes from resolveOutcomeTier, not clientOutcomeTier: this fires on the
// analysis.completed that the CRS adapter emits immediately BEFORE decision.rendered,
// so `clients.outcome_tier` is not written yet — the column read sent every real pull
// down the "unknown_path" branch and no delivery email went out (see
// workflow-migration-table.md, "Model drift").

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { resolveOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export const FUNDING_EMAIL_TEMPLATE_KEY = "EMAIL-U02-ANALYZER-FUNDING-DELIVERY";
export const REPAIR_EMAIL_TEMPLATE_KEY = "EMAIL-U02-ANALYZER-REPAIR-DELIVERY";
const SOURCE_WORKFLOW = "u-02-analyzer-complete-delivery";

async function createIncompleteTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, "Investigate missing analyzer identity/path", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-analyzer-status", () => mergeCustomFields(db, clientId, { analyzer_status: "Complete" }));

  if (event.payload?.identityOk === false) {
    await step.run("tag-data-incomplete", () => addTags(db, clientId, ["analyzer:data-incomplete"]));
    const task = await step.run("create-incomplete-task", () => createIncompleteTaskOnce(db, { orgId: event.orgId, clientId, eventId: event.id }));
    return { done: true, branch: "data_incomplete", task };
  }

  await step.run("tag-analyzer-complete", () => addTags(db, clientId, ["analyzer:complete"]));

  const outcomeTier = await step.run("check-product-path", () => resolveOutcomeTier(db, clientId, event.payload));
  const orgId = event.orgId;
  const eventId = event.id;

  if (isFundingPath(outcomeTier)) {
    await step.run("tag-path-funding", () => addTags(db, clientId, ["path:funding"]));
    const email = await step.run("send-funding-delivery", () =>
      sendTemplated(db, { orgId, clientId, channel: "email", templateKey: FUNDING_EMAIL_TEMPLATE_KEY, eventId }));
    await step.run("set-funding-delivery-sent", () => mergeCustomFields(db, clientId, { funding_delivery_sent: true }));
    return { done: true, branch: "funding", email };
  }

  // REPAIR IS NOT DELIVERED HERE. Under 05/30 the repair letter pack is the paid DIY
  // product ($1,000 default) and ships only from DS-02, behind the cf_diy_paid gate
  // (doc lines 79-84). This branch used to email the repair deliverable the moment the
  // CRS pull returned — giving away the paid product for free to anyone who landed on a
  // repair tier, before any invoice existed. Repair now only gets tagged and routed;
  // C-06 handles the repair handoff and DS-02 handles fulfilment after payment.
  if (isRepairOnlyPath(outcomeTier)) {
    await step.run("tag-path-repair", () => addTags(db, clientId, ["path:repair"]));
    return { done: true, branch: "repair", delivered: false, reason: "repair_ships_from_ds-02_after_payment" };
  }

  await step.run("tag-data-incomplete-unknown-path", () => addTags(db, clientId, ["analyzer:data-incomplete"]));
  return { done: true, branch: "unknown_path", outcomeTier };
}

export const u02AnalyzerCompleteDelivery = inngest.createFunction(
  { id: "u-02-analyzer-complete-delivery", name: "U-02 — Analyzer Complete Delivery" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
