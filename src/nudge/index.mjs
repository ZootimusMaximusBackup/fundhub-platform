// src/nudge — the overdue-waypoint chase ladder.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file.
//
// Nothing in this directory sends. run.mjs queues a `messages` row and stops;
// src/messaging/dispatch.mjs hands queued rows to a provider on its own clock,
// and outbound transmission itself lives only in src/messaging/providers/ —
// CLAUDE.md §12. There is no fetch anywhere under src/nudge/.
//
//   ladder.mjs     four rungs and nothing after them
//   exits.mjs      every reason not to chase. An empty list is the only yes.
//   clock.mjs      the client's own daytime and their own calendar day
//   run.mjs        plan → re-decide → claim → queue
//   regulator.mjs  rounds 4 and 5: prepared / sent / filed, and only the client
//                  moves it to filed

export { STEPS, FINAL_STEP, TEMPLATE_KEYS, stepFor, dueStep } from "./ladder.mjs";
export { blockersFor, contactFor, looksLikeEscalation, CHASEABLE_STATES, BOUGHT_STATUSES } from "./exits.mjs";
export { zoneForClient, isDaytime, localDate, FALLBACK_TZ } from "./clock.mjs";
export { planNudges, deliverNudge, runNudges, idempotencyKeyFor, SOURCE_WORKFLOW, STAFF_TASK_ROLE } from "./run.mjs";
export {
  COMPLAINT_KINDS, FILED_SOURCE,
  prepareComplaint, markComplaintSent, recordClientAnswer, complaintsFor
} from "./regulator.mjs";
