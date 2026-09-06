// The nudge runner — plan, then re-decide, then claim, then queue.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file.
//
// THIS FILE DOES NOT SEND. It writes a `messages` row with status='queued' via
// sendTemplated (src/workflows/messaging.mjs) and stops there. The dispatcher
// (src/messaging/dispatch.mjs, swept every five minutes) is the only thing that
// hands a row to a provider, and outbound transmission itself is permitted only
// inside src/messaging/providers/ — CLAUDE.md §12. There is no fetch in this
// module, no provider import, and no path around either.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// FOUR PHASES, AND WHY THE ORDER IS THE WHOLE DESIGN
//
//   1. PLAN     find overdue, client-owned waypoints whose next rung is due.
//   2. RE-DECIDE run every exit condition again, against the live row.
//   3. CLAIM    write the waypoint_nudges row FIRST, before anything is queued.
//   4. QUEUE    only now call sendTemplated, and record what came back.
//
// Phase 2 exists because of the exact wording of exit condition 1: check
// completion AT SEND TIME, not only at schedule time. A waypoint the client
// finishes in the seconds between the plan and the send must produce nothing.
// Splitting plan from deliver is what makes that provable rather than asserted
// — the test drives planNudges(), completes the waypoint, then drives
// deliverNudge() on the stale plan and watches zero rows appear.
//
// Phase 3 is before phase 4 for the reason the 2026-09-03 incident exists. That
// loop decided, then sent, then recorded — so sixteen duplicate webhooks each
// decided before any of them had recorded, and sixteen texts went out. Here the
// record IS the decision: whoever wins the insert owns the step and everyone
// else gets zero rows back from ON CONFLICT DO NOTHING and stops. There is no
// window between deciding and recording, because they are one statement.
//
// The cost of that ordering is honest and worth stating: if this process dies
// between the claim and the queue, the row sits at outcome='claimed' and that
// rung is spent without a message going out. It is NOT retried. A missed nudge
// is a stalled checklist item the client can see on their own page and a staff
// task at step 4; a retried nudge is the 51 texts. The trade only goes one way.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE TWO CAPS, AND WHO ENFORCES THEM
//
// Neither is enforced here. Both are enforced by 365's unique constraints, and
// this file only reads the result:
//
//   FOUR MESSAGES PER WAYPOINT, EVER — UNIQUE (waypoint_id, step) with
//   CHECK (step BETWEEN 1 AND 4). A fifth row is unwritable.
//
//   ONE CLIENT-FACING MESSAGE PER CLIENT PER DAY, ACROSS EVERY WAYPOINT —
//   the partial UNIQUE (client_id, client_local_date). Three overdue items
//   produce one text because the second and third inserts conflict, not
//   because a counter in JavaScript said so. A SELECT-then-INSERT here would
//   be the same check-then-write race `transactions` already has.

import { db as defaultDb } from "../db.mjs";
import { emit } from "../events/bus.mjs";
import { createTask } from "../lib/create-task.mjs";
import { sendTemplated as defaultSend } from "../workflows/messaging.mjs";
import { STEPS, dueStep, stepFor } from "./ladder.mjs";
import { blockersFor, contactFor } from "./exits.mjs";
import { zoneForClient, isDaytime, localDate } from "./clock.mjs";

export const SOURCE_WORKFLOW = "waypoint-nudge";

/** Who picks up the step-4 task. The customer success manager owns the client
    after the sale — the mid check-in, the results interview and the human end
    of the AR ladder (290_csm_role.sql) — so a client who has stalled on their
    own checklist is exactly their work. */
export const STAFF_TASK_ROLE = "csm";

/** How many candidates one pass will consider. Bounded for the same reason
    message-dispatch-sweeper.mjs bounds its batch: an unbounded pass holds a
    function open for as long as the backlog is long, and nothing is lost by
    stopping early — an unchased waypoint is still overdue on the next pass. */
export const DEFAULT_LIMIT = 200;

/** idempotencyKeyFor — the stable name for one rung of one waypoint's ladder.

    Stable across replays, retries, duplicate webhooks and two schedulers,
    because it is built only from facts that do not move: the waypoint's id and
    the step number. No timestamp, no run id, no attempt counter — any of those
    would make a retry look like a new send, which is precisely how sixteen
    duplicate triggers became sixteen texts. */
export function idempotencyKeyFor(waypointId, step) {
  return `waypoint-nudge:${waypointId}:${step}`;
}

/**
 * planNudges — phase 1. Every overdue, client-owned waypoint whose highest
 * reached rung has not been spent yet.
 *
 * This is a SUGGESTION and nothing more. Every candidate it returns is put
 * through the full exit gate again by deliverNudge before anything happens, so
 * a stale plan is safe by construction.
 */
export async function planNudges(db, { orgId = null, now = new Date(), limit = DEFAULT_LIMIT } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const params = [at.toISOString()];
  let orgClause = "";
  if (orgId) {
    params.push(orgId);
    orgClause = ` AND w.org_id = $${params.length}`;
  }
  params.push(limit);

  /* owner_kind = 'client' is in the SQL, not in JavaScript, so a waypoint
     FundHub owes is never even a candidate. Chasing a client about our own work
     is the fastest way to lose them; ours slipping is a staff alert and belongs
     to a different piece of work entirely. */
  const { rows } = await db.query(
    `SELECT w.id, w.org_id, w.client_id, w.key, w.title, w.detail, w.due_at, w.state
       FROM client_waypoints w
      WHERE w.owner_kind = 'client'
        AND w.state IN ('not_started', 'in_progress')
        AND w.due_at IS NOT NULL
        AND w.due_at <= $1::timestamptz${orgClause}
      ORDER BY w.due_at ASC
      LIMIT $${params.length}`,
    params
  );

  const candidates = [];
  for (const w of rows) {
    const rung = dueStep(w.due_at, at);
    if (!rung) continue;
    candidates.push({
      waypointId: w.id,
      orgId: w.org_id,
      clientId: w.client_id,
      key: w.key,
      title: w.title,
      detail: w.detail,
      dueAt: w.due_at,
      step: rung.step,
      kind: rung.kind,
      channel: rung.channel,
      templateKey: rung.templateKey
    });
  }
  return candidates;
}

/* claim — the one statement that is both the decision and the record.

   Returns the new row's id, or null when somebody else already owns this rung
   or the client's one message for the day is already spoken for. ON CONFLICT
   DO NOTHING absorbs BOTH unique constraints, which is why the caller has to
   ask afterwards which one it hit. */
async function claim(db, { orgId, clientId, waypointId, step, kind, channel, templateKey,
                           idempotencyKey, localDay, zone, outcome, detail }) {
  const { rows } = await db.query(
    `INSERT INTO waypoint_nudges
       (org_id, client_id, waypoint_id, step, kind, channel, template_key,
        outcome, detail, idempotency_key, client_local_date, client_time_zone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, clientId, waypointId, step, kind, channel, templateKey,
     outcome, detail, idempotencyKey, localDay, zone]
  );
  return rows[0]?.id || null;
}

/* whyClaimFailed — which of the two caps stopped us. Reporting only; the stop
   has already happened either way. */
async function whyClaimFailed(db, { waypointId, step, clientId, localDay }) {
  const taken = (await db.query(
    `SELECT 1 FROM waypoint_nudges WHERE waypoint_id = $1 AND step = $2 LIMIT 1`,
    [waypointId, step]
  )).rows.length > 0;
  if (taken) return "already_sent";
  if (localDay) {
    const capped = (await db.query(
      `SELECT 1 FROM waypoint_nudges WHERE client_id = $1 AND client_local_date = $2::date LIMIT 1`,
      [clientId, localDay]
    )).rows.length > 0;
    if (capped) return "daily_cap";
  }
  return "claim_lost";
}

/**
 * deliverNudge — phases 2 to 4 for one candidate.
 *
 * Every return says `action` and, when nothing happened, `reasons`. "skipped"
 * is the normal, healthy outcome and by far the most common one.
 */
export async function deliverNudge(db, candidate, { now = new Date(), send = defaultSend } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const { waypointId } = candidate;
  const step = stepFor(candidate.step);
  if (!step) {
    /* Unreachable through planNudges, which only ever returns a rung from
       STEPS. Kept because the alternative to a guard here is a crash inside a
       sweep, and there is no fifth rung to fall through to. */
    return { waypointId, step: candidate.step, action: "skipped", reasons: ["unknown_step"] };
  }

  /* PHASE 2 — RE-DECIDE. Every exit condition, against the row as it is now.
     A waypoint completed since the plan was made dies here. */
  const blockers = await blockersFor(db, { waypointId, now: at });
  if (blockers.length) {
    return { waypointId, step: step.step, action: "skipped", reasons: blockers };
  }

  const client = (await db.query(
    `SELECT id, org_id, email, phone, dnd_sms, dnd_email, custom_fields
       FROM clients WHERE id = $1 LIMIT 1`,
    [candidate.clientId]
  )).rows[0];
  if (!client) {
    return { waypointId, step: step.step, action: "skipped", reasons: ["client_missing"] };
  }

  const idempotencyKey = idempotencyKeyFor(waypointId, step.step);

  /* ── STEP 4: A HUMAN, AND NO CLIENT MESSAGE ─────────────────────────────
     Not a louder text. The ladder ends with a person, and the row written here
     is what makes `ladder_exhausted` true forever afterwards. */
  if (step.kind === "staff_task") {
    const claimId = await claim(db, {
      orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
      step: step.step, kind: "staff_task", channel: null, templateKey: null,
      idempotencyKey, localDay: null, zone: null, outcome: "claimed", detail: null
    });
    if (!claimId) {
      const why = await whyClaimFailed(db, { waypointId, step: step.step, clientId: candidate.clientId, localDay: null });
      return { waypointId, step: step.step, action: "skipped", reasons: [why] };
    }

    const task = await createTask(db, {
      orgId: candidate.orgId,
      clientId: candidate.clientId,
      title: `Client stalled: ${candidate.title}`,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: STAFF_TASK_ROLE,
      /* The dedupe key is the same idempotency key, so a replay finds the task
         it already made instead of making a second one. */
      body: idempotencyKey,
      eventId: idempotencyKey
    });

    await db.query(
      `UPDATE waypoint_nudges SET outcome = 'staff_task', task_id = $2, detail = $3 WHERE id = $1`,
      [claimId, task.id, task.created ? null : `task ${task.reason}`]
    );
    await recordEvent(db, { candidate, step, idempotencyKey, outcome: "staff_task" });
    return { waypointId, step: step.step, action: "staff_task", taskId: task.id };
  }

  /* ── QUIET HOURS, IN THE CLIENT'S OWN ZONE ──────────────────────────────
     Nothing is claimed and nothing is written. The rung stays unspent and the
     next pass inside their daytime picks it up. A message held is a message
     that still goes out; a message queued at 3am is one somebody wakes up to. */
  const { zone, known } = zoneForClient(client);
  if (!isDaytime(at, zone)) {
    return {
      waypointId, step: step.step, action: "skipped",
      reasons: ["quiet_hours"], zone, zoneKnown: known
    };
  }

  /* ── EXIT 8, AS A SKIP RATHER THAN A STOP ───────────────────────────────
     No usable address for this channel. The rung is SPENT — a row is written
     with no local date, so it costs the client nothing from their one-per-day
     allowance and the ladder advances to the next rung on schedule instead of
     retrying an impossible SMS on every pass, forever. */
  const address = contactFor(client, step.channel);
  if (!address) {
    const claimId = await claim(db, {
      orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
      step: step.step, kind: "client_message", channel: step.channel,
      templateKey: step.templateKey, idempotencyKey,
      localDay: null, zone, outcome: "no_contact",
      detail: `no usable ${step.channel} address`
    });
    if (!claimId) {
      const why = await whyClaimFailed(db, { waypointId, step: step.step, clientId: candidate.clientId, localDay: null });
      return { waypointId, step: step.step, action: "skipped", reasons: [why] };
    }
    await recordEvent(db, { candidate, step, idempotencyKey, outcome: "no_contact" });
    return { waypointId, step: step.step, action: "no_contact", channel: step.channel };
  }

  /* ── PHASE 3: CLAIM, WITH THE CLIENT'S OWN CALENDAR DAY ─────────────────
     This is where the global one-per-client-per-day cap actually bites. */
  const localDay = localDate(at, zone);
  const claimId = await claim(db, {
    orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
    step: step.step, kind: "client_message", channel: step.channel,
    templateKey: step.templateKey, idempotencyKey,
    localDay, zone, outcome: "queued", detail: null
  });
  if (!claimId) {
    const why = await whyClaimFailed(db, { waypointId, step: step.step, clientId: candidate.clientId, localDay });
    return { waypointId, step: step.step, action: "skipped", reasons: [why], localDay, zone };
  }

  await recordEvent(db, { candidate, step, idempotencyKey, outcome: "queued" });

  /* ── PHASE 4: QUEUE ─────────────────────────────────────────────────────
     sendTemplated writes one `messages` row with status='queued' and returns.
     `eventId` is the idempotency key, so its own provider_ref unique index
     (messages_org_providerref_uniq, migration 004) is a SECOND guard behind
     365's: even if the claim were somehow bypassed, the message row could not
     double. Two independent constraints, same key. */
  let result;
  try {
    result = await send(db, {
      orgId: candidate.orgId,
      clientId: candidate.clientId,
      channel: step.channel,
      templateKey: step.templateKey,
      eventId: idempotencyKey,
      /* So the message can name the actual thing rather than being a generic
         reminder. The title is the client's own checklist wording. */
      context: { waypoint: { title: candidate.title || "", key: candidate.key || "" } }
    });
  } catch (err) {
    result = { sent: false, reason: `error:${String(err?.message || err).slice(0, 120)}` };
  }

  if (result?.sent) {
    await db.query(
      `UPDATE waypoint_nudges SET outcome = 'queued', message_id = $2 WHERE id = $1`,
      [claimId, result.messageId || null]
    );
    return {
      waypointId, step: step.step, action: "queued",
      channel: step.channel, messageId: result.messageId || null, localDay, zone
    };
  }

  /* NOTHING WAS QUEUED, SO THE DAY IS GIVEN BACK. The rung stays spent — a step
     is spent once — but client_local_date is cleared, because the cap exists to
     stop a client receiving three messages in a day and no message was sent.
     Holding their whole day hostage to a missing template would punish them for
     our gap. */
  const outcome = result?.reason === "template_pending" ? "template_pending" : "refused";
  await db.query(
    `UPDATE waypoint_nudges
        SET outcome = $2, client_local_date = NULL, detail = $3
      WHERE id = $1`,
    [claimId, outcome, String(result?.reason || "not_sent").slice(0, 200)]
  );
  return {
    waypointId, step: step.step, action: outcome,
    channel: step.channel, reasons: [String(result?.reason || "not_sent")]
  };
}

/* recordEvent — the audit half of the idempotency story.

   365's unique constraints are what actually stop a second send. This writes
   the same key to events(org_id, idempotency_key) as well, so an incident can
   be read off the event log — the place every other flow in this repo is read
   from — without joining a table nobody remembers exists.

   allowNonCanonical because the name is not in src/events/canonical.mjs and
   that file is not this lane's to edit; skipInngest because there is no
   function listening and a fan-out to nothing is latency for no one.

   Never throws. The claim is already committed by the time this runs, and a
   bus that is unavailable must not turn a queued message into a failed one —
   the same call sendTemplated makes about message.queued. */
async function recordEvent(db, { candidate, step, idempotencyKey, outcome }) {
  try {
    await emit(
      db,
      "waypoint.nudge.stepped",
      {
        waypoint_id: candidate.waypointId,
        step: step.step,
        kind: step.kind,
        channel: step.channel,
        template_key: step.templateKey,
        outcome
      },
      {
        orgId: candidate.orgId,
        clientId: candidate.clientId,
        idempotencyKey,
        allowNonCanonical: true,
        skipInngest: true
      }
    );
  } catch (err) {
    console.warn(`[nudge/run] event not recorded for ${idempotencyKey}: ${String(err?.message || err)}`);
  }
}

/**
 * runNudges — one whole pass. Plan, then deliver each candidate in turn.
 *
 * Never throws. A pass that fails must not take the scheduled function down
 * with it: the next pass is the recovery, and every waypoint it did not reach
 * is still overdue.
 *
 * Sequential on purpose. Two of these candidates may belong to the same client,
 * and the one-per-day cap has to see the first one's row before it decides the
 * second. Running them in parallel would not break the cap — the database
 * decides, not this loop — but it would make the reported reason a coin toss.
 */
export async function runNudges(db = defaultDb, { orgId = null, now = new Date(), limit = DEFAULT_LIMIT, send = defaultSend } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const tally = {
    at: at.toISOString(),
    considered: 0, queued: 0, staff_tasks: 0, skipped: 0,
    no_contact: 0, template_pending: 0, refused: 0, failed: 0,
    results: []
  };

  let candidates;
  try {
    candidates = await planNudges(db, { orgId, now: at, limit });
  } catch (err) {
    tally.failed += 1;
    tally.error = String(err?.message || err).slice(0, 300);
    return tally;
  }
  tally.considered = candidates.length;

  for (const candidate of candidates) {
    let res;
    try {
      res = await deliverNudge(db, candidate, { now: at, send });
    } catch (err) {
      tally.failed += 1;
      tally.results.push({
        waypointId: candidate.waypointId, step: candidate.step,
        action: "error", reasons: [String(err?.message || err).slice(0, 200)]
      });
      continue;
    }
    if (res.action === "queued") tally.queued += 1;
    else if (res.action === "staff_task") tally.staff_tasks += 1;
    else if (res.action === "no_contact") tally.no_contact += 1;
    else if (res.action === "template_pending") tally.template_pending += 1;
    else if (res.action === "refused") tally.refused += 1;
    else tally.skipped += 1;
    tally.results.push(res);
  }
  return tally;
}

export { STEPS };
export default runNudges;
