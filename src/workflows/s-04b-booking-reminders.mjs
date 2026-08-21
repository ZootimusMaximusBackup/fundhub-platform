// S-04B — Booking confirmation + reminders.
// Source: GHL S-04B (confirm / T-24h / T-2h). Owner 2026-08-15: port SMS leg
// only — no video links. Stops if the call is already held before a reminder.
//
// Trigger: booking.created.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { callHappened } from "./dpc-02-call-outcome-enforcement.mjs";

export const SMS_CONFIRM = "SMS-S04-01-CONFIRM";
export const SMS_REMIND_24H = "SMS-S04-02-REMIND-24H";
export const SMS_REMIND_2H = "SMS-S04-03-REMIND-2H";

const HOUR = 60 * 60 * 1000;

function appointmentContext(payload = {}) {
  const startTime = payload.startTime || payload.start_time || null;
  const meeting =
    payload.meetingUrl || payload.meeting_url || payload.meeting_location || null;
  const timezone =
    payload.tzid || payload.timezone || payload.tz || payload.time_zone || null;
  return {
    appointment: {
      start_time: startTime,
      timezone,
      meeting_location: meeting
    }
  };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const payload = event.payload || {};
  const startTime = payload.startTime || payload.start_time || null;
  const context = appointmentContext(payload);

  const confirm = await step.run("send-confirm", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_CONFIRM,
      eventId: `${eventId}:confirm`, context
    }));

  if (!startTime) {
    return { done: true, confirm, skippedReminders: "no_start_time" };
  }

  const t24 = new Date(new Date(startTime).getTime() - 24 * HOUR);
  await step.sleepUntil("wait-t-minus-24h", t24);
  if (await step.run("recheck-24h", () => callHappened(db, clientId))) {
    return { done: true, confirm, stoppedAt: "before-24h", stoppedBecause: "call_held" };
  }
  const remind24 = await step.run("send-remind-24h", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_REMIND_24H,
      eventId: `${eventId}:24h`, context
    }));

  const t2 = new Date(new Date(startTime).getTime() - 2 * HOUR);
  await step.sleepUntil("wait-t-minus-2h", t2);
  if (await step.run("recheck-2h", () => callHappened(db, clientId))) {
    return { done: true, confirm, remind24, stoppedAt: "before-2h", stoppedBecause: "call_held" };
  }
  const remind2 = await step.run("send-remind-2h", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_REMIND_2H,
      eventId: `${eventId}:2h`, context
    }));

  return { done: true, confirm, remind24, remind2 };
}

export const s04bBookingReminders = inngest.createFunction(
  { id: "s-04b-booking-reminders", name: "S-04B — Booking Confirm + Reminders" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
