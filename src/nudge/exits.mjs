// The exit conditions. These are not a detail of the nudge ladder — they ARE
// the ladder. A loop that sends nothing is a success; a loop that sends twice
// is a failure.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file. NOTHING IN THIS FILE SENDS ANYTHING: it imports no
// provider, no dispatcher and no template, and every function in it can do
// exactly one thing — say no.
//
// IT WRITES IN EXACTLY TWO PLACES, BOTH ON THE SAME EVENT, AND NEITHER CAN
// LIFT A STOP.
//
//   1. scanForEscalation() records the durable client_escalations row (368) the
//      first time a client's legal or complaint language is seen. That INSERT
//      is ON CONFLICT DO NOTHING and there is no update or delete path here, so
//      this file can add a permanent stop and can never lift one. It used to
//      re-derive that answer from the client's most recent 200 messages on
//      every pass, which meant a legal threat EXPIRED once they had sent 200
//      more — see the comment above PRESCAN_SOURCE.
//   2. announceEscalation() creates ONE staff task, only when 1 actually wrote
//      a new row. Added 2026-09-06, round four: a reviewer's "that collection
//      agency that keeps calling me is a scam" — a client complaining about
//      somebody else — permanently ended every chase that client will ever
//      have, and because nothing outside src/nudge/ reads client_escalations,
//      no screen in the product showed that it had happened. The stop stays
//      permanent; it is no longer invisible.
//
// Neither write can send anything. A task is a row on a staff board.
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
import { createTask } from "../lib/create-task.mjs";
/* The seven-day checkout window, from the one file that holds it. link-ttl.mjs
   imports nothing, so this does not put a processor — or a fetch — anywhere
   near the exit gate. CLAUDE.md §12. */
import { CHECKOUT_LINK_TTL_MS } from "../paid-services/link-ttl.mjs";

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
    paid alternative AND WE STILL OWE THEM THE WORK. Money is recorded at
    'paid'; 'staged' is prepared and waiting on a human to send; 'fulfilled' is
    delivered.

    'quoted' and 'awaiting_payment' are NOT here. A quote nobody accepted must
    not silence the ladder forever — that would turn "we offered to do it for
    you" into "we stopped reminding you". 'awaiting_payment' is a hold with an
    end on it, handled further down.

    'refunded' IS NOT HERE EITHER, AND IT USED TO BE. A refund means the money
    went back, which means WE DID NOT DO IT FOR THEM. Treating that as "they
    paid us to handle this one" left the client permanently unchased about a
    task that is theirs again — silence bought with money we gave back. The
    reviewer who found it also checked the two neighbours: 'cancelled' and
    'quoted' both correctly leave the client chaseable, and they still do.
    'failed' likewise. */
export const BOUGHT_STATUSES = Object.freeze(new Set(["paid", "staged", "fulfilled"]));

/** A checkout link is out. Hold this pass; do not end the ladder — AND THE HOLD
    HAS AN END, which until 2026-09-06 it did not.

    See paymentHoldIsLive() below for the whole story and the measurement. The
    short version: nothing in this repository ever expired a checkout link, so
    "we will chase again when it expires" meant "never", and those clients held
    a slot in a platform-wide queue for ever. */
export const PENDING_PAYMENT_STATUSES = Object.freeze(new Set(["awaiting_payment"]));

/**
 * paymentHoldIsLive(row, now) → is this awaiting_payment row still a reason to
 * stay quiet?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PREMISE WAS FALSE. THIS IS WHAT MAKES IT TRUE.
 *
 * `payment_in_flight` was classified as a TEMPORARY stop on the stated ground
 * that "a checkout link is out. It expires; then we chase again." Enumerated on
 * 2026-09-06: paid_service_requests had no expiry column, src/paid-services/
 * checkout.mjs set no deadline, and no file under src/workflows/ named the
 * table. The only code that moved a row off awaiting_payment was the payment
 * webhook — which docs/journeys/paid-round-actual.md records is not on the live
 * bus — and closeFailed, which only fires when minting the link fails.
 *
 * So a client sent a link who never paid was never chased again, and because
 * that waypoint stayed overdue and oldest it sorted FIRST and held a slot in a
 * queue shared by every company on the platform. Measured on a scratch Postgres
 * 16.14 in this worktree: 200 such clients plus one freshly overdue live client
 * gave 200 candidates, the live one not among them, zero messages to them,
 * today and a year later.
 *
 * db/migrations/370 adds checkout_expires_at and refuses an awaiting_payment
 * row without one; src/paid-services/link-ttl.mjs states the number (seven
 * days) and stamps it at mint; src/paid-services/expire.mjs closes the row when
 * it passes. This function is the fourth place, and it is here so the fix holds
 * on a pass where the sweep has not run yet.
 *
 * A MISSING STAMP IS NOT TREATED AS A LIVE HOLD. NULL means unknown
 * (CLAUDE.md §12) and unknown must survive as unknown — but "we do not know
 * when this invitation dies" is not the same question as "may we chase this
 * person", and answering the second one with silence for ever is what the whole
 * defect was. So an awaiting_payment row with no stamp falls back to the
 * request's own requested_at plus the same seven days: the EARLIEST the link
 * could have died, because a link is minted at or after the request. That errs
 * toward resuming a chase rather than toward permanent quiet. 370's CHECK plus
 * its backfill mean this branch should never be reached; it is written down
 * rather than assumed away.
 */
export function paymentHoldIsLive(row = {}, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) return true; // an unreadable clock is not a reason to start chasing
  const stamped = row.checkout_expires_at ? new Date(row.checkout_expires_at) : null;
  if (stamped && !Number.isNaN(stamped.getTime())) return stamped.getTime() > at.getTime();

  const requested = row.requested_at ? new Date(row.requested_at) : null;
  if (requested && !Number.isNaN(requested.getTime())) {
    return requested.getTime() + CHECKOUT_LINK_TTL_MS > at.getTime();
  }
  /* No stamp and no request time at all. Both columns are NOT NULL in 331 or
     enforced by 370, so this is unreachable; if the schema ever loosens, the
     conservative answer for a MESSAGE is not to send one. */
  return true;
}

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

/** matchedEscalationPattern(text) → the source of the FIRST pattern that
    matched, or null. Stored on client_escalations.matched_pattern so a human
    reading the row can see which of our rules fired. It is OUR regex, never the
    client's sentence — 368 stores no client words. */
export function matchedEscalationPattern(text) {
  if (text == null) return null;
  const s = String(text);
  const hit = ESCALATION_PATTERNS.find((re) => re.test(s));
  return hit ? hit.source : null;
}

/* ─────────────────────────────────────────────────────────────────────────
   The SQL pre-filter — DERIVED, never hand-maintained
   ─────────────────────────────────────────────────────────────────────────

   The escalation scan used to pull the client's most recent 200 inbound rows
   into JavaScript and regex them there. 200 was a horizon, and a horizon on a
   permanent stop is a bug: the portal chat writes one inbound row per client
   turn (api/chat/portal-message.mjs:48-52), so "my lawyer will be in touch"
   aged out of the window while the row sat untouched in the table. Measured on
   a scratch database on 2026-09-06 — the lawyer message plus 210 ordinary rows,
   and blockersFor returned [].

   The horizon is gone. To keep an unbounded scan cheap, Postgres narrows first
   and JavaScript still decides. That is only safe if the SQL pattern can never
   be NARROWER than the JavaScript one, so it is not written by hand — it is
   built from ESCALATION_PATTERNS by deleting the two pieces of syntax that can
   only ever make a JavaScript regex match LESS:

     \b   a word boundary. Removing it widens.
     (?!) a negative lookahead. Removing it widens.

   Nothing else is touched, so a new pattern added above appears here
   automatically and there is no second list to forget. escalation-prefilter
   in ./exits.test.mjs asserts the widening direction against every pattern. */
const PRESCAN_SOURCE = ESCALATION_PATTERNS
  .map((re) => re.source
    .replace(/\\b/g, "")
    .replace(/\(\?[!=][^)]*\)/g, ""))
  .join("|");

/** The pattern handed to Postgres `~*`. Exported so a test can prove it is a
    superset of every JavaScript pattern rather than taking it on trust. */
export const ESCALATION_PRESCAN = PRESCAN_SOURCE;

/**
 * recordEscalation — write the durable fact, once, and never again.
 *
 * ON CONFLICT DO NOTHING against 368's UNIQUE (client_id): the FIRST sighting
 * wins. Nothing that happens afterwards — more messages, a longer history, a
 * changed keyword list, a later pass that fails to match — can take it back,
 * because there is no update path here and `fundhub_app` holds neither UPDATE
 * nor DELETE on that table.
 *
 * THAT SECOND HALF TOOK TWO ROUNDS TO MAKE TRUE, AND BOTH HALVES ARE WORTH
 * KNOWING BECAUSE THE SENTENCE WAS WRITTEN IN FIVE PLACES BEFORE EITHER WAS.
 *
 *   1. 104_app_role.sql:226 runs ALTER DEFAULT PRIVILEGES ... GRANT SELECT,
 *      INSERT, UPDATE, DELETE ON TABLES TO fundhub_app, so every table created
 *      after it is already fully writable and 368's original
 *      `GRANT SELECT, INSERT` added nothing. It takes an explicit REVOKE, which
 *      368 now carries.
 *   2. THE REVOKE ALONE WAS STILL NOT ENOUGH (found 2026-09-06, round four).
 *      368 declared client_id ... REFERENCES clients(id) ON DELETE CASCADE, and
 *      a cascade runs with the REFERENCED table's owner privileges rather than
 *      the deleting role's. fundhub_app holds DELETE on clients. So the
 *      application could still destroy the record — by deleting the client.
 *      db/migrations/370 makes that foreign key ON DELETE RESTRICT: the
 *      database now refuses to delete a client who has one of these rows.
 *
 * Do not restate the claim anywhere without keeping
 * src/nudge/escalation-permanence.pg.test.mjs green — it is the only thing
 * standing between that sentence and fiction, and it asserts both live
 * refusals as fundhub_app, not just the catalog.
 *
 * Never throws. A failed write must not turn a detected escalation into a
 * permitted send: the caller blocks on the detection, not on the write, and
 * the next pass tries the write again.
 */
export async function recordEscalation(db, { orgId, clientId, messageId = null,
                                             saidAt = null, pattern = null } = {}) {
  if (!orgId || !clientId) return false;
  try {
    const { rows } = await db.query(
      `INSERT INTO client_escalations (org_id, client_id, said_at, message_id, matched_pattern)
       VALUES ($1,$2,$3::timestamptz,$4,$5)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id`,
      [orgId, clientId, saidAt ? new Date(saidAt).toISOString() : null,
       messageId, pattern ? String(pattern).slice(0, 200) : null]
    );
    return rows.length > 0;
  } catch (err) {
    console.warn(`[nudge/exits] escalation not recorded for client ${clientId}: ${String(err?.message || err)}`);
    return false;
  }
}

/** Who is told when a client's chases are stopped for good. The customer
    success manager owns the client after the sale, which is the same role
    src/nudge/run.mjs hands a stalled checklist to. */
export const ESCALATION_TASK_ROLE = "csm";

export const ESCALATION_TASK_WORKFLOW = "waypoint-nudge-escalation";

/**
 * announceEscalation — MAKE THE PERMANENT STOP VISIBLE TO A PERSON.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: A MIS-FIRE WAS UNRECOVERABLE **AND** INVISIBLE
 *
 * A reviewer sent one inbound text on 2026-09-06:
 *
 *     "that collection agency that keeps calling me is a scam"
 *
 * That is a client complaining about SOMEBODY ELSE — the exact class the
 * keyword list's own comment says it is trying to avoid. It matched \bscam\b,
 * wrote a permanent client_escalations row, and ended every chase that client
 * will ever have. Round three's REVOKE (368) means no code path in the product
 * can lift it, and nothing outside src/nudge/ reads the table, so no screen
 * anywhere showed that it had happened.
 *
 * THE PERMANENCE IS RIGHT AND IS NOT BEING WEAKENED. What was wrong is that a
 * mistake was silent. A person now gets a task the first time a client is
 * stopped, so the stop is a thing somebody sees rather than a thing somebody
 * eventually notices from the absence of messages.
 *
 * WHAT WAS DELIBERATELY NOT DONE, AND WHY:
 *
 *   * The regex was NOT narrowed. Every narrowing considered — requiring a
 *     second-person word near "scam", excluding a third-party subject — also
 *     lets through language plainly aimed at us ("stop harassing me", "this is
 *     a scam"). The brief says not to weaken the stop for language aimed at us,
 *     and a keyword list cannot tell the two apart reliably. Leaving it wide and
 *     making the result visible fails toward silence, which is the safe side.
 *   * NO LIFT PATH WAS ADDED. Lifting would mean the application writing to a
 *     row 368 exists to make unwritable, and a lifted row would be re-detected
 *     and re-applied by the very next scan of the same message. A human with
 *     database access can still lift one; the application cannot, and that is
 *     the promise. This is recorded as an OPEN GAP, not as fixed.
 *
 * THE TASK CARRIES NO CLIENT WORDS. Same rule 368 sets for the row itself: the
 * body is our own regex source and the task id, never the client's sentence.
 *
 * Never throws and never blocks. The stop has already been recorded by the time
 * this runs; a task-table problem must not turn a detected escalation into a
 * permitted send.
 */
export async function announceEscalation(db, { orgId, clientId, pattern = null } = {}) {
  if (!orgId || !clientId) return false;
  try {
    const res = await createTask(db, {
      orgId,
      clientId,
      title: "Chases stopped: this client's words matched our escalation rules",
      sourceWorkflow: ESCALATION_TASK_WORKFLOW,
      assigneeRole: ESCALATION_TASK_ROLE,
      /* Also the dedupe key, so a replay finds the task it already made. One
         client can only ever have one escalation row, so one task. */
      eventId: `escalation:${clientId}`,
      body:
        "Every automatic chase for this client has been stopped for good. " +
        "Our own rule that matched: " + (pattern ? String(pattern).slice(0, 200) : "not recorded") + ". " +
        "This records which of OUR rules fired, not anything the client said. " +
        "A human owns this client from here. If the rule fired on something the " +
        "client said about somebody else, the stop cannot be lifted from inside " +
        "the app — that is deliberate, and it needs someone with database access."
    });
    return Boolean(res?.created);
  } catch (err) {
    console.warn(`[nudge/exits] escalation task not created for client ${clientId}: ${String(err?.message || err)}`);
    return false;
  }
}

/** hasEscalation — the durable read. One indexed lookup, no scan. */
export async function hasEscalation(db, clientId) {
  const { rows } = await db.query(
    `SELECT 1 FROM client_escalations WHERE client_id = $1 LIMIT 1`,
    [clientId]
  );
  return rows.length > 0;
}

/**
 * scanForEscalation — the detector. Reads the client's WHOLE inbound history,
 * every time, until the durable row exists.
 *
 * Returns true when this client has ever aimed legal or complaint language at
 * us, and writes the durable row the first time it says so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THERE IS NO WATERMARK, AND REMOVING IT IS THE FIX (2026-09-06, round three)
 *
 * The first version read the most recent 200 messages. That was a horizon and
 * a threat aged out of it. The second version replaced the horizon with a read
 * watermark in a client_escalation_scans table — and the watermark had the same
 * disease in a subtler form:
 *
 *   * it advanced to max(created_at) over EVERY inbound row, including rows the
 *     pre-filter never returned and the comment above it claimed it did not;
 *   * the next pass read with a STRICT "created_at > mark", so a message whose
 *     created_at landed exactly ON the mark was invisible for ever.
 *
 * Reproduced in this worktree on a scratch Postgres 16.14 on 2026-09-06 — eleven
 * ordinary messages, a scan, then "my lawyer will be in touch" stamped at the
 * same instant as the newest of them:
 *
 *     scan 1 -> false; mark = 2026-09-05T18:00:00.000Z
 *     escalation row present in messages? 1
 *     scan 2 -> false
 *     hasEscalation -> false
 *     blockersFor -> []
 *     deliverNudge -> queued
 *     Messages the lawyer-threat client just got: 1
 *
 * A boundary of ">=" instead of ">" would fix that one shape and leave every
 * other one open: a message imported, backfilled or clock-skewed to a timestamp
 * BEHIND the mark is still permanently invisible, and `messages` has no
 * insertion-ordered column to mark instead — its primary key is a random uuid.
 * A mark on a permanent stop is a bet that created_at order equals arrival
 * order, and that bet is not true in this schema.
 *
 * So the mark is gone and the whole history is read on every pass. THE COST WAS
 * MEASURED RATHER THAN GUESSED, on the same database, ten calls averaged:
 * 500 inbound rows 3.5 ms, 2,000 rows 8.4 ms, 10,000 rows 39.9 ms. That is the
 * worst case in every sense — it is the CLEAN client, the one with no
 * escalation, because hasEscalation() short-circuits this whole function from
 * the first sighting onward and a client who has threatened us is never scanned
 * again.
 *
 * OLDEST FIRST, so the row that gets recorded is the FIRST time they said it,
 * not the most recent time.
 */
export async function scanForEscalation(db, { orgId, clientId } = {}) {
  if (!clientId) return false;

  if (await hasEscalation(db, clientId)) return true;

  /* No LIMIT and no watermark, on purpose — both are horizons and a horizon on
     a permanent stop is the defect. The pre-filter is what keeps it cheap:
     Postgres discards the ordinary traffic and JavaScript still decides. */
  const { rows } = await db.query(
    `SELECT id, rendered_body, created_at FROM messages
      WHERE client_id = $1
        AND direction = 'inbound'
        AND rendered_body IS NOT NULL
        AND rendered_body ~* $2
      ORDER BY created_at ASC`,
    [clientId, ESCALATION_PRESCAN]
  );

  for (const m of rows) {
    const pattern = matchedEscalationPattern(m.rendered_body);
    if (!pattern) continue;
    const recorded = await recordEscalation(db, {
      orgId, clientId, messageId: m.id, saidAt: m.created_at, pattern
    });
    /* ONLY ON A GENUINELY NEW ROW. recordEscalation returns true exactly once
       per client — 368's UNIQUE (client_id) with ON CONFLICT DO NOTHING — so
       this cannot produce a task on every pass. See announceEscalation for why
       a silent permanent stop was the defect. */
    if (recorded) {
      await announceEscalation(db, { orgId, clientId, pattern });
    }
    return true;
  }

  return false;
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
 *   paid_alternative_bought exit 3 they paid us to do it — and 'refunded' is
 *                                  NOT one of those, because a refund means we
 *                                  did not do it
 *   payment_in_flight     exit 3   a checkout link is out AND STILL LIVE; hold,
 *                                  do not end. Seven days, from the row's own
 *                                  checkout_expires_at (370)
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

    /* EXIT 3 — they bought the paid alternative for THIS waypoint, or an
       invitation to pay for it is still live.

       'refunded' is NOT a purchase — see BOUGHT_STATUSES. And the in-flight
       hold is bounded now: paymentHoldIsLive() reads the row's own
       checkout_expires_at (db/migrations/370), so a link that went out and was
       never taken up stops silencing this waypoint after seven days instead of
       for ever. */
    const paid = (await db.query(
      `SELECT status, requested_at, checkout_expires_at
         FROM paid_service_requests WHERE waypoint_id = $1`,
      [waypointId]
    )).rows;
    if (paid.some((r) => BOUGHT_STATUSES.has(String(r.status)))) {
      reasons.push("paid_alternative_bought");
    } else if (paid.some((r) => PENDING_PAYMENT_STATUSES.has(String(r.status))
                             && paymentHoldIsLive(r, at))) {
      reasons.push("payment_in_flight");
    }

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
       about the relationship and not about one checklist row.

       THIS IS THE ONE PLACE THIS FILE WRITES. The header above says every check
       only reads, and this is the stated exception: scanForEscalation records
       the durable client_escalations row (368) the first time the words are
       seen. It has to be a write, because the previous version re-derived the
       answer from the client's most recent 200 messages every time and a legal
       threat therefore EXPIRED once they had sent 200 more. The write is
       ON CONFLICT DO NOTHING, so it can only ever add a permanent stop and
       never lift one. */
    if (await scanForEscalation(db, { orgId: wp.org_id, clientId: wp.client_id })) {
      reasons.push("escalation");
    }

    return reasons;
  } catch (err) {
    /* WE DO NOT KNOW, SO THE ANSWER IS NO. Never re-raised, never neutral —
       an exception that propagated would take a whole sweep down, and a
       sweep that dies half-way is a sweep that resumes and re-decides. */
    console.warn(`[nudge/exits] check failed for waypoint ${waypointId}: ${String(err?.message || err)}`);
    return ["check_failed"];
  }
}

export default {
  blockersFor, contactFor, looksLikeEscalation, matchedEscalationPattern,
  recordEscalation, hasEscalation, scanForEscalation, announceEscalation,
  paymentHoldIsLive, ESCALATION_PRESCAN,
  CHASEABLE_STATES, BOUGHT_STATUSES, PENDING_PAYMENT_STATUSES
};
