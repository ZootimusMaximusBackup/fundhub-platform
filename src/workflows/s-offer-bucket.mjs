// Offer-bucket delivery. Spec 4.5 (2026-08-22).
// Trigger: call.completed from a closer save (disposition: "closer").
// Reads offerKey, not outcome. Email only.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const LOCK_FIELD = "offer_bucket_email_sent_at";

export const OFFER_EMAIL = Object.freeze({
  SOFT_PULL: "EMAIL-OFFER-SOFT-PULL",
  FUNDING_DFY: "EMAIL-OFFER-FUNDING-DFY",
  REPAIR_DFY: "EMAIL-OFFER-REPAIR-DFY",
  REPAIR_TRIAL: "EMAIL-OFFER-REPAIR-TRIAL",
  UWIQ_DELIVERABLES: "EMAIL-OFFER-UWIQ-DELIVERABLES",
  FUNDING_MASTERY: "EMAIL-OFFER-FUNDING-MASTERY",
  none: "EMAIL-OFFER-NONE",
  not_a_fit: "EMAIL-OFFER-NONE"
});

export function templateForOffer({ offerKey, outcome } = {}) {
  const key = String(offerKey || "").trim();
  if (key && OFFER_EMAIL[key]) return OFFER_EMAIL[key];
  if (!key && outcome === "not_a_fit") return OFFER_EMAIL.not_a_fit;
  return null;
}

export async function handle({ event, db, step }) {
  const payload = event.payload || {};
  if (payload.disposition !== "closer") {
    return { done: false, reason: "not_closer_disposition" };
  }

  const templateKey = templateForOffer({
    offerKey: payload.offerKey || payload.offer_key,
    outcome: payload.outcome
  });
  if (!templateKey) return { done: false, reason: "no_offer_template" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const locked = await step.run("check-offer-email", async () => {
    const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
    return Boolean(r.rows[0]?.custom_fields?.[LOCK_FIELD]);
  });
  if (locked) return { done: false, reason: "already_locked" };
  await step.run("lock-offer-email", () =>
    mergeCustomFields(db, clientId, { [LOCK_FIELD]: new Date().toISOString() }));

  const email = await step.run("send-offer-email", () =>
    sendTemplated(db, {
      orgId: event.orgId,
      clientId,
      channel: "email",
      templateKey,
      eventId: event.id
    }));

  return { done: true, templateKey, email };
}

export const sOfferBucket = inngest.createFunction(
  { id: "s-offer-bucket", name: "S-OFFER — Closer Offer Bucket Email" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
