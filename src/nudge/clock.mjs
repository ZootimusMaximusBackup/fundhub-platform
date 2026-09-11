// The client's own clock — what time it is where they are, and what day.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Quiet hours on client-facing
// messaging. Nothing here sends.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY NOT JUST REUSE THE DISPATCHER'S QUIET HOURS
//
// The dispatcher already holds texts overnight, and it does it in
// America/Phoenix (src/messaging/gate.mjs QUIET_HOURS_TZ) — OUR clock, one zone
// for everyone. That is the right call for a queue drain: it is a single
// company-wide window, it is easy to reason about, and it defers rather than
// dropping.
//
// It is not enough here, for one reason. The dispatcher's window is measured
// where WE are. A client in Honolulu is three hours behind Phoenix, so a text
// released at 08:00 Phoenix reaches them at 05:00. The spec's words are "no
// client-facing message outside daytime in the CLIENT'S OWN timezone", so this
// module measures the same 08:00-20:00 window in THEIR zone and the runner
// declines to queue anything outside it.
//
// The two are layers, not rivals, and they compose in the safe direction: this
// one decides whether a message may be WRITTEN, the dispatcher's decides
// whether a written one may go out tonight. A message has to clear both.
//
// THE WINDOW ITSELF IS IMPORTED, NOT RESTATED. QUIET_START_HOUR and
// QUIET_END_HOUR come from gate.mjs. A second copy of "8" and "20" in this repo
// is a second thing to change when the owner moves the window, and the copy
// nobody remembers is the one that texts somebody at 6am.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE A CLIENT'S TIMEZONE ACTUALLY LIVES, AND WHAT WE DO WHEN IT DOES NOT
//
// MEASURED, not assumed: `clients` has no timezone column. Its columns are
// listed in db/schema/001_init.sql — id, org_id, ghl_contact_id,
// client_master_key, first_name, last_name, email, phone, custom_fields, and
// the outcome/consent fields. No zone anywhere.
//
// The zone that does exist is in `custom_fields`, the jsonb holding the 252
// ported CRM fields, and src/workflows/messaging.mjs already reads it there
// (resolveAppointmentTimeZone: contact.timezone / time_zone / tz / tzid). This
// module reads the same four keys off the same jsonb, so the nudge window and
// the appointment merge tag can never disagree about where somebody is.
//
// WHEN IT IS ABSENT WE FALL BACK TO America/Phoenix AND SAY SO. That is not a
// guess about the client — it is the company clock, the same one the dispatcher
// has always used, and the row in waypoint_nudges records which zone was
// actually applied so an odd local hour can be explained afterwards rather than
// reconstructed. Inventing a zone from an area code was considered and refused:
// a phone number's area code has not indicated where somebody lives since
// number portability, and a wrong zone is worse than the company one because it
// looks authoritative.

import { QUIET_START_HOUR, QUIET_END_HOUR, QUIET_HOURS_TZ } from "../messaging/gate.mjs";

/** The company clock, used when the client's own is unknown. */
export const FALLBACK_TZ = QUIET_HOURS_TZ;

/** The keys custom_fields is known to carry a zone under. Same four
    src/workflows/messaging.mjs reads, in the same order. */
export const TZ_KEYS = Object.freeze(["timezone", "time_zone", "tz", "tzid"]);

/** isUsableZone — does the operating system's timezone database know it?
    A typo ("Amerika/Phoenix") must not become a thrown error deep inside a
    sweep; it becomes the fallback, and the fallback is recorded. */
export function isUsableZone(zone) {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * zoneForClient(client) → { zone, known }
 *
 * `known:false` means we are using the company clock because the client's own
 * is missing or unreadable. The caller stores the zone it used either way.
 */
export function zoneForClient(client = {}) {
  const cf = client.custom_fields || {};
  for (const key of TZ_KEYS) {
    const candidate = cf[key];
    if (isUsableZone(candidate)) return { zone: String(candidate).trim(), known: true };
  }
  return { zone: FALLBACK_TZ, known: false };
}

/** hourIn(date, zone) → 0-23 wall-clock hour there. Throws only if the zone is
    unusable, which zoneForClient has already ruled out. */
export function hourIn(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "numeric", hour12: false
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  if (!Number.isInteger(hour)) {
    throw new Error(`hourIn: could not read the hour in ${zone}`);
  }
  return hour % 24;
}

/**
 * isDaytime(date, zone) → true inside [QUIET_END_HOUR, QUIET_START_HOUR) local.
 * With the current constants that is 08:00 up to but not including 20:00.
 *
 * An unreadable clock returns FALSE — not daytime. When we cannot tell what
 * time it is where somebody's phone is, the answer is not to text them.
 */
export function isDaytime(date, zone) {
  let hour;
  try {
    hour = hourIn(date, zone);
  } catch {
    return false;
  }
  return hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR;
}

/**
 * localDate(date, zone) → 'YYYY-MM-DD' as read on the wall in that zone.
 *
 * This string is what goes into waypoint_nudges.client_local_date, and it is
 * therefore what the one-message-per-client-per-day cap is measured in. Their
 * day, not ours: a client in Auckland and a client in Los Angeles roll over at
 * different instants and each gets one message per their own calendar day.
 *
 * en-CA is used only because its short date format is already ISO order; the
 * parts are read individually rather than trusting the joined string.
 */
export function localDate(date, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export { QUIET_START_HOUR, QUIET_END_HOUR };
export default { FALLBACK_TZ, TZ_KEYS, isUsableZone, zoneForClient, hourIn, isDaytime, localDate };
