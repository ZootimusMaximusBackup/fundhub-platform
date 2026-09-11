// The nudge ladder — four rungs, and then it is over.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging cadence.
// NOTHING IN THIS FILE SENDS ANYTHING. It is a table of four constants and two
// pure functions over them; it imports no database, no provider and no
// messaging module, and it cannot be made to transmit.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE SHAPE IS A CONSTANT AND NOT A LOOP
//
// On 2026-09-03 a chase loop in this product sent 51 identical texts to one
// phone in two hours. The loop had no last rung. So this one is not a loop at
// all: it is four literal entries, and `stepFor` returns null past the end.
// There is no arithmetic anywhere in this file that could produce a fifth step,
// and src/nudge/STEPS.length is 4 for a reader to check in one glance.
//
// The DAYS are owner-decidable and are expected to move. What may never move is
// that there are four of them and that the last one is a human. Both facts are
// pinned by tests, and the database pins the count a second time — 365's
// UNIQUE (waypoint_id, step) with CHECK (step BETWEEN 1 AND 4) makes a fifth
// row unwritable whatever this file says.
//
// TEMPLATE KEYS ARE STABLE AND THE COPY IS NOT. Chris is auditing every message
// in the company in a separate thread; the words behind these keys are
// placeholders seeded in db/seed/025_waypoint_nudge_templates.sql and he swaps
// them in the template editor without anyone touching code.

/** The four rungs, in order. `days` is days OVERDUE, so step 1 fires on due_at. */
export const STEPS = Object.freeze([
  Object.freeze({
    step: 1,
    daysOverdue: 0,
    kind: "client_message",
    channel: "sms",
    templateKey: "SMS-WAYPOINT-DUE"
  }),
  Object.freeze({
    step: 2,
    daysOverdue: 2,
    kind: "client_message",
    channel: "email",
    templateKey: "EMAIL-WAYPOINT-NUDGE-1"
  }),
  Object.freeze({
    step: 3,
    daysOverdue: 5,
    kind: "client_message",
    channel: "sms",
    templateKey: "SMS-WAYPOINT-NUDGE-2"
  }),
  /* THE LAST RUNG IS A PERSON, NOT A LOUDER MESSAGE.
     No channel, no template key, no client message — ever. Escalating tone at
     someone who has already been texted twice and emailed once is how you lose
     them; handing it to a human is how you keep them. */
  Object.freeze({
    step: 4,
    daysOverdue: 9,
    kind: "staff_task",
    channel: null,
    templateKey: null
  })
]);

/** The last rung. Nothing follows it. */
export const FINAL_STEP = 4;

/** Template keys this ladder can ever use. Exported so the seed and the tests
    assert against one list instead of three copies of three strings. */
export const TEMPLATE_KEYS = Object.freeze(
  STEPS.filter((s) => s.templateKey).map((s) => s.templateKey)
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** stepFor(n) → the rung, or null. Null past the end is the termination. */
export function stepFor(step) {
  return STEPS.find((s) => s.step === step) || null;
}

/**
 * dueStep(dueAt, now) → the HIGHEST rung whose overdue threshold has passed,
 * or null when the waypoint is not overdue yet (or has no deadline at all).
 *
 * NULL due_at IS NOT OVERDUE. 330's own header says so: "NULL = no deadline
 * set, and therefore NOT overdue." A missing date is unknown, and unknown is
 * never a reason to text somebody.
 *
 * Returning the HIGHEST reached rung rather than the next unsent one matters
 * for a waypoint that has been overdue for a fortnight before anything ran:
 * it lands on step 4 (a human) instead of walking a client up three messages
 * they should have had days ago.
 */
export function dueStep(dueAt, now = new Date()) {
  if (dueAt == null) return null;
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const at = now instanceof Date ? now : new Date(now);
  const overdueMs = at.getTime() - due.getTime();
  if (overdueMs < 0) return null;

  let reached = null;
  for (const s of STEPS) {
    if (overdueMs >= s.daysOverdue * DAY_MS) reached = s;
  }
  return reached;
}

export default { STEPS, FINAL_STEP, TEMPLATE_KEYS, stepFor, dueStep };
