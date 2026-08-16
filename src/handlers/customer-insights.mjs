// Three collections: start (existing apply survey), mid check-in, ending interview.
// Google Meet is only for the sales call (already in the closer desk) and the
// ending interview. Mid is a phone / AI reach-out, due one week after they pay.
//
// In-process event bus (not Inngest) so beta works without INNGEST_EVENT_KEY.

import { on } from "../events/registry.mjs";
import { createTask } from "../lib/create-task.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { formatQuestionList } from "../insights/questions.mjs";

export const ASSIGNEE_ROLE = "funding_advisor";
export const MID_DUE_DAYS = 7;

export const SOURCE_WORKFLOW = "customer-insights-post";
export const TASK_TITLE = "Post-funding Google Meet interview";

export const MID_SOURCE_WORKFLOW = "customer-insights-mid";
export const MID_TASK_TITLE = "Mid-journey check-in";

export function interviewTaskBody(eventId) {
  const questions = formatQuestionList("post");
  return [
    "Book a Google Meet. Ask these questions. Save answers with POST /api/customer-insights (stage=post, channel=google_meet).",
    "",
    questions,
    "",
    `[event:${eventId}]`
  ].join("\n");
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

export async function onRoundFundedInsights(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return { created: false, reason: "no_client" };

  const eventId = event.id || null;
  return createTask(db, {
    orgId: event.orgId,
    clientId,
    title: TASK_TITLE,
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: ASSIGNEE_ROLE,
    eventId,
    body: interviewTaskBody(eventId)
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

export function register() {
  on("round.funded", onRoundFundedInsights);
  on("deposit.paid", onPaidMidCheckin);
  on("sale.closed", onPaidMidCheckin);
}

export default register;
