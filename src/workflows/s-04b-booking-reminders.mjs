// S-04B — Booking confirmation + reminders.
// Source: GHL S-04B (confirm / T-24h / T-2h). Owner 2026-08-15: port SMS leg
// only — no video links. Stops if the call is already held before a reminder.
// Owner 2026-08-22: S-04B also owns the single immediate booking-confirm EMAIL
// (GHL S-04 "Appointment Confirmation"), written fresh — the old copy was
// Analyzer-era and was never wired.
//
// Trigger: booking.created. Spec 4.10: booking.rescheduled cancels the in-flight
// run and restarts against the new start_time (same content).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { callHappened } from "./dpc-02-call-outcome-enforcement.mjs";
import {
  requestMagicLink, magicLinkUrl, portalLoginUrl, BOOKING_CONFIRM_LINK_TTL_MINUTES
} from "../auth/magic-link.mjs";

export const SMS_CONFIRM = "SMS-S04-01-CONFIRM";
export const EMAIL_CONFIRM = "EMAIL-S04-01-CONFIRM";
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

/* No token could be minted. The email still gets a real link — the sign-in page
   that mails one — plus the reason, which is for the run log and never for the
   client. `expires_minutes` is empty because a page that asks for your address
   does not expire; the template prints it nowhere, and a number here would be a
   promise about a token that was never made. */
function fallbackPortalLink(reason) {
  return { issued: false, reason, url: portalLoginUrl(), expires_minutes: "" };
}

export async function handle({ event, db, step, requestMagicLinkImpl = requestMagicLink }) {
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

  // Owner 2026-08-23: the confirm email carries portal access. Token is 365 days
  // and still single-use. The separate EMAIL-PORTAL-MAGIC-LINK send does not fire.
  const portal = await step.run("issue-booking-portal-link", async () => {
    const fromPayload = String(payload.email || payload.attendeeEmail || "").trim();
    let email = fromPayload;
    if (!email) {
      const r = await db.query(`SELECT email FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
      email = r.rows[0]?.email || null;
    }
    if (!email) return fallbackPortalLink("no_email_on_booking");
    const out = await requestMagicLinkImpl(db, {
      email, orgId,
      ttlMinutes: BOOKING_CONFIRM_LINK_TTL_MINUTES,
      queueEmail: false
    });
    if (!out?.ok) return fallbackPortalLink("request_refused");
    if (out.limited) return fallbackPortalLink("rate_limited");
    if (!out.token) return fallbackPortalLink(out.outcome || "no_token");
    return {
      issued: true,
      url: magicLinkUrl(out.token),
      expires_minutes: String(BOOKING_CONFIRM_LINK_TTL_MINUTES)
    };
  });

  // Owner decision 2026-08-22: booked stage is one text + Josh dial + one email,
  // all immediate. Text first, email second; the AI setter dials on its own leg.
  // THE CONTEXT IS NEVER CONDITIONAL. It used to be spread in only when a token
  // was minted, and an absent {{magic_link.url}} renders as the empty string —
  // so the confirm email said "Here is your link to sign in to your Fundhub
  // portal:" and then showed an empty link. Walk finding F2, 2026-09-03. When no
  // token can be minted, portal.url is the tokenless sign-in page instead, which
  // is a door the client can actually open.
  const confirmEmail = await step.run("send-confirm-email", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_CONFIRM,
      eventId: `${eventId}:confirm-email`,
      context: {
        ...context,
        magic_link: { url: portal.url, expires_minutes: portal.expires_minutes }
      }
    }));

  if (!startTime) {
    return { done: true, confirm, confirmEmail, skippedReminders: "no_start_time" };
  }

  const t24 = new Date(new Date(startTime).getTime() - 24 * HOUR);
  await step.sleepUntil("wait-t-minus-24h", t24);
  if (await step.run("recheck-24h", () => callHappened(db, clientId))) {
    return { done: true, confirm, confirmEmail, stoppedAt: "before-24h", stoppedBecause: "call_held" };
  }
  const remind24 = await step.run("send-remind-24h", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_REMIND_24H,
      eventId: `${eventId}:24h`, context
    }));

  const t2 = new Date(new Date(startTime).getTime() - 2 * HOUR);
  await step.sleepUntil("wait-t-minus-2h", t2);
  if (await step.run("recheck-2h", () => callHappened(db, clientId))) {
    return { done: true, confirm, confirmEmail, remind24, stoppedAt: "before-2h", stoppedBecause: "call_held" };
  }
  const remind2 = await step.run("send-remind-2h", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_REMIND_2H,
      eventId: `${eventId}:2h`, context
    }));

  return { done: true, confirm, confirmEmail, remind24, remind2 };
}

export const s04bBookingReminders = inngest.createFunction(
  {
    id: "s-04b-booking-reminders",
    name: "S-04B — Booking Confirm + Reminders",
    cancelOn: [
      {
        event: "booking.rescheduled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      },
      {
        event: "booking.rescheduled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  [{ event: "booking.created" }, { event: "booking.rescheduled" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
