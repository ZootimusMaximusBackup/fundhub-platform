// AI-SET-04 — 3-Way Text Handoff.
// Source: GHL-System-Map.md AI SETTER section.
// Audit fix applied (Spec §6 + workflow-coherence-audit.md: "draft, never fires, no
// trigger, no advisor follow-up. Publish, wire into DPC-03, add advisor message") —
// this file IS that publish + wiring: real trigger (T-15 off the booked start), real
// compliance-scrubbed copy (Workflow-SMS-Fixes-Ready-to-Paste.md), plus the advisor
// follow-up task the original lacked.
//
// Trigger: booking.created. Fires 15 minutes before the appointment's start time via
// a durable sleepUntil — not a poll, a single scheduled wake.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { createTask } from "../lib/create-task.mjs";
import { appointmentContext, REMINDER_SKEW_MS } from "./s-04b-booking-reminders.mjs";
import { portalLoginUrl } from "../auth/magic-link.mjs";

export const SMS_TEMPLATE_KEY = "SMS-AISET04-HANDOFF";
const SOURCE_WORKFLOW = "ai-set-04-3way-handoff";

/* F49 — the handoff text arrived reading "...so you're not walking in cold —
 * link: ." The template asks for {{appointment.meeting_location}} and this
 * workflow passed no context at all, so the tag rendered as nothing and the
 * customer was handed a full stop.
 *
 * Context alone is not enough, because the ClickFunnels adapter sets
 * meetingUrl: null on every booking it takes, so the honest answer is often
 * "the webhook did not carry one". Three places are asked, in order of how
 * specific they are, and the last one always answers:
 *   1. the booking event's own payload,
 *   2. the saved booking row for this appointment, or this client's most recent
 *      one, which a later webhook may have filled in,
 *   3. the customer's portal sign-in page — a door they can actually open.
 * There is no fourth branch that returns nothing. A link in this text is either
 * real or the text does not go.
 */
async function meetingLinkFor(db, { orgId, clientId, payload = {} }) {
  const fromPayload =
    payload.meetingUrl || payload.meeting_url || payload.meeting_location || null;
  if (fromPayload) return { url: String(fromPayload), from: "payload" };

  try {
    if (payload.bookingUid) {
      const byUid = await db.query(
        `SELECT meeting_url FROM bookings
          WHERE org_id = $1 AND provider_uid = $2 AND meeting_url IS NOT NULL
          LIMIT 1`,
        [orgId, String(payload.bookingUid)]
      );
      if (byUid.rows[0]?.meeting_url) return { url: String(byUid.rows[0].meeting_url), from: "booking_uid" };
    }
    const byClient = await db.query(
      `SELECT meeting_url FROM bookings
        WHERE org_id = $1 AND client_id = $2 AND meeting_url IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId, clientId]
    );
    if (byClient.rows[0]?.meeting_url) return { url: String(byClient.rows[0].meeting_url), from: "booking_row" };
  } catch (err) {
    console.warn(`[ai-set-04] could not read a meeting link: ${String(err?.message || err)}`);
  }

  return { url: portalLoginUrl(), from: "portal_sign_in" };
}

async function createAdvisorTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "3-way handoff — advisor follow-up on UnderwriteIQ results",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "closer",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step, now = () => Date.now() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const payload = event.payload || {};
  const startTime = payload.startTime;
  if (!startTime) return { done: false, reason: "no_start_time" };

  /* WHEN THIS TEXT IS ALLOWED TO GO, decided once and written down.
   *
   * Three ways this message used to be a lie about the clock, all the same
   * class as F47:
   *   * a start time nothing can read makes an Invalid Date, and sleepUntil on
   *     one wakes at once;
   *   * a booking whose start time is already in the past has a "fifteen
   *     minutes before" moment that is further in the past still, so the sleep
   *     also ends at once and the customer is told a finished call starts in
   *     fifteen minutes;
   *   * a booking taken inside the last fifteen minutes has no "fifteen minutes
   *     before" left to reach at all.
   * None of those is sent late. None of them is sent.
   *
   * The answer is worked out INSIDE a step, because Inngest re-runs everything
   * outside a step on every replay against the clock as it is then — which is
   * how the same shape switched both booking reminders off in
   * src/workflows/s-04b-booking-reminders.mjs. Recorded once, it does not move.
   * (A step's answer travels as JSON, so the moment is stored as text.)
   */
  const plan = await step.run("plan-handoff", () => {
    const startMs = new Date(startTime).getTime();
    if (!Number.isFinite(startMs)) return { ok: false, reason: "unreadable_start_time" };
    const nowMs = now();
    if (startMs <= nowMs) return { ok: false, reason: "appointment_already_started" };
    const targetMs = startMs - 15 * 60 * 1000;
    if (targetMs <= nowMs + REMINDER_SKEW_MS) return { ok: false, reason: "booked_inside_15m" };
    return { ok: true, at: new Date(targetMs).toISOString() };
  });
  if (!plan.ok) return { done: false, reason: plan.reason };
  await step.sleepUntil("wait-until-t-minus-15", new Date(plan.at));

  const orgId = event.orgId;
  const eventId = event.id;
  const link = await step.run("resolve-meeting-link", () =>
    meetingLinkFor(db, { orgId, clientId, payload }));
  const context = appointmentContext({ ...payload, meetingUrl: link.url });
  const sms = await step.run("send-handoff-sms", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId, context
    }));
  const task = await step.run("create-advisor-task", () => createAdvisorTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, sms, task, link };
}

export const aiSet043WayHandoff = inngest.createFunction(
  {
    id: "ai-set-04-3way-handoff",
    name: "AI-SET-04 — 3-Way Text Handoff",
    cancelOn: [
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
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
