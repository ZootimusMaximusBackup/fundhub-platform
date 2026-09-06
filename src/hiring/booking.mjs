// Booking an interview — the step the hiring pipeline never had.
//
// 051_hiring.sql shipped `hiring_interviews` with everything an interview needs:
// scheduled_for, duration_min, meeting_url, host_staff_id, and a status that
// defaults to 'scheduled'. Nothing ever wrote one. Before this file, the ONLY
// `INSERT INTO hiring_interviews` in the whole repo was inside
// src/hiring/hiring.pg.test.mjs — the table was furniture for a test, and a
// candidate who cleared screening had no way to get onto anybody's calendar.
//
// ══════════════════════════════════════════════════════════════════════════════
// WHAT "IS THE HOST FREE?" ACTUALLY MEANS HERE. READ IT BEFORE YOU TRUST IT.
//
// Measured across this repo on 2026-09-05: THERE IS NO STAFF AVAILABILITY MODEL.
// Not a thin one — none.
//
//   * `bookings` (db/migrations/225_bookings.sql) has NO staff column. Not a
//     host, not an owner, not an assignee, and no later migration adds one. The
//     only person on a booking row is the ATTENDEE — the client — by name and
//     email. src/bookings/store.mjs can filter by org, date range, client and
//     status, and there is no staff filter it could grow, because there is no
//     column to filter on. A sales call sitting on a closer's Tuesday is
//     therefore invisible to any question about that closer's Tuesday.
//   * `shifts` (db/schema/001_init.sql) is a punch card: started_at, ended_at,
//     one open row per person. public/app/calendar.html uses it for exactly what
//     it is — a "who is clocked in right now" strip. It says nothing about 2pm
//     on Thursday.
//   * There is no working-hours table, no time-off table, no availability table
//     anywhere in db/, src/, api/ or public/.
//   * The real calendar is OUTSIDE this repo. The public booking page is a
//     ClickFunnels page driven by Cronofy (225's header, measured on the live
//     database: 27 of 31 bookings are 'clickfunnels', ZERO are Cal.com despite
//     the code calling everything "calcom"). src/adapters/clickfunnels.mjs is
//     receive-only — it verifies a webhook signature and emits an event, and it
//     contains no outbound fetch at all. This system has only ever been TOLD
//     what got booked. It has never asked a calendar what is free, and it holds
//     no credential with which to ask.
//
// So the check below is a DOUBLE-BOOKING check over interviews, not a free/busy
// check over a person's day. It is real and it stops the mistake that actually
// happens — a coordinator putting the same host in two rooms at once — and it is
// blind to everything in HOST_BLIND_SPOTS. Callers get that list back rather
// than having to know it.
//
// Nothing here invents availability. There is no generated 9-to-5, no assumed
// lunch break, no default working week. A slot this module offers is a session a
// host has already committed to (see listOpenInterviews) or a time a human
// picked. Inventing the rest would put candidates on calls nobody attends.
// ══════════════════════════════════════════════════════════════════════════════
//
// THE RACE IS THE DATABASE'S PROBLEM, NOT THIS FILE'S. A select-then-insert
// check in JavaScript loses every time two people book the same host in the same
// second. db/migrations/296_hiring_booking.sql carries an exclusion constraint —
// one host, one scheduled interview, no overlap — so the guarantee is a property
// of the table. The pre-check here exists to produce a readable error with the
// clashing interview named; when it loses the race, the constraint fires and
// that error is translated rather than leaked.

import { ownerFor } from "./owner.mjs";
import { advance, STAGES } from "./pipeline.mjs";
import { createFreeBusyCache, hostCalendarClear } from "./calendar-freebusy.mjs";

/* What a "the host is free" answer from this module does NOT cover. Exported so
   an endpoint or a screen can show it instead of implying a completeness this
   system does not have. */
export const HOST_BLIND_SPOTS = Object.freeze([
  "client sales calls — `bookings` records the attendee, never the staff member, so no booking can be attributed to a host",
  "working hours and time off — no table in this system stores either",
  "calendar events outside the host's Google Workspace primary calendar (other providers, shared calendars we do not query)",
  "anything outside `hiring_interviews` with status='scheduled' that never landed on the host's Google Calendar"
]);

/* The default interview length, mirroring hiring_interviews.duration_min's
   column default in 051 and doc 11's "Book a 1 hour call slot - plan to wrap
   within 45 minutes".

   IT IS WRITTEN IN TWO PLACES, so a test pins them together:
   booking.pg.test.mjs reads the column default out of the catalog and asserts it
   equals this number. Two copies that can drift silently is how a pre-check
   starts guarding a different window than the constraint. */
export const DEFAULT_DURATION_MIN = 60;

/* Which pipeline stage each kind of interview belongs to. 051's stage keys. */
const STAGE_FOR_KIND = Object.freeze({
  group: "group_interview",
  one_on_one: "one_on_one"
});

const KINDS = Object.freeze(Object.keys(STAGE_FOR_KIND));

/* BookingError — a domain failure carrying a machine-readable code and the HTTP
   status it should surface as, the same shape src/bookings/store.mjs uses so an
   endpoint's catch block maps `.status` straight onto the response.

   The code matters more than the message here: "no host" and "host busy" are
   different problems with different fixes, and a screen has to tell them apart
   without matching on English. */
export class BookingError extends Error {
  constructor(message, { code = "BOOKING_FAILED", status = 400, detail = null } = {}) {
    super(message);
    this.name = "BookingError";
    this.code = code;
    this.status = status;
    if (detail) this.detail = detail;
  }
}

function toTime(v, field) {
  if (v === undefined || v === null || v === "") {
    throw new BookingError(`${field} is required`, { code: "BAD_TIME" });
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BookingError(`${field} could not be read as a time`, { code: "BAD_TIME" });
  }
  return d;
}

/* hostConflicts(tx, spec) → the scheduled interviews this host already has that
   overlap the window.

   '[)' matching, the same bound the exclusion constraint uses: a 10:00-11:00 and
   an 11:00-12:00 interview do not clash. Back-to-back is how a group-interview
   day is run.

   excludeInterviewId lets a reschedule ignore the row it is moving. */
export async function hostConflicts(tx, {
  hostStaffId, startsAt, durationMin = DEFAULT_DURATION_MIN, excludeInterviewId = null
} = {}) {
  if (!hostStaffId) throw new BookingError("hostConflicts: hostStaffId is required");
  const start = toTime(startsAt, "hostConflicts: startsAt");

  const { rows } = await tx.query(
    `SELECT i.id, i.kind, i.scheduled_for, i.ends_at, i.duration_min, i.status,
            i.meeting_url, r.key AS role_key
       FROM hiring_interviews i
       LEFT JOIN hiring_roles r ON r.id = i.role_id
      WHERE i.host_staff_id = $1
        AND i.status = 'scheduled'
        AND i.scheduled_for IS NOT NULL
        AND i.ends_at IS NOT NULL
        AND ($4::uuid IS NULL OR i.id <> $4)
        AND tstzrange(i.scheduled_for, i.ends_at, '[)')
            && tstzrange($2::timestamptz, $2::timestamptz + make_interval(mins => $3), '[)')
      ORDER BY i.scheduled_for ASC`,
    [hostStaffId, start.toISOString(), durationMin, excludeInterviewId]);

  return rows;
}

/* listOpenInterviews(tx, spec) → the sessions a candidate could actually join.
 *
 * *** THIS IS THE ONLY HONEST "AVAILABLE SLOTS" THIS SYSTEM CAN PRODUCE. ***
 *
 * A slot here is not a guess at when someone might be free. It is a session a
 * host has ALREADY put on the calendar — a real row, with a real host and a real
 * time. That is what doc 11's group-interview day looks like in practice: the
 * coordinator schedules the sessions, and candidates pick one.
 *
 * There is deliberately no function beside this one that generates candidate
 * slots from working hours, because this system does not know anybody's working
 * hours (see the header). A slot generator would have to invent them.
 *
 * roleKey narrows to sessions for that req PLUS sessions tied to no req at all,
 * which is the same rule joinInterview enforces — a general session is joinable
 * by anyone, a req's session is not.
 */
export async function listOpenInterviews(tx, {
  orgId, kind = null, roleKey = null, from = null, to = null, limit = 50, now = null
} = {}) {
  if (!orgId) throw new BookingError("listOpenInterviews: orgId is required");
  if (kind && !KINDS.includes(kind)) {
    throw new BookingError(`listOpenInterviews: unknown kind "${kind}"`, { code: "BAD_KIND" });
  }

  /* Default lower bound is "now": a session that already started is not a slot.
     Injectable so a test does not depend on the wall clock. */
  const lower = from ? toTime(from, "listOpenInterviews: from") : (now ? toTime(now, "now") : new Date());
  const upper = to ? toTime(to, "listOpenInterviews: to") : null;

  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 50;

  const { rows } = await tx.query(
    `SELECT i.id, i.kind, i.scheduled_for, i.ends_at, i.duration_min,
            i.meeting_url, i.host_staff_id, s.name AS host_name,
            i.role_id, r.key AS role_key, r.name AS role_name,
            (SELECT count(*)::int FROM hiring_interview_attendees a
              WHERE a.interview_id = i.id) AS attendee_count
       FROM hiring_interviews i
       LEFT JOIN staff s        ON s.id = i.host_staff_id
       LEFT JOIN hiring_roles r ON r.id = i.role_id
      WHERE i.org_id = $1
        AND i.status = 'scheduled'
        AND i.scheduled_for IS NOT NULL
        AND i.scheduled_for >= $2::timestamptz
        AND ($3::timestamptz IS NULL OR i.scheduled_for <= $3)
        AND ($4::text IS NULL OR i.kind = $4)
        AND ($5::text IS NULL OR r.key = $5 OR i.role_id IS NULL)
      ORDER BY i.scheduled_for ASC
      LIMIT $6`,
    [orgId, lower.toISOString(), upper ? upper.toISOString() : null,
     kind, roleKey ? String(roleKey).trim().toLowerCase() : null, capped]);

  return rows;
}

/* bookInterview(tx, spec) → { interview, attendee, host, advanced, blindSpots }
 *
 * The whole path: find the application, work out who hosts, work out the join
 * link, check the host is free, write the interview, put the candidate on it,
 * and move the application into the matching stage.
 *
 * Required: orgId, applicationId, kind, startsAt.
 * Optional: durationMin, hostStaffId, meetingUrl, notes, advanceStage, now.
 *
 * REFUSALS, and each one is a gap being reported rather than papered over:
 *   NO_HOST         nobody is NAMED for this req. ownerFor resolves a queue
 *                   ('sales_manager', 'owner') when no individual is set, and a
 *                   queue cannot sit on a Zoom call. The fix is in the message.
 *   NO_MEETING_URL  the host has no standing room and none was passed. 051 quotes
 *                   doc 11: "BE SURE THE ZOOM LINK IS IN THE CALENDAR INVITE".
 *                   This repo has no Zoom/Meet integration, so a link is typed in
 *                   by a human or it does not exist. It is never generated.
 *   HOST_BUSY       the host already has an interview in that window.
 *   BAD_TIME        no time, an unreadable time, or a time in the past.
 *
 * THIS BOOKS. IT DOES NOT DECIDE. Booking is not an adverse action, so no
 * decided_by is required — but nothing here rejects, ranks or declines anybody
 * either, and a refusal above is a refusal to BOOK, never a refusal of the
 * candidate. 051's invariant is untouched: no candidate is ever rejected by
 * software.
 */
export async function bookInterview(tx, {
  orgId, applicationId, kind, startsAt,
  durationMin = DEFAULT_DURATION_MIN,
  hostStaffId = null, meetingUrl = null, notes = null,
  advanceStage = true, now = null,
  env = process.env, fetchImpl, freeBusyCache = null
} = {}) {
  if (!orgId) throw new BookingError("bookInterview: orgId is required");
  if (!applicationId) throw new BookingError("bookInterview: applicationId is required");
  if (!KINDS.includes(kind)) {
    throw new BookingError(
      `bookInterview: kind must be one of ${KINDS.join(", ")}`, { code: "BAD_KIND" });
  }

  const duration = Number(durationMin);
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new BookingError("bookInterview: durationMin must be a positive whole number of minutes",
      { code: "BAD_DURATION" });
  }

  const start = toTime(startsAt, "bookInterview: startsAt");
  const clock = now ? toTime(now, "bookInterview: now") : new Date();
  if (start.getTime() < clock.getTime()) {
    throw new BookingError(
      "bookInterview: that time has already passed. To record an interview that already " +
      "happened, use recordGroupInterview — booking is for the future.",
      { code: "BAD_TIME" });
  }

  const app = await loadOpenApplication(tx, { orgId, applicationId });
  const host = await resolveHost(tx, { orgId, roleKey: app.role_key, hostStaffId });
  const link = await resolveMeetingUrl(tx, { host, meetingUrl });

  /* Pre-check for a readable error. The constraint below is the guarantee — see
     the header — and this is the part that can name what clashed. */
  const clashes = await hostConflicts(tx, {
    hostStaffId: host.staffId, startsAt: start, durationMin: duration
  });
  if (clashes.length) {
    throw hostBusy(host, clashes);
  }

  const cache = freeBusyCache || createFreeBusyCache();
  const cal = await hostCalendarClear({
    hostEmail: host.email,
    startsAt: start,
    durationMin: duration,
    env,
    fetchImpl,
    cache
  });
  if (cal.unreadable) {
    throw new BookingError(
      "bookInterview: the host's calendar could not be read, so this time cannot be offered. " +
      (cal.reason ? `(${cal.reason})` : ""),
      { code: "CALENDAR_UNREADABLE", status: 503 });
  }
  if (!cal.clear) {
    throw new BookingError(
      `${host.name || "That host"} has something on their calendar then. Pick another time.`,
      { code: "HOST_BUSY", status: 409, detail: { calendarBusy: cal.busy } });
  }

  let interview;
  try {
    interview = (await tx.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url,
          host_staff_id, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)
       RETURNING *`,
      [orgId, app.role_id, kind, start.toISOString(), duration, link,
       host.staffId, notes])).rows[0];
  } catch (err) {
    /* 23P01 is exclusion_violation. Reaching it means the pre-check passed and
       somebody else booked this host in the gap between the two statements —
       which is the entire reason the constraint exists. The conflicting rows are
       NOT re-queried: inside a transaction this statement's error has already
       aborted it, and a SAVEPOINT dance to read them back would make this module
       refuse to run on a plain pool, which is how the rest of src/hiring is
       called. The message says what happened instead of guessing what won. */
    if (err && err.code === "23P01") {
      throw new BookingError(
        `${host.name || "That host"} was booked for another interview in the same moment. ` +
        "Nothing was saved. Pick another time and try again.",
        { code: "HOST_BUSY", status: 409 });
    }
    throw err;
  }

  const attendee = (await tx.query(
    `INSERT INTO hiring_interview_attendees (org_id, interview_id, application_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (interview_id, application_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [orgId, interview.id, applicationId])).rows[0];

  const advanced = advanceStage
    ? await advanceToInterviewStage(tx, { orgId, app, kind })
    : null;

  return { interview, attendee, host, advanced, blindSpots: HOST_BLIND_SPOTS };
}

/* joinInterview(tx, spec) → { interview, attendee, advanced, blindSpots }
 *
 * The candidate-picks-a-slot path, where the slot is a session that already
 * exists — the rows listOpenInterviews returns. The host's time is already
 * committed, so there is nothing to free/busy check; what IS checked is that the
 * session is still open, still in the future, and belongs to this req.
 *
 * Idempotent: joining twice leaves one attendee row.
 *
 * NO SEAT LIMIT IS ENFORCED, and none is invented. 051 has no capacity column
 * and doc 11 names no maximum, so a cap would be a number this code made up.
 * attendee_count comes back from listOpenInterviews so a human can see the size
 * of a session and decide.
 */
export async function joinInterview(tx, {
  orgId, applicationId, interviewId, advanceStage = true, now = null
} = {}) {
  if (!orgId) throw new BookingError("joinInterview: orgId is required");
  if (!interviewId) throw new BookingError("joinInterview: interviewId is required");

  const app = await loadOpenApplication(tx, { orgId, applicationId });

  const interview = (await tx.query(
    `SELECT i.*, s.name AS host_name
       FROM hiring_interviews i
       LEFT JOIN staff s ON s.id = i.host_staff_id
      WHERE i.id = $1 AND i.org_id = $2`,
    [interviewId, orgId])).rows[0];
  if (!interview) {
    throw new BookingError("joinInterview: no such interview", { code: "NOT_FOUND", status: 404 });
  }
  if (interview.status !== "scheduled") {
    throw new BookingError(
      `joinInterview: that session is ${interview.status}, not scheduled`,
      { code: "NOT_SCHEDULED", status: 409 });
  }
  if (!interview.scheduled_for) {
    throw new BookingError(
      "joinInterview: that session has no time on it yet, so there is nothing to join",
      { code: "BAD_TIME", status: 409 });
  }
  const clock = now ? toTime(now, "joinInterview: now") : new Date();
  if (new Date(interview.scheduled_for).getTime() < clock.getTime()) {
    throw new BookingError("joinInterview: that session has already started",
      { code: "BAD_TIME", status: 409 });
  }
  /* A session tied to a req is for that req's candidates. A session tied to no
     req (role_id NULL, which 051 allows) is general and anyone may join it. */
  if (interview.role_id && interview.role_id !== app.role_id) {
    throw new BookingError(
      "joinInterview: that session is for a different job",
      { code: "WRONG_ROLE", status: 409 });
  }

  const attendee = (await tx.query(
    `INSERT INTO hiring_interview_attendees (org_id, interview_id, application_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (interview_id, application_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [orgId, interview.id, applicationId])).rows[0];

  const advanced = advanceStage
    ? await advanceToInterviewStage(tx, { orgId, app, kind: interview.kind })
    : null;

  return { interview, attendee, advanced, blindSpots: HOST_BLIND_SPOTS };
}

/* ------------------------------------------------------------------ internals */

/* The application, with its role, locked for the length of the transaction so
   two bookings for one candidate take turns. Refuses anything not open — a
   hired, rejected or withdrawn application must not gain a new interview. */
async function loadOpenApplication(tx, { orgId, applicationId }) {
  if (!applicationId) throw new BookingError("applicationId is required");
  const { rows } = await tx.query(
    `SELECT a.id, a.org_id, a.role_id, a.status, a.candidate_id,
            r.key AS role_key, s.key AS stage_key
       FROM candidate_applications a
       JOIN hiring_roles r    ON r.id = a.role_id
       JOIN pipeline_stages s ON s.id = a.stage_id
      WHERE a.id = $1 AND a.org_id = $2
      FOR UPDATE OF a`,
    [applicationId, orgId]);
  const app = rows[0];
  if (!app) {
    throw new BookingError("no such application", { code: "NOT_FOUND", status: 404 });
  }
  if (app.status !== "open") {
    throw new BookingError(
      `that application is ${app.status}, not open — it cannot be booked for an interview`,
      { code: "NOT_OPEN", status: 409 });
  }
  return app;
}

/* WHO HOSTS. An explicit id wins; otherwise the req's owner, and ONLY when that
   resolves to a named individual.

   ownerFor answers with a QUEUE ('sales_manager', 'owner') whenever no
   hiring_manager_staff_id is set — correct for routing a task, useless for
   hosting a call, because a queue cannot join a Zoom room. So this refuses and
   says exactly which field to fill rather than picking somebody with the right
   job title, which would put a candidate in front of a person who never agreed
   to be there. */
async function resolveHost(tx, { orgId, roleKey, hostStaffId }) {
  if (hostStaffId) {
    const { rows } = await tx.query(
      `SELECT id, name, email, status, active, meeting_url FROM staff
        WHERE id = $1 AND org_id = $2`, [hostStaffId, orgId]);
    const s = rows[0];
    if (!s) {
      throw new BookingError("bookInterview: that host is not on staff here",
        { code: "NO_HOST", status: 404 });
    }
    if (!s.active || s.status !== "active") {
      throw new BookingError(
        `bookInterview: ${s.name} cannot host — that account is ${s.active ? s.status : "inactive"}`,
        { code: "NO_HOST", status: 409 });
    }
    return {
      staffId: s.id, name: s.name, email: s.email, meetingUrl: s.meeting_url, source: "explicit"
    };
  }

  const owner = await ownerFor(tx, { orgId, roleKey });
  if (owner.source !== "person" || !owner.staffId) {
    throw new BookingError(
      `bookInterview: nobody is named to host interviews for "${roleKey}". ` +
      `The routing rule sends this req's work to the ${owner.role} queue, and a queue ` +
      "cannot sit on a call. Set hiring_roles.hiring_manager_staff_id for this req, " +
      "or pass hostStaffId.",
      { code: "NO_HOST", status: 409, detail: { roleKey, ownerRole: owner.role } });
  }

  const { rows } = await tx.query(
    `SELECT id, name, email, meeting_url FROM staff WHERE id = $1`, [owner.staffId]);
  const s = rows[0];
  return {
    staffId: s.id, name: s.name, email: s.email, meetingUrl: s.meeting_url, source: owner.source
  };
}

/* THE JOIN LINK IS NEVER GENERATED. There is no Zoom, Meet or Whereby
   integration in this repo — nothing here can mint a room. So the link is the
   one passed in, or the host's standing room (staff.meeting_url, added by
   296 and typed in by a human), or the booking does not happen.

   public/app/hiring.html currently shows hardcoded us02web.zoom.us room numbers
   against staff names in a mock data block. Those are mockup furniture. They are
   not read here and they are not seeded anywhere. */
async function resolveMeetingUrl(tx, { host, meetingUrl }) {
  const explicit = meetingUrl == null ? "" : String(meetingUrl).trim();
  if (explicit) return explicit;

  const standing = host.meetingUrl == null ? "" : String(host.meetingUrl).trim();
  if (standing) return standing;

  throw new BookingError(
    `bookInterview: ${host.name || "that host"} has no meeting room set, and no link was ` +
    "given. An interview with no join link is a no-show waiting to happen, and this system " +
    "has no way to create a room. Set that person's meeting room on Staff & Teams " +
    "(staff.meeting_url), or pass meetingUrl.",
    { code: "NO_MEETING_URL", status: 409, detail: { staffId: host.staffId } });
}

/* Moving the application into the interview's stage — FORWARD ONLY.
 *
 * pipeline.mjs's advance() notes that "a scheduling job legitimately moves a
 * batch into group_interview", which is this. decidedBy stays null because
 * advancing is not an adverse action and needs no human gate.
 *
 * A candidate already at or past that stage is NOT moved: booking a second 1:1
 * for someone already at 1:1 must not write a redundant decision row, and
 * booking a group session for someone already at offer must never drag them
 * backwards. Both would corrupt the record an adverse-impact review reads. */
async function advanceToInterviewStage(tx, { orgId, app, kind }) {
  const target = STAGE_FOR_KIND[kind];
  if (!target) return null;

  const here = STAGES.indexOf(app.stage_key);
  const there = STAGES.indexOf(target);
  // A stage outside the forward funnel (rejected/withdrawn) reads as -1. An open
  // application should never be sitting in one, and if it is, moving it is not
  // this module's call.
  if (here < 0 || there < 0 || there <= here) return null;

  const moved = await advance(tx, {
    orgId,
    applicationId: app.id,
    toStageKey: target,
    reason: `interview booked (${kind})`
  });
  return { fromStageKey: app.stage_key, toStageKey: target, decisionId: moved.decision.id };
}

function hostBusy(host, clashes) {
  const first = clashes[0];
  return new BookingError(
    `${host.name || "That host"} already has an interview then ` +
    `(${new Date(first.scheduled_for).toISOString()}). Pick another time.`,
    { code: "HOST_BUSY", status: 409, detail: { conflicts: clashes } });
}

export default {
  bookInterview,
  joinInterview,
  listOpenInterviews,
  hostConflicts,
  HOST_BLIND_SPOTS,
  DEFAULT_DURATION_MIN,
  BookingError
};
