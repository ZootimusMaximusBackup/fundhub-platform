// S-00 — Welcome. Spec 4.1 (2026-08-22).
// Trigger: entry.captured. Immediate EMAIL-S00-WELCOME + SMS-S00-WELCOME.
// at-01, s-01, af-02 keep running alongside. s-02 is unchanged.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S00-WELCOME";
export const SMS_TEMPLATE_KEY = "SMS-S00-WELCOME";
export const LOCK_FIELD = "s00_welcome_sent_at";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const locked = await step.run("check-welcome", async () => {
    const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
    return Boolean(r.rows[0]?.custom_fields?.[LOCK_FIELD]);
  });
  if (locked) return { done: false, reason: "already_locked" };
  await step.run("lock-welcome", () =>
    mergeCustomFields(db, clientId, { [LOCK_FIELD]: new Date().toISOString() }));

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { done: true, email, sms };
}

export const s00Welcome = inngest.createFunction(
  { id: "s-00-welcome", name: "S-00 — Welcome" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
