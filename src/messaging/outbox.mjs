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

import { dispatchDue, DEFAULT_BATCH } from "./dispatch.mjs";

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
       count(*) FILTER (WHERE status = 'sent'
                          AND created_at >= date_trunc('day', COALESCE($2::timestamptz, now())))
                                                                                     ::int AS sent_today,
       max(last_attempt_at)                                                                AS last_attempt
       FROM messages
      WHERE org_id = $1::uuid AND direction = 'outbound'`,
    [orgId, now]);
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
        WHERE org_id = $1::uuid AND direction = 'outbound' AND status = 'sent'
          AND created_at >= date_trunc('day', COALESCE($2::timestamptz, now()))`,
      [orgId, now]);
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
    return {
      ran: true,
      reason: null,
      dispatched: Array.isArray(results) ? results.length : 0,
      sent: Array.isArray(results) ? results.filter((r) => r.outcome === "sent").length : 0,
      blocked: Array.isArray(results) ? results.filter((r) => r.outcome === "blocked").length : 0,
      results
    };
  } catch (err) {
    console.warn(`[outbox] drain failed for org ${orgId}: ${err.message}`);
    return { ran: false, reason: "error", error: err.message, dispatched: 0, results: [] };
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
