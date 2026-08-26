// AF-02 — Referral Ownership Capture.
// Source: GHL workflow 0c561c0b-6216-4068-844d-35f307285ca6 (ghl-crm-source-of-truth.md).
//
// Original triggers were "Tag Added: lead:new / analyzer:started / analyzer:complete"
// — all three map cleanly onto canonical events already in canonical.mjs:
// lead:new -> entry.captured, analyzer:started -> diagnostic.paid (the $32 analyzer
// pull payment), analyzer:complete -> analysis.completed. No new event needed.
//
// This one operates entirely on the LEAD's own client record (clients.custom_fields)
// — "Affiliate Tier1/Tier2 Owner" here just means "which affiliate referred this
// lead", captured from inbound referral params (a1/a2) on the triggering event's
// payload. Sticky: only ever set once, never overwritten (GHL's own rule) — enforced
// by gating on the field currently being empty before writing.
//
// Also writes affiliate_referrals via attribute() when a1 matches a live tracking
// id, so portal REFERRED counts and later convert() can settle commissions.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { attribute } from "../affiliates/economics.mjs";

async function currentOwners(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields || {};
  return { firstTouchDate: cf.first_touch_date || null, tier1Owner: cf.affiliate_tier1_owner || null, tier2Owner: cf.affiliate_tier2_owner || null };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const { a1, a2 } = event.payload || {};
  if (!a1 && !a2) return { done: false, reason: "no_referral_param" };

  const owners = await step.run("check-current-owners", () => currentOwners(db, clientId));
  const eligible = !owners.firstTouchDate || !owners.tier1Owner;
  if (!eligible) return { done: false, reason: "ownership_already_locked" };

  const patch = {};
  if (!owners.firstTouchDate) patch.first_touch_date = event.payload?.occurredAt || new Date().toISOString();
  if (!owners.tier1Owner && a1) patch.affiliate_tier1_owner = a1;
  if (!owners.tier2Owner && a2) patch.affiliate_tier2_owner = a2;

  await step.run("set-ownership", () => mergeCustomFields(db, clientId, patch));

  // Also write affiliate_referrals so portal REFERRED / CONVERTED tiles grow.
  // custom_fields stay as the sticky first-touch mirror (GHL parity).
  let referral = null;
  if (a1 && patch.affiliate_tier1_owner) {
    referral = await step.run("attribute-direct", async () => {
      const client = (await db.query(
        `SELECT org_id FROM clients WHERE id = $1`,
        [clientId]
      )).rows[0];
      if (!client?.org_id) return { attributed: false, reason: "no_client_row" };
      const aff = (await db.query(
        `SELECT id FROM affiliates
          WHERE org_id = $1 AND upper(tracking_id) = upper($2)
          LIMIT 1`,
        [client.org_id, a1]
      )).rows[0];
      if (!aff) return { attributed: false, reason: "unknown_tracking_id" };
      return attribute(db, {
        orgId: client.org_id,
        affiliateId: aff.id,
        clientId,
        tier: "direct",
        trackingIdUsed: a1,
        source: "af-02",
        sourceEvent: event?.name ? String(event.name) : undefined
      });
    });
  }

  return { done: true, patch, referral };
}

export const af02ReferralOwnershipCapture = inngest.createFunction(
  { id: "af-02-referral-ownership-capture", name: "AF-02 — Referral Ownership Capture" },
  [{ event: "entry.captured" }, { event: "diagnostic.paid" }, { event: "analysis.completed" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
