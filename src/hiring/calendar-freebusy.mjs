// Google Calendar free/busy for hiring interview booking.
// Read-only: POST calendar/v3/freeBusy through transmit() (INTERNAL fence).
// Reuses the Workspace service account from Company Brain (domain-wide delegation).

import { fetchAccessToken } from "../company-brain/auth.mjs";
import { driveConfigFromEnv } from "../company-brain/config.mjs";
import { postJsonTo, INTERNAL } from "../lib/outbound-fetch.mjs";
import { assigneeFor } from "./owner.mjs";

export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

/** Service account JSON from GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON. OAuth is not supported. */
export function calendarConfigFromEnv(env = process.env) {
  const drive = driveConfigFromEnv(env);
  if (drive.authMode === "oauth") {
    return {
      ready: false,
      missing: ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON(service_account_required)"],
      serviceAccount: null
    };
  }
  if (!drive.ready || !drive.serviceAccount) {
    return { ready: false, missing: drive.missing, serviceAccount: null };
  }
  return { ready: true, missing: [], serviceAccount: drive.serviceAccount };
}

/** Per-request cache. Keyed by sorted emails + window. */
export function createFreeBusyCache() {
  return new Map();
}

function cacheKey(emails, timeMin, timeMax) {
  return `${[...emails].sort().join(",")}|${timeMin}|${timeMax}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Resolve the Workspace calendar id (email) to query for a host.
 * Explicit hostStaffId wins; otherwise assigneeFor's named person.
 */
export async function calendarEmailFor(tx, { orgId, roleKey, hostStaffId = null } = {}) {
  if (hostStaffId) {
    const { rows } = await tx.query(
      `SELECT email FROM staff WHERE id = $1 AND org_id = $2`, [hostStaffId, orgId]);
    const email = normalizeEmail(rows[0]?.email);
    return email || null;
  }
  const assignee = await assigneeFor(tx, { orgId, roleKey });
  if (!assignee.assigneeStaffId) return null;
  const { rows } = await tx.query(
    `SELECT email FROM staff WHERE id = $1`, [assignee.assigneeStaffId]);
  return normalizeEmail(rows[0]?.email) || null;
}

/**
 * POST freeBusy for one or more calendar ids. Returns { ok, unreadable, calendars?, error? }.
 * Never throws — callers fail closed on !ok.
 */
export async function queryFreeBusy({
  emails,
  timeMin,
  timeMax,
  env = process.env,
  fetchImpl,
  cache = null
} = {}) {
  const list = [...new Set(
    (Array.isArray(emails) ? emails : [emails])
      .map(normalizeEmail)
      .filter(Boolean)
  )];
  if (!list.length) {
    return { ok: false, unreadable: true, error: "no_calendar_email" };
  }

  const cfg = calendarConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      unreadable: true,
      error: `not_configured:${cfg.missing.join(",")}`
    };
  }

  const key = cacheKey(list, timeMin, timeMax);
  if (cache?.has(key)) return cache.get(key);

  let token;
  try {
    token = await fetchAccessToken({
      clientEmail: cfg.serviceAccount.clientEmail,
      privateKey: cfg.serviceAccount.privateKey,
      delegateEmail: list[0],
      scope: CALENDAR_READONLY_SCOPE,
      fetchImpl
    });
  } catch (err) {
    const out = { ok: false, unreadable: true, error: `token:${(err && err.message) || err}` };
    cache?.set(key, out);
    return out;
  }

  const res = await postJsonTo(CALENDAR_FREEBUSY_URL, {
    headers: { authorization: `Bearer ${token.accessToken}` },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: "UTC",
      items: list.map((id) => ({ id }))
    }),
    fetchImpl,
    fence: INTERNAL,
    what: "google calendar freeBusy",
    env
  });

  if (!res.ok || res.blocked) {
    const out = {
      ok: false,
      unreadable: true,
      error: res.blocked ? `blocked:${res.error}` : `http_${res.status}:${res.error || "failed"}`
    };
    cache?.set(key, out);
    return out;
  }

  const out = { ok: true, unreadable: false, calendars: res.body?.calendars || {} };
  cache?.set(key, out);
  return out;
}

/**
 * True when the host's primary calendar has no busy block overlapping [startsAt, startsAt+duration).
 * Fail closed: unreadable → clear:false.
 */
export async function hostCalendarClear({
  hostEmail,
  startsAt,
  durationMin,
  env = process.env,
  fetchImpl,
  cache = null
} = {}) {
  const email = normalizeEmail(hostEmail);
  if (!email) {
    return { clear: false, unreadable: true, reason: "no_calendar_email" };
  }

  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return { clear: false, unreadable: true, reason: "bad_time" };
  }
  const duration = Number(durationMin);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { clear: false, unreadable: true, reason: "bad_duration" };
  }

  const end = new Date(start.getTime() + duration * 60_000);
  const fb = await queryFreeBusy({
    emails: [email],
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    env,
    fetchImpl,
    cache
  });

  if (!fb.ok) {
    return { clear: false, unreadable: true, reason: fb.error };
  }

  const cal = fb.calendars[email] || fb.calendars[hostEmail];
  if (!cal) {
    return { clear: false, unreadable: true, reason: "calendar_missing_from_response" };
  }
  if (cal.errors?.length) {
    return {
      clear: false,
      unreadable: true,
      reason: cal.errors.map((e) => e.reason || "error").join(",")
    };
  }

  const busy = cal.busy || [];
  return { clear: busy.length === 0, unreadable: false, busy };
}

export default {
  CALENDAR_READONLY_SCOPE,
  CALENDAR_FREEBUSY_URL,
  calendarConfigFromEnv,
  createFreeBusyCache,
  calendarEmailFor,
  queryFreeBusy,
  hostCalendarClear
};
