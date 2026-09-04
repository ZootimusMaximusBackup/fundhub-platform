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
import { drainMessageNow } from "../messaging/outbox.mjs";
import {
  requestMagicLink, magicLinkUrl, portalLoginUrl, BOOKING_CONFIRM_LINK_TTL_MINUTES
} from "../auth/magic-link.mjs";

export const SMS_CONFIRM = "SMS-S04-01-CONFIRM";
export const EMAIL_CONFIRM = "EMAIL-S04-01-CONFIRM";
export const SMS_REMIND_24H = "SMS-S04-02-REMIND-24H";
export const SMS_REMIND_2H = "SMS-S04-03-REMIND-2H";

const HOUR = 60 * 60 * 1000;

/* How far from the intended moment a reminder may still be sent.
   A durable wake is never exact to the millisecond, and five minutes is far
   inside the resolution of "your call is tomorrow" while being far outside the
   nought-to-five minutes that F47 actually produced. */
export const REMINDER_SKEW_MS = 5 * 60 * 1000;

/* reminderPlan — WHEN each reminder is allowed to go out, decided once at
 * booking time.
 *
 * F47, measured 2026-09-03: four customers got "your call is tomorrow at ..."
 * within minutes of booking, one of them for a call three days away. The
 * subtraction in this file was never wrong; what was missing was any check that
 * the moment it produced is still in the future. `new Date("not a date")` is an
 * Invalid Date, `sleepUntil` on one wakes at once, and a customer who booked
 * twenty hours out has a "24 hours before" moment that is already four hours in
 * the past — both cases fired instantly and both said "tomorrow".
 *
 * So a reminder whose moment has already gone is not sent late. It is not sent.
 * A reminder is a promise about the clock; a late one is a lie about it, and
 * this lane exists to send fewer, truer messages rather than more.
 */
export function reminderPlan(startTime, nowMs) {
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return { ok: false, reason: "unreadable_start_time" };
  if (startMs <= nowMs) return { ok: false, reason: "appointment_already_started" };
  const at = (offsetMs) => {
    const target = startMs - offsetMs;
    return target > nowMs + REMINDER_SKEW_MS ? new Date(target) : null;
  };
  return { ok: true, startMs, t24: at(24 * HOUR), t2: at(2 * HOUR) };
}

/* The same question asked again on waking, because a durable sleep can be
   resumed early after a retry or a replay and the sender must not take the
   scheduler's word for the time. */
function wakeRefusal(startMs, targetMs, nowMs) {
  if (nowMs >= startMs) return "appointment_already_started";
  if (nowMs < targetMs - REMINDER_SKEW_MS) return "woke_before_the_reminder_was_due";
  return null;
}

/* F1 — the booking confirmation lands in about three minutes and the owner
 * wants it inside sixty seconds. The dispatcher's sweep runs every five
 * minutes, so most of that wait is a message sitting in the queue waiting for a
 * clock tick.
 *
 * THE SWEEP CADENCE IS NOT TOUCHED. It is one setting for every kind of message
 * the company sends, and moving it would speed up things nobody asked to speed
 * up. Instead the two rows this workflow has just written — the booking text and
 * the booking email, and nothing else — ask to be worked now, by id, through the
 * dispatcher that already handles them. The sweep stays exactly as it is and
 * remains the backstop for these two rows and everything else.
 *
 * "Now" means it does not wait for a clock. It does not mean any check is
 * skipped: the company pause switch, the daily cap, quiet hours, opt-out and
 * the compliance screen are all the dispatcher's and all still run. Nothing here
 * can bypass one. See src/messaging/outbox.mjs.
 */
async function dispatchConfirmationNow(db, drainNow, { orgId, messageIds }) {
  const out = [];
  for (const id of messageIds) {
    // Never throws — a message that could not go out immediately is still
    // queued, and the sweep is still coming.
    out.push({ messageId: id, ...(await drainNow(db, id, { orgId })) });
  }
  return out;
}

/* Exported because AI-SET-04 sends about the same appointment and used to send
   about none — it called sendTemplated with no context at all, so the handoff
   text's {{appointment.meeting_location}} rendered as nothing and the customer
   got "link: ." (F49). One shape for one appointment, in one place. */
export function appointmentContext(payload = {}) {
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

export async function handle({
  event, db, step,
  requestMagicLinkImpl = requestMagicLink,
  drainNowImpl = drainMessageNow,
  now = () => Date.now()
}) {
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

  // F1 — hand these two rows to the dispatcher now instead of waiting for the
  // next five-minute sweep. Everything else in the system still waits for it.
  const confirmDispatch = await step.run("dispatch-confirmation-now", () =>
    dispatchConfirmationNow(db, drainNowImpl, {
      orgId,
      messageIds: [confirm?.messageId, confirmEmail?.messageId].filter(Boolean)
    }));

  const base = { done: true, confirm, confirmEmail, confirmDispatch };

  if (!startTime) {
    return { ...base, skippedReminders: "no_start_time" };
  }

  const plan = reminderPlan(startTime, now());
  if (!plan.ok) {
    // An unreadable or already-past start time. The confirmation still goes —
    // it is a receipt for what they booked — but nothing that talks about
    // "tomorrow" or "in two hours" is sent about a moment we cannot place.
    return { ...base, skippedReminders: plan.reason };
  }

  const out = { ...base };

  if (!plan.t24) {
    // Booked less than 24 hours before the call. There is no "24 hours before"
    // left to reach, so this reminder does not exist for this booking.
    out.skipped24h = "booked_inside_24h";
  } else {
    await step.sleepUntil("wait-t-minus-24h", plan.t24);
    const refused24 = wakeRefusal(plan.startMs, plan.t24.getTime(), now());
    if (refused24) {
      out.skipped24h = refused24;
    } else if (await step.run("recheck-24h", () => callHappened(db, clientId))) {
      return { ...out, stoppedAt: "before-24h", stoppedBecause: "call_held" };
    } else {
      out.remind24 = await step.run("send-remind-24h", () =>
        sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: SMS_REMIND_24H,
          eventId: `${eventId}:24h`, context
        }));
    }
  }

  if (!plan.t2) {
    out.skipped2h = "booked_inside_2h";
  } else {
    await step.sleepUntil("wait-t-minus-2h", plan.t2);
    const refused2 = wakeRefusal(plan.startMs, plan.t2.getTime(), now());
    if (refused2) {
      out.skipped2h = refused2;
    } else if (await step.run("recheck-2h", () => callHappened(db, clientId))) {
      return { ...out, stoppedAt: "before-2h", stoppedBecause: "call_held" };
    } else {
      out.remind2 = await step.run("send-remind-2h", () =>
        sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: SMS_REMIND_2H,
          eventId: `${eventId}:2h`, context
        }));
    }
  }

  return out;
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
