// The exit conditions. These are not a detail of the nudge ladder — they ARE
// the ladder. A loop that sends nothing is a success; a loop that sends twice
// is a failure.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file. NOTHING IN THIS FILE SENDS ANYTHING: it imports no
// provider, no dispatcher and no template, it only ever reads, and every
// function in it can do exactly one thing — say no.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FAILURE THIS FILE IS WRITTEN AGAINST
//
// 2026-09-03: a chase loop sent 51 identical texts to one phone in two hours,
// to people who had already booked. The "have they done it yet?" check could
// never match, because the events it read carried no client id. Nothing about
// that was a messaging bug. It was a check that could not see the answer.
//
// So every check below reads the CURRENT row, by id, at the moment of the
// decision. None of them reads a cached flag, a payload, or a value the
// scheduler was carrying from an earlier pass.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// FAIL CLOSED. A CHECK THAT ERRORS IS A BLOCK.
//
// Same asymmetry src/mail/suppression.mjs is built on, for the same reason:
//
//   false positive — we do not chase somebody we could have chased. One stalled
//                    checklist row, visible on their own progress page, and a
//                    staff task at step 4 catches it anyway.
//   false negative — we text somebody who said stop, or who already did the
//                    thing, or we text them four times in a morning.
//
// Those are not the same size. `blockersFor` therefore returns
// ["check_failed"] on any thrown error rather than an empty list, and an empty
// list is the only value that permits a message.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS A PERMANENT STOP AND WHAT IS A SKIP — THE DISTINCTION MATTERS
//
// blockersFor() answers "may we chase this waypoint at all, right now". Every
// reason it returns stops the ladder while it is true, and the eight the spec
// lists are all in here.
//
// One condition is deliberately NOT in here: having no phone number for an SMS
// step. That is not a reason to stop the ladder, it is a reason to spend that
// rung and move on — otherwise the same impossible text is attempted every pass
// forever. contactFor() below answers that separately, and the runner records
// the spent step as `no_contact`.

import { isOptedOut } from "../lib/opt-out.mjs";

/* ─────────────────────────────────────────────────────────────────────────
   Which waypoint states may be chased
   ───────────────────────────────────────────────────────────────────────── */

/** The only two states a chase may target. Everything else is a stop.

    'done' and 'skipped' are finished. 'blocked' is deliberately NOT chased
    either: 330 gives it a `state_reason`, and a row that is blocked is
    generally blocked on something other than the client's willingness. Texting
    somebody about a thing they cannot currently do is the fastest way to teach
    them to ignore our texts. */
export const CHASEABLE_STATES = Object.freeze(new Set(["not_started", "in_progress"]));

/** Statuses of paid_service_requests (331) that mean the client HAS BOUGHT the
    paid alternative. Money is recorded at 'paid' and everything after it.

    'quoted' and 'awaiting_payment' are NOT here. A quote nobody accepted must
    not silence the ladder forever — that would turn "we offered to do it for
    you" into "we stopped reminding you". 'awaiting_payment' is handled as a
    temporary hold instead, further down, because a checkout link that is
    genuinely out should not be interrupted by a nudge either. */
export const BOUGHT_STATUSES = Object.freeze(new Set(["paid", "staged", "fulfilled", "refunded"]));

/** A checkout link is out. Hold this pass; do not end the ladder. */
export const PENDING_PAYMENT_STATUSES = Object.freeze(new Set(["awaiting_payment"]));

/* ─────────────────────────────────────────────────────────────────────────
   Escalation keywords — the "complaint or a lawyer" half of exit 6
   ─────────────────────────────────────────────────────────────────────────

   THIS LIST IS NARROW ON PURPOSE, AND THE NARROWNESS IS THE INTERESTING PART.

   Our own product tells clients to file a CFPB complaint and a state attorney
   general complaint. Those exact words therefore arrive in ordinary, healthy
   replies — "I filed the CFPB one", "should I send the attorney general form?"
   A keyword list containing "complaint", "CFPB" or a bare "attorney general"
   would read the client doing what we asked as a legal threat and would stop
   every ladder they have. So:

     * "attorney" matches, "attorney general" does not.
     * "file a complaint" does not match; "complaint against" does.
     * "cfpb" is not in the list at all.
     * "fraud" is not in the list — a credit file is full of legitimate fraud
       language ("fraud alert", "fraudulent account") and it is the word a
       client uses to describe what happened TO them.

   What is left is language aimed at us. Any of it stops every ladder for that
   client, permanently, for as long as the message exists — a human takes it. */
export const ESCALATION_PATTERNS = Object.freeze([
  /\blawyer\b/i,
  /\battorney\b(?!\s+general)/i,
  /\b(sue|suing|sued)\b/i,
  /\blaw\s?suit\b/i,
  /\blitigation\b/i,
  /\blegal action\b/i,
  /\bsmall claims\b/i,
  /\btake (you|fundhub) to court\b/i,
  /\bharass(ing|ment|ed)?\b/i,
  /\bcomplaint against\b/i,
  /\bscam\b/i
]);

/** looksLikeEscalation(text) → true when a client's own words are aimed at us. */
export function looksLikeEscalation(text) {
  if (text == null) return false;
  const s = String(text);
  return ESCALATION_PATTERNS.some((re) => re.test(s));
}

/* ─────────────────────────────────────────────────────────────────────────
   Contact methods — exit 8, and the one that is a skip rather than a stop
   ───────────────────────────────────────────────────────────────────────── */

/**
 * contactFor(client, channel) → the address, or null.
 *
 * WHAT "VERIFIED" MEANS HERE, STATED HONESTLY. There is no contact-verification
 * model in this schema — `clients` has `phone` and `email` and no
 * phone_verified, email_verified or verified_at beside either (checked against
 * db/schema/001_init.sql and every migration). So this cannot test what the
 * spec's word "verified" would ideally mean, and it does not pretend to. It
 * tests three things it can actually prove:
 *
 *   1. an address exists and is not blank
 *   2. it has the shape of an address for that channel — ten digits or more for
 *      a phone, an @ with something either side for an email
 *   3. the client's own do-not-disturb flag for that channel is not set
 *
 * The dnd_* flags are described by 008_opt_out.sql as a CRM mirror of the
 * authoritative opt_outs table, so they are checked IN ADDITION to it and never
 * instead of it — a mirror that says stop is still somebody saying stop.
 *
 * consent_sms is deliberately NOT required. Nothing else in this platform's
 * send path requires it — not sendTemplated, not src/messaging/gate.mjs — it
 * defaults to false on every row, and requiring it here would mean this ladder
 * silently never fires while appearing to be built. That would be the exact
 * "reported as built, does nothing" failure this lane was warned about. It is
 * recorded as a gap rather than papered over.
 */
export function contactFor(client = {}, channel) {
  if (channel === "sms") {
    if (client.dnd_sms === true) return null;
    const digits = String(client.phone || "").replace(/\D+/g, "");
    return digits.length >= 10 ? String(client.phone).trim() : null;
  }
  if (channel === "email") {
    if (client.dnd_email === true) return null;
    const email = String(client.email || "").trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
   The whole gate
   ───────────────────────────────────────────────────────────────────────── */

/**
 * blockersFor(db, { waypointId, now }) → string[]
 *
 * An EMPTY ARRAY is the only value that permits a chase. Every other return —
 * including the one produced by an exception — is a stop.
 *
 * Reasons, and which spec exit each is:
 *
 *   waypoint_missing      exit 2   the row is gone
 *   owner_is_fundhub      exit 2   it is our job, not theirs. We never chase a
 *                                  client about our own work.
 *   waypoint_complete     exit 1   done or skipped. READ FRESH, EVERY TIME.
 *   waypoint_blocked               blocked on something; see CHASEABLE_STATES
 *   not_overdue           —        no due date, or the date has not passed
 *   ladder_exhausted      exit 4   step 4 has been spent. Four, ever.
 *   paid_alternative_bought exit 3 they paid us to do it
 *   payment_in_flight     exit 3   a checkout link is out; hold, do not end
 *   client_replied        exit 5   a human takes it from here
 *   escalation            exit 6   a lawyer, a threat, a complaint about us
 *   opted_out             exit 6   the existing suppression path said stop
 *   program_complete      exit 7
 *   program_cancelled     exit 7
 *   check_failed          —        we do not know, so the answer is no
 */
export async function blockersFor(db, { waypointId, now = new Date() } = {}) {
  if (!waypointId) return ["waypoint_missing"];

  try {
    /* THE WAYPOINT, READ FRESH. This is the line that answers exit 1 at send
       time rather than at schedule time: whatever the planner believed a
       moment ago, this is the row as it stands now. */
    const wp = (await db.query(
      `SELECT id, org_id, client_id, owner_kind, state, due_at, completed_at
         FROM client_waypoints WHERE id = $1 LIMIT 1`,
      [waypointId]
    )).rows[0];
    if (!wp) return ["waypoint_missing"];

    const reasons = [];

    if (wp.owner_kind !== "client") reasons.push("owner_is_fundhub");
    if (wp.state === "done" || wp.state === "skipped") reasons.push("waypoint_complete");
    else if (!CHASEABLE_STATES.has(wp.state)) reasons.push("waypoint_blocked");
    /* completed_at is pinned to state='done' by 330's CHECK, so this can only
       fire if that constraint is ever relaxed. Cheap, and it fails closed. */
    if (wp.completed_at != null && !reasons.includes("waypoint_complete")) {
      reasons.push("waypoint_complete");
    }

    const dueAt = wp.due_at ? new Date(wp.due_at) : null;
    const at = now instanceof Date ? now : new Date(now);
    if (dueAt == null || Number.isNaN(dueAt.getTime()) || dueAt.getTime() > at.getTime()) {
      reasons.push("not_overdue");
    }

    /* EXIT 4 — THE HARD CAP, READ FROM STORAGE. Not from the scheduler's
       memory, not from a counter in a payload. If the final rung has a row,
       the ladder is over for good. */
    const spent = (await db.query(
      `SELECT step FROM waypoint_nudges WHERE waypoint_id = $1`,
      [waypointId]
    )).rows.map((r) => Number(r.step));
    if (spent.includes(4)) reasons.push("ladder_exhausted");

    /* EXIT 3 — they bought the paid alternative for THIS waypoint. */
    const paid = (await db.query(
      `SELECT status FROM paid_service_requests WHERE waypoint_id = $1`,
      [waypointId]
    )).rows.map((r) => String(r.status));
    if (paid.some((s) => BOUGHT_STATUSES.has(s))) reasons.push("paid_alternative_bought");
    else if (paid.some((s) => PENDING_PAYMENT_STATUSES.has(s))) reasons.push("payment_in_flight");

    /* EXIT 6 — the EXISTING suppression path. isOptedOut() from
       src/lib/opt-out.mjs, which is the same function sendTemplated calls and
       the same table src/handlers/comms.mjs writes on a STOP keyword. No second
       opt-out store is created here and none is consulted.

       Either channel stops the WHOLE ladder, not just its own rung. Somebody
       who texted STOP has told us to stop; carrying on by email because the
       word arrived over SMS is the letter of the rule against its point. */
    if (await isOptedOut(db, wp.client_id, "sms")) reasons.push("opted_out");
    else if (await isOptedOut(db, wp.client_id, "email")) reasons.push("opted_out");

    /* EXIT 7 — the program. 'upsell_pending' is a live program mid-conversation
       and is still chased; 'complete' and 'cancelled' are not.

       ON HOLD IS NOT IMPLEMENTED, AND THAT IS A REPORTED GAP RATHER THAN AN
       INVENTED COLUMN. repair_programs.status (250) permits exactly four
       values — active, complete, upsell_pending, cancelled — and no table in
       this schema carries a pause, a hold or a snooze for a client. Nothing was
       invented to cover it. The nearest honest lever that does exist is
       per-waypoint: setting a waypoint's state to 'blocked' stops its chase,
       via CHASEABLE_STATES above. */
    const program = (await db.query(
      `SELECT status FROM repair_programs WHERE client_id = $1 LIMIT 1`,
      [wp.client_id]
    )).rows[0];
    if (program?.status === "complete") reasons.push("program_complete");
    if (program?.status === "cancelled") reasons.push("program_cancelled");

    /* EXIT 5 — the client replied on this thread.

       "This thread" is scoped to this waypoint: an inbound message that landed
       AFTER our first nudge about it. Scoping it that way is deliberate. A
       reply from six months ago is not a reply to a message we sent this
       morning, and stopping every ladder a client will ever have because they
       once texted back would quietly kill the feature. */
    const first = (await db.query(
      `SELECT min(created_at) AS first_at FROM waypoint_nudges WHERE waypoint_id = $1`,
      [waypointId]
    )).rows[0]?.first_at || null;
    if (first) {
      const replied = (await db.query(
        `SELECT 1 FROM messages
          WHERE client_id = $1 AND direction = 'inbound' AND created_at >= $2
          LIMIT 1`,
        [wp.client_id, first]
      )).rows.length > 0;
      if (replied) reasons.push("client_replied");
    }

    /* EXIT 6, second half — a complaint, or a lawyer. Any inbound message the
       client has ever sent, not just one on this thread, because a threat is
       about the relationship and not about one checklist row. */
    const inbound = (await db.query(
      `SELECT rendered_body FROM messages
        WHERE client_id = $1 AND direction = 'inbound' AND rendered_body IS NOT NULL
        ORDER BY created_at DESC LIMIT 200`,
      [wp.client_id]
    )).rows;
    if (inbound.some((m) => looksLikeEscalation(m.rendered_body))) reasons.push("escalation");

    return reasons;
  } catch (err) {
    /* WE DO NOT KNOW, SO THE ANSWER IS NO. Never re-raised, never neutral —
       an exception that propagated would take a whole sweep down, and a
       sweep that dies half-way is a sweep that resumes and re-decides. */
    console.warn(`[nudge/exits] check failed for waypoint ${waypointId}: ${String(err?.message || err)}`);
    return ["check_failed"];
  }
}

export default { blockersFor, contactFor, looksLikeEscalation, CHASEABLE_STATES, BOUGHT_STATUSES };
