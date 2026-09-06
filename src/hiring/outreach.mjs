// Candidate outreach — the applicant finally hears from us.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT WAS WRONG
//
// src/hiring/pipeline.mjs contains no send call of any kind. apply() writes a
// candidate, an application and a score, and then nothing reaches the person.
// They wait, hear nothing, and take another job. 051 built the whole funnel and
// left the front door unanswered.
//
// Owner-described 2026-09-05: applicant arrives, we reach out automatically by
// email and text, and we keep following up until they book or go cold.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS IS NOT A SECOND MESSAGING MECHANISM
//
// It writes `messages` rows with status='queued' and stops. src/messaging/
// dispatch.mjs gates, routes and sends them; src/workflows/message-dispatch-
// sweeper.mjs is what calls it. There is no fetch in this file and none may be
// added — outbound transmission lives in src/messaging/providers/* and nowhere
// else (CLAUDE.md §12).
//
// WHY NOT sendTemplated(). That helper resolves the destination address off the
// `clients` row (ADDRESS_BY_CHANNEL in src/workflows/messaging.mjs), so with no
// client it writes to_address NULL and the message is blocked at the gate for
// having no recipient. A candidate is not a client and must never become one —
// 051's header spends a paragraph on why. So this follows the path the repo
// already uses for the two other non-client recipients it has,
// src/partners/welcome.mjs and src/affiliates/drip.mjs: render the template,
// insert the row with client_id NULL and the address on it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THREE THINGS THIS FILE WILL NOT DO
//
// 1. IT NEVER REJECTS ANYBODY. Going cold stops the follow-ups and nothing
//    else: no hiring_decisions row, no status change, no stage move. The
//    application stays open exactly as a human left it. 051 enforces that with
//    a CHECK and a trigger and this file does not go near either.
//
// 2. IT NEVER TEXTS SOMEBODY WHO DID NOT ASK FOR IT. candidates.sms_consent is
//    false by default and the database refuses a `true` that does not carry the
//    wording the applicant agreed to (295). An applicant who left the box
//    unticked gets email only — see smsTarget() below.
//
// 3. IT NEVER INVENTS THE JOB. The copy in 295 names no pay, no hours, no OTE
//    and no promise about the role, because none of that exists in this repo —
//    hiring_roles.comp is '{}' for every seeded role. And it will not invent the
//    booking link: a req with no interview_booking_url sends NOTHING and files a
//    task for the person who owns the req.

import { renderTemplate } from "../lib/render-template.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";
import { createTask } from "../lib/create-task.mjs";
import { assigneeFor } from "./owner.mjs";
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";

/* THE CADENCE. Four touches over ten days, then it stops on its own.
   The spacing is a process choice, not a fact about the business, so it lives
   here in one frozen list rather than being scattered through the sweeper.

   afterDays is measured from the PREVIOUS step, not from the application, so
   changing one gap does not silently shift every later one. */
export const CADENCE = Object.freeze([
  Object.freeze({ step: 1, afterDays: 0,  emailKey: "EMAIL-CANDIDATE-OUTREACH-1", smsKey: "SMS-CANDIDATE-OUTREACH-1" }),
  Object.freeze({ step: 2, afterDays: 2,  emailKey: "EMAIL-CANDIDATE-OUTREACH-2", smsKey: "SMS-CANDIDATE-OUTREACH-2" }),
  Object.freeze({ step: 3, afterDays: 3,  emailKey: "EMAIL-CANDIDATE-OUTREACH-3", smsKey: "SMS-CANDIDATE-OUTREACH-3" }),
  Object.freeze({ step: 4, afterDays: 5,  emailKey: "EMAIL-CANDIDATE-OUTREACH-4", smsKey: "SMS-CANDIDATE-OUTREACH-4" })
]);

/** Every template key this module can queue. Exported because the compliance
    gate keeps an allow-list of keys that may go out with no client attached
    (PARTNER_WELCOME_KEYS / PARTNER_WELCOME_SMS_KEYS in src/messaging/gate.mjs)
    and these belong on it — see the note at the bottom of this file. */
export const OUTREACH_EMAIL_KEYS = Object.freeze(CADENCE.map((s) => s.emailKey));
export const OUTREACH_SMS_KEYS = Object.freeze(CADENCE.map((s) => s.smsKey));

export const SOURCE_WORKFLOW = "hiring-outreach-cadence";

/** How many applications one sweep will work. Bounded for the same reason the
    message sweeper is: a pass that cannot finish the backlog is finished by the
    next pass, and nothing is lost by stopping early. */
export const SWEEP_CAP = 25;

/** Stages where automatic chasing is no longer wanted, because a person is
    already engaged with this candidate. Reaching any of them stops the cadence
    with reason 'decided' — it does NOT decide anything itself. */
export const HANDS_ON_STAGES = Object.freeze([
  "group_interview", "one_on_one", "offer", "hired", "onboarding", "ramp", "performing"
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/* The gate's own E.164 shape (src/messaging/gate.mjs), repeated as a value
   rather than imported because that file does not export it. A number this
   does not match is not textable and the candidate gets email only. */
const E164 = /^\+[1-9]\d{7,14}$/;

const at = (now) => (now instanceof Date ? now : now ? new Date(now) : new Date());

function firstName(full) {
  const first = String(full || "").trim().split(/\s+/)[0];
  return first || "there";
}

/* smsTarget — the number we may text, or null.

   THREE conditions, all of them required, and the order is deliberate: consent
   first, because a number we are not allowed to use is not a number. */
export function smsTarget(candidate = {}) {
  if (candidate.sms_consent !== true) return null;      // never ticked the box
  if (candidate.sms_opt_out_at) return null;            // asked us to stop
  const num = normalizePhone(candidate.phone);
  return num && E164.test(num) ? num : null;
}

/* emailTarget — the address we may email, or null. */
export function emailTarget(candidate = {}) {
  if (candidate.email_opt_out_at) return null;
  const addr = String(candidate.email || "").trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

/* ensureOutreach — start (or find) the cadence for one application.

   Called from the inbound path, and idempotent: a redelivered application
   webhook must not produce a second cadence. The unique index on
   application_id is the guarantee; the ON CONFLICT is the fast path.

   Returns { outreach, created }. */
export async function ensureOutreach(db, { orgId, applicationId, now = null } = {}) {
  if (!orgId) throw new Error("ensureOutreach: orgId is required");
  if (!applicationId) throw new Error("ensureOutreach: applicationId is required");

  const app = (await db.query(
    `SELECT id, org_id, candidate_id, status FROM candidate_applications WHERE id = $1`,
    [applicationId])).rows[0];
  if (!app) { const e = new Error("application not found"); e.code = "NOT_FOUND"; throw e; }

  const ins = await db.query(
    `INSERT INTO candidate_outreach (org_id, application_id, candidate_id, next_due_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
     ON CONFLICT (application_id) DO NOTHING
     RETURNING *`,
    [orgId, applicationId, app.candidate_id, now ? at(now).toISOString() : null]);

  if (ins.rows[0]) return { outreach: ins.rows[0], created: true };
  const existing = await db.query(
    `SELECT * FROM candidate_outreach WHERE application_id = $1`, [applicationId]);
  return { outreach: existing.rows[0], created: false };
}

/* stopOutreach — the exit, with a reason, always.

   Idempotent and one-way: a cadence that is already stopped keeps its FIRST
   reason. "They replied and then we noticed a decision" should read as
   'replied', because that is what actually ended it. */
export async function stopOutreach(db, { orgId, applicationId, reason, now = null } = {}) {
  if (!reason) throw new Error("stopOutreach: a reason is required");
  const { rows } = await db.query(
    `UPDATE candidate_outreach
        SET status = 'stopped', stopped_at = COALESCE($3::timestamptz, now()), stop_reason = $2
      WHERE application_id = $1 AND status = 'active'
      RETURNING *`,
    [applicationId, reason, now ? at(now).toISOString() : null]);
  if (rows[0]) return { stopped: true, reason, outreach: rows[0] };

  const current = await db.query(
    `SELECT * FROM candidate_outreach WHERE application_id = $1`, [applicationId]);
  return {
    stopped: false,
    reason: current.rows[0]?.stop_reason || null,
    outreach: current.rows[0] || null
  };
}

/* recordCandidateReply — a human being answered us. Stop everything.

   ⚠️ NOTHING CALLS THIS YET, and that is a finding rather than an oversight.
   Inbound messages land in src/handlers/comms.mjs, which matches a sender to a
   `clients` row and files the message against it. A candidate has no clients
   row, and `messages` has no from-address column, so an applicant's reply is
   currently recorded NOWHERE this cadence could read. Wiring it needs a change
   in that handler, which is outside this module — see the handoff note at the
   bottom of this file. Until then a reply stops the cadence only when somebody
   calls this. */
export async function recordCandidateReply(db, { orgId, applicationId, candidateId, now = null } = {}) {
  const when = now ? at(now).toISOString() : null;
  const target = applicationId
    ? { sql: `application_id = $1`, param: applicationId }
    : { sql: `candidate_id = $1`, param: candidateId };
  if (!target.param) throw new Error("recordCandidateReply: applicationId or candidateId is required");

  const { rows } = await db.query(
    `UPDATE candidate_outreach
        SET replied_at = COALESCE(replied_at, COALESCE($2::timestamptz, now())),
            status      = 'stopped',
            stopped_at  = COALESCE(stopped_at, COALESCE($2::timestamptz, now())),
            stop_reason = COALESCE(stop_reason, 'replied')
      WHERE ${target.sql} AND status = 'active'
      RETURNING *`,
    [target.param, when]);
  return { stopped: rows.length, outreach: rows };
}

/* recordCandidateOptOut — they asked us to stop, on one channel or both.

   Writes the instant onto `candidates` (not onto opt_outs, which is keyed on a
   client id) and stops the cadence when there is no channel left to use. Losing
   texting but keeping email is NOT a stop: the email is still wanted. */
export async function recordCandidateOptOut(db, { orgId, candidateId, channel, now = null } = {}) {
  if (!candidateId) throw new Error("recordCandidateOptOut: candidateId is required");
  const when = now ? at(now).toISOString() : null;
  const col = channel === "sms" ? "sms_opt_out_at"
    : channel === "email" ? "email_opt_out_at"
      : null;

  const cand = (await db.query(
    col
      ? `UPDATE candidates SET ${col} = COALESCE(${col}, COALESCE($2::timestamptz, now())), updated_at = now()
          WHERE id = $1 RETURNING *`
      : `UPDATE candidates
            SET sms_opt_out_at   = COALESCE(sms_opt_out_at,   COALESCE($2::timestamptz, now())),
                email_opt_out_at = COALESCE(email_opt_out_at, COALESCE($2::timestamptz, now())),
                updated_at = now()
          WHERE id = $1 RETURNING *`,
    [candidateId, when])).rows[0];
  if (!cand) { const e = new Error("candidate not found"); e.code = "NOT_FOUND"; throw e; }

  // Only a candidate with nothing left to reach them on is stopped.
  if (emailTarget(cand) || smsTarget(cand)) {
    return { candidate: cand, stopped: 0 };
  }
  const { rows } = await db.query(
    `UPDATE candidate_outreach
        SET status = 'stopped',
            stopped_at  = COALESCE(stopped_at, COALESCE($2::timestamptz, now())),
            stop_reason = COALESCE(stop_reason, 'opted_out')
      WHERE candidate_id = $1 AND status = 'active'
      RETURNING id`,
    [candidateId, when]);
  return { candidate: cand, stopped: rows.length };
}

/* stopReasonFor — has anything happened that means we stop chasing?

   Read fresh every pass rather than trusted from a flag, for exactly the reason
   the messaging gate reads opt-out fresh: this cadence sleeps for days between
   steps, and everything below can become true while it is asleep.

   Returns a reason string, or null to carry on. */
export async function stopReasonFor(db, row) {
  if (row.replied_at) return "replied";
  if (row.booked_at) return "booked";

  const app = (await db.query(
    `SELECT a.status, s.key AS stage_key
       FROM candidate_applications a
       JOIN pipeline_stages s ON s.id = a.stage_id
      WHERE a.id = $1`, [row.application_id])).rows[0];
  if (!app) return "decided";                       // the application went away
  if (app.status !== "open") return "decided";      // hired, rejected or withdrawn
  if (HANDS_ON_STAGES.includes(app.stage_key)) return "decided";

  /* BOOKED. An attendee row is the only durable record in this schema that a
     candidate has a time in the diary — hiring_interviews carries the slot and
     hiring_interview_attendees ties this application to it (051 §G). A
     cancelled interview is not a booking, so it does not count. */
  const booked = await db.query(
    `SELECT 1 FROM hiring_interview_attendees att
       JOIN hiring_interviews i ON i.id = att.interview_id
      WHERE att.application_id = $1 AND i.status <> 'cancelled'
      LIMIT 1`, [row.application_id]);
  if (booked.rows[0]) return "booked";

  const cand = (await db.query(
    `SELECT email, phone, sms_consent, sms_opt_out_at, email_opt_out_at
       FROM candidates WHERE id = $1`, [row.candidate_id])).rows[0];
  if (!cand) return "decided";
  if (!emailTarget(cand) && !smsTarget(cand)) return "opted_out";

  if (row.step >= CADENCE.length) return "completed";
  return null;
}

/* templateFor — one approved, non-draft template row, or null.

   Same three refusals sendTemplated makes and in the same order: missing,
   draft, unapproved. A template that does not exist yet is a no-op, never
   invented copy. */
async function templateFor(db, orgId, key) {
  const row = (await db.query(
    `SELECT template_key, channel, subject, body, compliance_passed
       FROM message_templates WHERE org_id = $1 AND template_key = $2 LIMIT 1`,
    [orgId, key])).rows[0];
  if (!row) return null;
  if (isDraftTemplateRow(row)) return null;
  if (!row.compliance_passed) return null;
  return row;
}

/* outreachContext — every merge tag the copy in 295 can use, and no others.

   Deliberately narrow. There is no {{comp}}, no {{ote}}, no {{pay}} and no
   description of the job, because nothing in this repo holds those and a merge
   tag that resolves to "" would mail a sentence with a hole in it. */
export function outreachContext({ candidate, role } = {}) {
  return {
    candidate: {
      first_name: firstName(candidate?.full_name),
      email: candidate?.email || ""
    },
    role: {
      name: role?.name || "",
      booking_url: role?.interview_booking_url || ""
    }
  };
}

/* queueStep — write the messages for ONE step of the cadence.

   Returns { queued, messages[], skipped[] }. Never throws on a missing
   template or an unusable address: those are normal states with names, and a
   cadence that fell over because one template was not written yet would stop
   the other three from ever going.

   IDEMPOTENT per (application, step, channel) through provider_ref and 004's
   unique index on (org_id, provider_ref). A sweep that runs twice — or a step
   retried after a crash between the insert and the state update — queues one
   message, not two. */
export async function queueStep(db, { orgId, outreach, step, now = null } = {}) {
  const spec = CADENCE.find((s) => s.step === step);
  if (!spec) return { queued: 0, messages: [], skipped: [{ reason: "no_such_step", step }] };

  const cand = (await db.query(
    `SELECT * FROM candidates WHERE id = $1`, [outreach.candidate_id])).rows[0];
  if (!cand) return { queued: 0, messages: [], skipped: [{ reason: "candidate_missing" }] };

  const role = (await db.query(
    `SELECT r.id, r.key, r.name, r.interview_booking_url
       FROM candidate_applications a JOIN hiring_roles r ON r.id = a.role_id
      WHERE a.id = $1`, [outreach.application_id])).rows[0];
  if (!role) return { queued: 0, messages: [], skipped: [{ reason: "role_missing" }] };

  /* THE LINK IS NOT INVENTED. Every message in this cadence asks somebody to
     book a time, so with nowhere to send them there is nothing to say. The
     person who owns the req is told, once, and nothing is mailed. */
  if (!String(role.interview_booking_url || "").trim()) {
    await askForBookingLink(db, { orgId, roleKey: role.key, roleName: role.name });
    return { queued: 0, messages: [], skipped: [{ reason: "no_booking_link", role: role.key }] };
  }

  const ctx = outreachContext({ candidate: cand, role });
  const out = [];
  const skipped = [];

  const toEmail = emailTarget(cand);
  if (toEmail) {
    const tpl = await templateFor(db, orgId, spec.emailKey);
    if (!tpl) skipped.push({ channel: "email", reason: "template_pending", key: spec.emailKey });
    else {
      const id = await insertMessage(db, {
        orgId, channel: "email", tpl, ctx, toAddress: toEmail,
        providerRef: refFor(outreach.application_id, step, "email")
      });
      if (id) out.push({ channel: "email", messageId: id, templateKey: tpl.template_key });
      else skipped.push({ channel: "email", reason: "already_queued", key: spec.emailKey });
    }
  } else {
    skipped.push({ channel: "email", reason: "no_email_destination" });
  }

  const toSms = smsTarget(cand);
  if (toSms) {
    const tpl = await templateFor(db, orgId, spec.smsKey);
    if (!tpl) skipped.push({ channel: "sms", reason: "template_pending", key: spec.smsKey });
    else {
      const id = await insertMessage(db, {
        orgId, channel: "sms", tpl, ctx, toAddress: toSms,
        providerRef: refFor(outreach.application_id, step, "sms")
      });
      if (id) out.push({ channel: "sms", messageId: id, templateKey: tpl.template_key });
      else skipped.push({ channel: "sms", reason: "already_queued", key: spec.smsKey });
    }
  } else {
    /* NOT AN ERROR AND NOT A GAP. An applicant who left the text box unticked
       is supposed to get email only. Named so a report can tell that apart from
       a missing phone number. */
    skipped.push({
      channel: "sms",
      reason: cand.sms_consent === true ? "no_textable_number" : "no_sms_consent"
    });
  }

  return { queued: out.length, messages: out, skipped };
}

const refFor = (applicationId, step, channel) => `candidate:${applicationId}:step${step}:${channel}`;

/* insertMessage — the queued row, and nothing else.

   scheduled_at is left NULL, which the dispatcher reads as "due now". The
   cadence's own clock is candidate_outreach.next_due_at; putting a second clock
   on the message would mean two things deciding when a follow-up goes out. */
async function insertMessage(db, { orgId, channel, tpl, ctx, toAddress, providerRef }) {
  const body = renderTemplate(tpl.body, ctx);
  const subject = tpl.subject ? renderTemplate(tpl.subject, ctx) : null;
  const { rows } = await db.query(
    `INSERT INTO messages
       (org_id, client_id, direction, channel, template_key, rendered_body,
        provider, provider_ref, status, compliance_check_passed, to_address, subject)
     VALUES ($1, NULL, 'outbound', $2, $3, $4, NULL, $5, 'queued', true, $6, $7)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, channel, tpl.template_key, body, providerRef, toAddress, subject]);
  return rows[0]?.id || null;
}

/* askForBookingLink — tell the person who owns the req, once.

   Routed through assigneeFor() so it lands wherever that req is meant to land
   (a named hiring manager, the sales manager rule, or the owner backstop).
   Never throws: a missing task must not stop the rest of a sweep. */
async function askForBookingLink(db, { orgId, roleKey, roleName }) {
  try {
    const who = await assigneeFor(db, { orgId, roleKey });
    return await createTask(db, {
      orgId,
      clientId: null,
      ...who,
      title: `Add the interview booking link for ${roleName || roleKey}`,
      sourceWorkflow: SOURCE_WORKFLOW,
      // The dedupe key for a task with no client is the BODY (006's unique index
      // is on (client_id, source_workflow, body) NULLS NOT DISTINCT), so this
      // must be stable per req and distinct between reqs.
      body: `hiring_roles.interview_booking_url is empty for "${roleKey}", so nobody who applies for it gets any follow-up. Set it and the emails and texts start on the next pass.`
    });
  } catch (err) {
    return { created: false, reason: `task_failed: ${String(err.message).slice(0, 120)}` };
  }
}

/* runOutreach — one application, one pass.

   Check the exits, send at most one step, book the next one. Returns a plain
   result rather than throwing so the sweeper can report per-application
   outcomes without one bad row ending the pass. */
export async function runOutreach(db, { orgId, applicationId, now = null } = {}) {
  const row = (await db.query(
    `SELECT * FROM candidate_outreach WHERE application_id = $1`, [applicationId])).rows[0];
  if (!row) return { ok: false, reason: "no_cadence" };
  if (row.status !== "active") return { ok: true, reason: "already_stopped", stopReason: row.stop_reason };

  const stop = await stopReasonFor(db, row);
  if (stop) {
    await stopOutreach(db, { orgId: row.org_id, applicationId, reason: stop, now });
    return { ok: true, reason: "stopped", stopReason: stop, queued: 0 };
  }

  const step = row.step + 1;
  const result = await queueStep(db, { orgId: row.org_id, outreach: row, step, now });

  /* THE STEP COUNTER MOVES EVEN WHEN NOTHING WAS QUEUED, on purpose, EXCEPT
     when the whole req is missing its booking link. A step whose template is
     not written yet, or whose candidate has no textable number, is a step that
     happened — leaving the counter still would retry it every half hour
     forever. A missing booking link is different: it is one fixable thing, it
     blocks every channel at once, and burning the cadence down while somebody
     is being asked to paste a URL would waste the whole sequence. So that case
     leaves the counter alone and simply waits. */
  const blockedOnConfig = result.skipped.some((s) => s.reason === "no_booking_link");
  if (blockedOnConfig) {
    const when = at(now);
    await db.query(
      `UPDATE candidate_outreach SET next_due_at = $2 WHERE application_id = $1`,
      [applicationId, new Date(when.getTime() + DAY_MS).toISOString()]);
    return { ok: true, reason: "no_booking_link", queued: 0, step: row.step, result };
  }

  const next = CADENCE.find((s) => s.step === step + 1);
  const when = at(now);
  const nextDue = next ? new Date(when.getTime() + next.afterDays * DAY_MS) : when;

  await db.query(
    `UPDATE candidate_outreach
        SET step = $2,
            last_sent_at = CASE WHEN $4 > 0 THEN $3::timestamptz ELSE last_sent_at END,
            next_due_at = $5::timestamptz
      WHERE application_id = $1`,
    [applicationId, step, when.toISOString(), result.queued, nextDue.toISOString()]);

  // The last step is the last step. Close it here rather than waiting for the
  // next sweep to notice, so the row's state matches what actually happened.
  if (!next) {
    await stopOutreach(db, { orgId: row.org_id, applicationId, reason: "completed", now: when });
  }

  return { ok: true, reason: "sent", step, queued: result.queued, result, stopped: !next };
}

/* sweepCandidateOutreach — every active cadence that is due.

   Bounded, and never throws: this is a scheduled job and the next pass is the
   recovery. Nothing here reaches a provider — it fills the queue that
   src/messaging/dispatch.mjs drains. */
export async function sweepCandidateOutreach(db, { cap = SWEEP_CAP, now = null } = {}) {
  const when = at(now);
  const due = await db.query(
    `SELECT application_id, org_id FROM candidate_outreach
      WHERE status = 'active' AND next_due_at <= $1::timestamptz
      ORDER BY next_due_at ASC
      LIMIT $2`,
    [when.toISOString(), cap]);

  const results = [];
  for (const row of due.rows) {
    try {
      results.push({
        applicationId: row.application_id,
        ...(await runOutreach(db, { orgId: row.org_id, applicationId: row.application_id, now: when }))
      });
    } catch (err) {
      results.push({
        applicationId: row.application_id,
        ok: false,
        reason: "error",
        error: String((err && err.message) || err).slice(0, 200)
      });
    }
  }

  return {
    ok: true,
    scanned: due.rows.length,
    queued: results.reduce((a, r) => a + (r.queued || 0), 0),
    stopped: results.filter((r) => r.reason === "stopped").length,
    results
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TWO THINGS THIS MODULE CANNOT DO ON ITS OWN. Both are real, both are named
// here rather than worked around.
//
// 1. THE GATE BLOCKS A MESSAGE WITH NO CLIENT ON IT.
//    src/messaging/gate.mjs refuses any message that has no clientId unless its
//    template key is on PARTNER_WELCOME_KEYS (email) or PARTNER_WELCOME_SMS_KEYS
//    (sms) — "we could not find a record" must never resolve to "nobody
//    objected", which is the right default. A candidate has no clients row by
//    design, so every row this file queues is currently blocked at dispatch.
//    The keys in OUTREACH_EMAIL_KEYS / OUTREACH_SMS_KEYS above have to be
//    allowed there, alongside the same upstream condition that makes the
//    partner text safe: the SMS keys may only pass because 295's CHECK refuses
//    an sms_consent that carries no recorded wording, so the row existing IS the
//    consent record. That file belongs to the messaging gate, not to hiring.
//
// 2. A CANDIDATE'S REPLY IS RECORDED NOWHERE.
//    src/handlers/comms.mjs files an inbound message against a `clients` row and
//    drops it otherwise, and `messages` has no from-address column, so there is
//    no query this module could run that would find an applicant's answer.
//    recordCandidateReply() is the mechanism; the trigger for it is a change in
//    that handler. Until then "stop on reply" holds only when something calls it.

export default {
  CADENCE, ensureOutreach, stopOutreach, recordCandidateReply, recordCandidateOptOut,
  stopReasonFor, queueStep, runOutreach, sweepCandidateOutreach, smsTarget, emailTarget,
  outreachContext
};
