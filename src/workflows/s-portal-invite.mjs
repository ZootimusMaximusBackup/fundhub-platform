// Portal invite on booking. Spec 4.2 (2026-08-22).
// EMAIL-PORTAL-MAGIC-LINK already exists and is used when a client asks for a
// login link. This workflow also fires it on booking.created. Email only.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { requestMagicLink } from "../auth/magic-link.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const LOCK_FIELD = "portal_invite_sent_at";

export async function handle({ event, db, step, requestMagicLinkImpl = requestMagicLink }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const email = await step.run("load-email", async () => {
    const fromPayload = String(event.payload?.email || event.payload?.attendeeEmail || "").trim();
    if (fromPayload) return fromPayload;
    const r = await db.query(`SELECT email, phone FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
    return r.rows[0]?.email || null;
  });
  if (!email) return { done: false, reason: "no_email" };

  const locked = await step.run("check-portal-invite", async () => {
    const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
    return Boolean(r.rows[0]?.custom_fields?.[LOCK_FIELD]);
  });
  if (locked) return { done: false, reason: "already_locked" };
  await step.run("lock-portal-invite", () =>
    mergeCustomFields(db, clientId, { [LOCK_FIELD]: new Date().toISOString() }));

  const issued = await step.run("send-portal-invite", () =>
    requestMagicLinkImpl(db, { email, orgId }));

  return { done: true, issued };
}

export const sPortalInvite = inngest.createFunction(
  { id: "s-portal-invite", name: "S-PORTAL — Booking Portal Invite" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
