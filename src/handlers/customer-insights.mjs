// Three collections: start (existing apply survey), mid check-in, ending interview.
// Google Meet is only for the sales call and the ending interview.
// Mid is a phone / AI reach-out, due at the halfway point of the service.

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
/* HALFWAY THROUGH THE SERVICE, which is what Chris asked for (2026-09-05) and
   is not what this was.

   It was 7. A week after somebody pays, nothing has happened yet — the pull may
   not be back, the first round may not have gone out — so "how is it going"
   had no answer and the call was really a welcome call wearing the wrong name.

   WHY A NUMBER AND NOT A COMPUTED MIDPOINT. The obvious version is
   `contracts.signed_at + term_days/2`. It cannot be built: `term_days` is a
   merge value for rendering one template's sentence, nothing in src/ or api/
   ever writes it to a contract, and 287 deliberately MOVED how long the work
   runs out of this catalogue and into the agreement text Chris supplies
   ("Neither was ever a number this catalogue owns" — src/config/offers.mjs).
   Measured 2026-09-05 on a database with every migration applied: zero
   contracts carry a term. A midpoint computed from absent data is a guess with
   a formula wrapped around it.

   So: 90 days, the midpoint of the 180-day term that is the only program
   length actually stated anywhere in this repo
   (REPAIR-AND-FUNDING-AGREEMENT). One number, one place, change it here. */
export const MID_DUE_DAYS = 90;

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
    /* Owner-set 2026-09-05: this is one call, not three. The interview is real
       and it comes first — the answers are the point, and a client who has
       just been pressed for money gives you nothing worth keeping. Money and
       the next offer come after the questions, in that order. The open balance
       and what they already own are on the CSM queue, so this task does not
       repeat numbers that would be stale by the time anyone reads it. */
    "THEN, after the questions and in this order:",
    "  1. If they owe anything, ask for it. The balance and a pay link are on your queue.",
    "  2. If they are in a good place, offer what they do not already have.",
    "Do not lead with either. The answers are the reason this call exists.",
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
