// Three collections: start (existing apply survey), mid check-in, ending interview.
// Google Meet is only for the sales call and the ending interview.
// Mid is a phone / AI reach-out, due one week after they pay.

import { on } from "../events/registry.mjs";
import { createTask } from "../lib/create-task.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { formatQuestionList } from "../insights/questions.mjs";
import { isInterviewBooking, meetBookingUrl, RECORDING_NOTE } from "../insights/meet.mjs";

/* The CSM owns every conversation after the sale (db/migrations/290_csm_role.sql,
   owner-set 2026-09-05). This was the funding advisor, which is why the check-in
   and the interview kept losing to funding work: the advisor's job is to get the
   file funded, and a "how is it going" call is always the thing that slips.
   Moving the constant moves both tasks — the mid check-in and the post
   interview — because both read it. */
export const ASSIGNEE_ROLE = "csm";
export const MID_DUE_DAYS = 7;

export const SOURCE_WORKFLOW = "customer-insights-post";
export const TASK_TITLE = "Post-funding Google Meet interview";

export const MID_SOURCE_WORKFLOW = "customer-insights-mid";
export const MID_TASK_TITLE = "Mid-journey check-in";

export function interviewTaskBody(eventId, env = process.env) {
  const questions = formatQuestionList("post");
  const bookUrl = meetBookingUrl(env);
  const lines = [
    bookUrl
      ? `Send the client this booking link (Google Meet is created when they book): ${bookUrl}`
      : "Book a Google Meet (set INSIGHT_MEET_BOOKING_URL on Netlify).",
    "Click Record in Google Meet. Ask these questions. Save answers with POST /api/customer-insights (stage=post, channel=google_meet).",
    RECORDING_NOTE,
    "",
    questions,
    "",
    `[event:${eventId}]`
  ];
  return lines.join("\n");
}

export function checkinTaskBody(eventId) {
  const questions = formatQuestionList("mid");
  return [
    "Call them (phone or AI reach-out). This is not a Google Meet.",
    "Ask these questions. Save answers with POST /api/customer-insights (stage=mid, channel=call).",
    "",
    questions,
    "",
    `[event:${eventId}]`
  ].join("\n");
}

function dueInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function onRoundFundedInsights(event, db, env = process.env) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return { created: false, reason: "no_client" };

  const eventId = event.id || null;
  const bookUrl = meetBookingUrl(env);
  return createTask(db, {
    orgId: event.orgId,
    clientId,
    title: TASK_TITLE,
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: ASSIGNEE_ROLE,
    eventId,
    body: interviewTaskBody(eventId, env),
    meetingUrl: bookUrl
  });
}

export async function onPaidMidCheckin(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return { created: false, reason: "no_client" };

  const eventId = event.id || null;
  return createTask(db, {
    orgId: event.orgId,
    clientId,
    title: MID_TASK_TITLE,
    sourceWorkflow: MID_SOURCE_WORKFLOW,
    assigneeRole: ASSIGNEE_ROLE,
    eventId,
    body: checkinTaskBody(eventId),
    dueAt: dueInDays(MID_DUE_DAYS),
    dedupeOn: "title"
  });
}

export async function onInterviewBooked(event, db) {
  const p = event.payload || {};
  if (!p.meetingUrl) return { updated: false, reason: "no_meeting_url" };
  if (!isInterviewBooking(p)) return { updated: false, reason: "not_interview" };

  const clientId = await resolveClient(db, event);
  if (!clientId) return { updated: false, reason: "no_client" };

  const upd = await db.query(
    `UPDATE tasks
        SET meeting_url = $3,
            due_at = COALESCE($4, due_at),
            updated_at = now()
      WHERE client_id = $1 AND source_workflow = $2
      RETURNING id`,
    [clientId, SOURCE_WORKFLOW, p.meetingUrl, p.startTime || null]
  );
  return { updated: Boolean(upd.rows[0]), id: upd.rows[0]?.id || null };
}

export function register() {
  on("round.funded", onRoundFundedInsights);
  on("deposit.paid", onPaidMidCheckin);
  on("sale.closed", onPaidMidCheckin);
  on("booking.created", onInterviewBooked);
}

export default register;
