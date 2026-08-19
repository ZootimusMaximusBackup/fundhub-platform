// src/messaging/outbox.mjs — the queue finally drains.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FIXES, AND IT IS NOT A CONTRACTS PROBLEM
//
// Twenty-six workflows call sendTemplated(). Every one writes a `messages` row
// with status='queued'. src/messaging/dispatch.mjs drains that queue and is
// complete and tested — and nothing had ever called it. Its header says so in
// its own words: "dispatchDue() runs when something calls it, and today nothing
// does."
//
// So every client email this platform has ever composed has been sitting in a
// table. Not blocked, not failed — queued, invisibly, forever.
//
// This module is the general caller. src/contracts/notify.mjs solved it for one
// feature by dispatching its own rows by id; that was right for a single Send
// button and wrong as the answer for the platform. This is the answer for the
// platform: every queued message, for every feature, drained on demand and on a
// schedule.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE SWITCH IS A ROW, NOT AN ENVIRONMENT VARIABLE
//
// `messaging_settings.outbound_enabled` (119) is per company, visible in the
// CRM, changeable by an owner, and attributed. It is a PAUSE BUTTON rather than
// an ignition key: with no provider credentials nothing leaves whatever it says,
// so it exists to stop mail that WOULD otherwise go.
//
// It defaults to ON. A default of off would recreate the exact failure this file
// exists to fix — a system that looks like it sends, does not, and gives no sign.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT DOES NOT DO
//
// It is not an override, and it does not touch the compliance gate. Every
// message still goes through gate → route → send inside dispatch.mjs, in that
// order, with no path that reaches a provider without a gate result of exactly
// "allowed". This module decides WHEN the dispatcher runs, never WHETHER a
// particular message is allowed out.
//
// It holds no URL and no credential and makes no outbound request. Transmission
// lives in src/messaging/providers/* and nowhere else (CLAUDE.md §12).

import { dispatchDue, DEFAULT_BATCH, resolveTimestampParam } from "./dispatch.mjs";
import { createTask } from "../lib/create-task.mjs";

/** What a company that has never touched its settings gets. See the header. */
export const DEFAULTS = Object.freeze({
  outbound_enabled: true,
  daily_send_cap: 500,
  alert_email: null
});

/**
 * settingsFor — one company's outbound settings.
 *
 * A MISSING ROW MEANS THE DEFAULTS, not "disabled". A company created after 119
 * ran would otherwise silently stop sending until somebody noticed, which is the
 * failure mode this whole file is about.
 */
export async function settingsFor(db, orgId) {
  if (!orgId) return { ...DEFAULTS, org_id: null, missing: true };
  try {
    const { rows } = await db.query(
      `SELECT org_id, outbound_enabled, daily_send_cap, alert_email, updated_by, updated_at
         FROM messaging_settings WHERE org_id = $1::uuid LIMIT 1`, [orgId]);
    if (rows[0]) return { ...rows[0], missing: false };
  } catch (err) {
    /* The table not existing is a database that has not run 119 yet. Falling
       back to the defaults keeps an un-migrated environment working rather than
       breaking every send path on a missing relation. */
    console.warn(`[outbox] could not read messaging settings: ${err.message}`);
  }
  return { ...DEFAULTS, org_id: orgId, missing: true };
}

/** setSettings — the CRM switch. Only the fields named are changed. */
export async function setSettings(db, { orgId, staffId = null, outboundEnabled, dailySendCap, alertEmail } = {}) {
  if (!orgId) throw new Error("setSettings: orgId is required");
  const current = await settingsFor(db, orgId);
  const next = {
    outbound_enabled: outboundEnabled === undefined ? current.outbound_enabled : outboundEnabled !== false,
    daily_send_cap: dailySendCap === undefined
      ? current.daily_send_cap
      : Math.max(0, Math.min(100000, Number(dailySendCap) || 0)),
    alert_email: alertEmail === undefined
      ? current.alert_email
      : (String(alertEmail || "").trim() || null)
  };
  const { rows } = await db.query(
    `INSERT INTO messaging_settings (org_id, outbound_enabled, daily_send_cap, alert_email, updated_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id) DO UPDATE
       SET outbound_enabled = EXCLUDED.outbound_enabled,
           daily_send_cap   = EXCLUDED.daily_send_cap,
           alert_email      = EXCLUDED.alert_email,
           updated_by       = EXCLUDED.updated_by,
           updated_at       = now()
     RETURNING *`,
    [orgId, next.outbound_enabled, next.daily_send_cap, next.alert_email, staffId]);
  return rows[0];
}

/**
 * outboxStatus — what the screen shows, and what an operator needs to answer
 * "is anything actually going out?"
 *
 * Counts come from `messages` itself rather than from any counter, because the
 * rows are the record and a counter is a second source of truth that can drift
 * from them.
 */
/* WHAT COUNTS AS ALREADY SENT TODAY.

   This was the bare literal 'sent' in both places below, and that is a bug the
   moment any delivery receipt arrives: a message that moves from 'sent' to
   'delivered' would STOP counting, silently resetting the operator's
   sent-today number and letting the queue drain past its own daily ceiling.
   The Mailgun path already writes 'delivered' and 'complained' today.

   Every status here means the message LEFT. A cap on how much mail we put out
   in a day has to count what went out, not what we later learned about it. */
export const SENT_TODAY_STATUSES = ["sent", "delivered", "complained"];

export async function outboxStatus(db, { orgId, now = null } = {}) {
  const settings = await settingsFor(db, orgId);
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE status = 'queued')                                     ::int AS queued,
       count(*) FILTER (WHERE status = 'queued'
                          AND (scheduled_at IS NULL
                               OR scheduled_at <= COALESCE($2::timestamptz, now()))) ::int AS due,
       count(*) FILTER (WHERE status = 'sending')                                    ::int AS sending,
       count(*) FILTER (WHERE status = 'failed')                                     ::int AS failed,
       count(*) FILTER (WHERE status = 'blocked')                                    ::int AS blocked,
       count(*) FILTER (WHERE status = ANY($3::text[])
                          AND created_at >= date_trunc('day', COALESCE($2::timestamptz, now())))
                                                                                     ::int AS sent_today,
       max(last_attempt_at)                                                                AS last_attempt
       FROM messages
      WHERE org_id = $1::uuid AND direction = 'outbound'`,
    [orgId, resolveTimestampParam(now), SENT_TODAY_STATUSES]);
  const counts = rows[0] || {};

  /* Whether a provider is actually reachable is the question an operator really
     has, and it is NOT the same as the switch. Reported separately and honestly:
     a routing row that names a provider, and whether that provider is enabled. */
  let routing = [];
  try {
    routing = (await db.query(
      `SELECT channel, provider, enabled FROM message_channel_routing
        WHERE org_id = $1::uuid ORDER BY channel`, [orgId])).rows;
  } catch { routing = []; }

  return {
    settings: {
      outbound_enabled: settings.outbound_enabled,
      daily_send_cap: settings.daily_send_cap,
      alert_email: settings.alert_email,
      using_defaults: settings.missing === true
    },
    counts,
    routing,
    // Plain-language summary, so a screen does not have to invent one and two
    // screens cannot word it differently.
    summary: describe(settings, counts, routing)
  };
}

function describe(settings, counts, routing) {
  if (!settings.outbound_enabled) {
    return `Sending is paused. ${counts.queued || 0} message${counts.queued === 1 ? "" : "s"} waiting.`;
  }
  const live = routing.filter((r) => r.enabled);
  if (!live.length) {
    return "Nothing can go out yet — no way to send has been set up. " +
           `${counts.queued || 0} message${counts.queued === 1 ? "" : "s"} waiting.`;
  }
  if (!counts.queued) {
    return counts.sent_today
      ? `All caught up. ${counts.sent_today} sent today.`
      : "All caught up. Nothing waiting.";
  }
  return `${counts.queued} message${counts.queued === 1 ? "" : "s"} waiting to go out` +
         (counts.due ? `, ${counts.due} ready now.` : ", none due yet.");
}

/**
 * drain — run the dispatcher over this company's queue.
 *
 * THIS IS THE CALL THAT WAS MISSING. Everything below it already existed.
 *
 * Returns { ran, reason, dispatched, results, capped }. Never throws: a drain is
 * called from a button, a schedule and a send path, and none of them should fall
 * over because one message could not be routed.
 */
export async function drain(db, { orgId, limit = DEFAULT_BATCH, now = null, dispatchOptions = {} } = {}) {
  if (!orgId) return { ran: false, reason: "no_org", dispatched: 0, results: [] };

  const settings = await settingsFor(db, orgId);
  if (!settings.outbound_enabled) {
    return { ran: false, reason: "paused", dispatched: 0, results: [] };
  }

  /* THE DAILY CAP. Counted from what has actually been sent today, so a
     workflow stuck in a loop mails 500 people and stops, instead of mailing
     50,000 and taking the sending domain down with it. A cap of 0 means no
     ceiling was wanted; treat that as unlimited rather than as a block, because
     a 0 that silently stops all mail is the failure this file exists to end. */
  let allowed = limit;
  if (settings.daily_send_cap > 0) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM messages
        WHERE org_id = $1::uuid AND direction = 'outbound' AND status = ANY($3::text[])
          AND created_at >= date_trunc('day', COALESCE($2::timestamptz, now()))`,
      [orgId, resolveTimestampParam(now), SENT_TODAY_STATUSES]);
    const already = rows[0]?.n || 0;
    const room = settings.daily_send_cap - already;
    if (room <= 0) {
      return { ran: false, reason: "daily_cap_reached", dispatched: 0, results: [], capped: true,
               cap: settings.daily_send_cap, sentToday: already };
    }
    allowed = Math.min(limit, room);
  }

  try {
    const out = await dispatchDue(db, { ...dispatchOptions, orgId, limit: allowed, now });
    const results = out?.results || out || [];
    /* The alert is the last thing and it cannot change the outcome — see
       alertOnFailures. `alert_email` was a column that got written and never
       read until this line. */
    const alert = Array.isArray(results)
      ? await alertOnFailures(db, { orgId, settings, results, now })
      : { alerted: false, reason: "no_results" };
    return {
      ran: true,
      reason: null,
      dispatched: Array.isArray(results) ? results.length : 0,
      sent: Array.isArray(results) ? results.filter((r) => r.outcome === "sent").length : 0,
      blocked: Array.isArray(results) ? results.filter((r) => r.outcome === "blocked").length : 0,
      alert,
      results
    };
  } catch (err) {
    console.warn(`[outbox] drain failed for org ${orgId}: ${err.message}`);
    return { ran: false, reason: "error", error: err.message, dispatched: 0, results: [] };
  }
}

/* How many messages have to fail in one pass before somebody is told. One
   failure is a bad address; several in a row is the sending setup being broken,
   which is the thing nobody finds out about until a client asks why they never
   heard back. */
export const ALERT_FAILURE_THRESHOLD = 3;

export const ALERT_WORKFLOW = "message-dispatch-sweeper";

/**
 * alertOnFailures — tell a human that mail is not going out.
 *
 * WHY A TASK AND NOT AN EMAIL. `messaging_settings.alert_email` names who should
 * hear about it, and the obvious implementation is to email them. That
 * implementation is wrong, and predictably so: the alert fires precisely when
 * sending is broken, so the alert would go into the same queue that is already
 * failing, and the one message guaranteed not to arrive is the one saying
 * nothing is arriving.
 *
 * So the alert is a TASK — in the CRM, on somebody's list, visible without any
 * provider working at all. `alert_email` is carried in the task body so the
 * person picking it up knows who was meant to be told, and so the address stops
 * being a field that is collected and never read.
 *
 * ONE PER COMPANY PER DAY. A sweep runs every five minutes; an alert that files
 * 288 identical tasks in a day is noise that gets ignored, which is the same
 * outcome as no alert at all. The day is in the TITLE, so tomorrow's outage is a
 * new task rather than a silent duplicate of today's.
 *
 * THE DEDUPE IS DONE HERE, NOT BY createTask. Its dedupe compares
 * `client_id = $1`, and this task has no client — in SQL `NULL = NULL` is not
 * true, so every pass would look unique and file another task. This is exactly
 * the class of bug that only shows up in production, so it is handled rather
 * than assumed away.
 *
 * NEVER THROWS. An alert that fails must not take the drain down with it — the
 * mail is the point and the alert is the commentary.
 */
export async function alertOnFailures(db, { orgId, settings, results = [], now = null } = {}) {
  const failed = results.filter((r) => r && (r.outcome === "rejected" || r.outcome === "gave_up"));
  if (failed.length < ALERT_FAILURE_THRESHOLD) return { alerted: false, reason: "below_threshold" };

  const day = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);
  const title = `Emails are not going out (${day})`;
  const to = settings?.alert_email;
  try {
    const dup = await db.query(
      `SELECT id FROM tasks
        WHERE org_id = $1::uuid AND client_id IS NULL
          AND source_workflow = $2 AND title = $3 LIMIT 1`,
      [orgId, ALERT_WORKFLOW, title]);
    if (dup.rows[0]) return { alerted: false, reason: "already_alerted_today", taskId: dup.rows[0].id };

    const out = await createTask(db, {
      orgId,
      clientId: null,
      /* Owner, not admin. Mail failing to leave the building is a "the product
         is not working" problem, not a queue-tidying chore. */
      assigneeRole: "owner",
      sourceWorkflow: ALERT_WORKFLOW,
      title,
      /* THE DAY IS IN THE BODY TOO, and that is load-bearing rather than
         cosmetic. 006's `tasks_idempotency_idx` is unique on
         (client_id, source_workflow, body) NULLS NOT DISTINCT — so for an
         org-level task with no client, the BODY is the whole key. Two days with
         the same failure count would collide and tomorrow's outage would be
         silently swallowed as a duplicate of today's. */
      body:
        `${day}: ${failed.length} message${failed.length === 1 ? "" : "s"} could not be sent. ` +
        (to ? `Tell ${to}. ` : "No alert address is set on the Outbound Mail panel. ") +
        `Reasons: ${[...new Set(failed.map((r) => r.detail || r.outcome))].slice(0, 3).join("; ")}`,
      dedupeOn: "title"
    });
    return { alerted: out.created, reason: out.reason, taskId: out.id, failures: failed.length };
  } catch (err) {
    console.warn(`[outbox] could not file a send-failure alert for org ${orgId}: ${err.message}`);
    return { alerted: false, reason: "error", error: err.message };
  }
}

/** Every company with something waiting. Used by the scheduled sweep, which has
    no session to take an org from and must not assume the default one. */
export async function orgsWithQueuedMail(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT org_id FROM messages
      WHERE direction = 'outbound' AND status = 'queued'`);
  return rows.map((r) => r.org_id);
}

/** drainAll — every company, one pass each. The scheduled sweep's whole body. */
export async function drainAll(db, { limit = DEFAULT_BATCH, now = null } = {}) {
  const orgs = await orgsWithQueuedMail(db);
  const per = [];
  for (const orgId of orgs) {
    per.push({ orgId, ...(await drain(db, { orgId, limit, now })) });
  }
  return {
    orgs: orgs.length,
    dispatched: per.reduce((a, r) => a + (r.dispatched || 0), 0),
    sent: per.reduce((a, r) => a + (r.sent || 0), 0),
    paused: per.filter((r) => r.reason === "paused").length,
    per
  };
}
