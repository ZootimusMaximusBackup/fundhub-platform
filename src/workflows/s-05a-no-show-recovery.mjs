// S-05a — No-Show Recovery.
// Source: GHL sticky "S-05a No-Show Recovery". Trigger: booking.noshow
// (Cal.com BOOKING_NO_SHOW / MEETING_NO_SHOW). Tags, templates, recovery task.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S05A-NOSHOW-RECOVERY";
export const SMS_TEMPLATE_KEY = "SMS-S05A-NOSHOW-RECOVERY";
export const SOURCE_WORKFLOW = "s-05a-no-show-recovery";

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;

  await step.run("tag-no-show", () => addTags(db, clientId, ["call:no_show"]));

  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  const task = await step.run("create-recovery-task", () =>
    createTask(db, {
      orgId,
      clientId,
      title: "No-show recovery — rebook",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "closer",
      eventId,
      dueAt: null
    }));

  return { done: true, email, sms, task };
}

export const s05aNoShowRecovery = inngest.createFunction(
  { id: "s-05a-no-show-recovery", name: "S-05a — No-Show Recovery" },
  { event: "booking.noshow" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
