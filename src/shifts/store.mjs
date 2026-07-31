// Shifts — clock-in / clock-out, the writer for a table that has never had one.
//
// `shifts` and `staff_events` have existed since 001_init.sql. Nothing wrote to
// either. This module is the write path behind the clock-in control; the HTTP
// endpoint, the middleware that keeps a shift alive, and the telemetry writer
// that fills `staff_events` for ordinary work all live elsewhere and call in
// here.
//
// THE COLUMNS ARE started_at / ended_at. Not clock_in_at / clock_out_at. Every
// statement below uses the real names; a shift is "open" iff ended_at IS NULL,
// which is also the predicate on both indexes.
//
// *** ONE OPEN SHIFT PER STAFF MEMBER IS A DATABASE FACT, NOT A JAVASCRIPT ONE. ***
// It is enforced by `uq_shifts_one_open` (db/migrations/060_shifts_one_open.sql).
// The pre-existing `idx_shifts_open` was believed to enforce it and does not —
// it is a plain partial index, and the plan that said otherwise was reading the
// name. clockIn() therefore does NOT do a check-then-insert. It inserts, and
// lets the index be the arbiter, because the whole failure mode here is two
// requests racing (double-tapped button, retried timeout, second browser tab)
// and a SELECT-then-INSERT has a window between the two statements that no
// amount of application care can close. What it does instead is translate the
// unique_violation into the 409 the caller deserves, so a race reads as
// "you are already clocked in" rather than a 500.
//
// NOTHING HERE COMPUTES HOURS. No duration column, no daily total, no rounding
// to the nearest quarter hour. Hours are a function of (started_at, ended_at)
// and belong to whatever reads them; storing a second answer would let the two
// disagree, and the one people are paid against must not be the derived copy.
//
// NOTHING HERE EMITS A BUS EVENT. There is no canonical event for a staff
// member starting or ending a shift, and per the repo convention names are not
// added to src/events/canonical.mjs unilaterally. See src/auth/PROPOSED-EVENTS.md,
// which reaches the same conclusion from the auth side and notes specifically
// that a login is NOT a clock-in. The functions below take `db` and write
// tables directly, exactly as src/auth/ does.

/**
 * ShiftError — a domain failure with the HTTP status it should surface as.
 * Same shape as InquiryWriteError (src/inquiries/work.mjs): a message, a name,
 * and a `.status` an endpoint's catch block maps straight onto the response.
 * 400 by default, because the common case is a caller that left out an id.
 */
export class ShiftError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "ShiftError";
    this.status = status;
  }
}

/**
 * STALE_SHIFT_HOURS — *** POLICY. 12 HOURS. ***
 *
 * autoCloseStale() needs to know how long an open shift may sit before it is
 * treated as forgotten rather than in progress. That number is an operator
 * decision about how this desk works — a 24/7 rota, an overnight processing
 * shift and a 9-to-5 want different answers — and it used to have no source
 * anywhere in this repository, so it was carried here as a flagged placeholder.
 *
 * IT HAS A SOURCE NOW. The owner set the stale-shift threshold at 12 hours on
 * 2026-07-31. That decision is what this constant holds, and this comment is
 * where it is written down; there is no other record of it in the schema, in
 * src/config/ or in any doc on disk. Changing the number means changing the
 * policy, which is the owner's call and not a refactor.
 *
 * It stays a parameter on autoCloseStale() so a caller with a different desk
 * can pass its own threshold, but the default is now a decided rule rather than
 * a guess, and a call site that takes the default is applying the 12-hour
 * policy on purpose.
 */
export const STALE_SHIFT_HOURS = 12;

/**
 * AUTO_CLOSE_EVENT_KIND — the `staff_events.kind` written when the sweep closes
 * a shift. `kind` is free text (001_init.sql documents examples, there is no
 * catalog and no CHECK), so this token is new. It lives in one exported
 * constant so a reader querying for these rows and the writer producing them
 * cannot drift apart on a spelling.
 */
export const AUTO_CLOSE_EVENT_KIND = "shift_auto_closed";

function requireId(value, field) {
  if (!value) throw new ShiftError(`${field} is required`);
  return value;
}

/* A unique_violation on `shifts` can only be uq_shifts_one_open: the sole other
   unique constraint on the table is the gen_random_uuid() primary key. Matching
   on the SQLSTATE rather than on the constraint name means an index created
   under a different name (a hand-applied environment, a future rename) still
   produces the 409 instead of a 500. */
const isUniqueViolation = (e) => e?.code === "23505";

/**
 * clockIn(db, { orgId, staffId }) — open a shift. Returns the shifts row.
 *
 * 409 if the staff member already has one open. 404 if there is no such staff
 * member in that org.
 *
 * THE org_id STORED IS THE STAFF ROW'S OWN, not the one the caller passed. The
 * caller's orgId is used as a filter — it must agree — but the value written
 * comes from `staff`, which is where a person's org actually lives. Both
 * columns are plain FKs, so a mismatched (org_id, staff_id) pair would insert
 * happily and put someone's hours under an org they do not work for. Reading
 * the org from the same row the staff_id names removes the possibility rather
 * than trusting two arguments to agree.
 *
 * The insert is unconditional by design — see the header. Do not "improve" this
 * by checking for an open shift first: that reintroduces the race the index
 * exists to close, and the check would still have to be followed by this same
 * error translation.
 */
export async function clockIn(db, { orgId, staffId } = {}) {
  requireId(orgId, "clockIn: orgId");
  requireId(staffId, "clockIn: staffId");

  let res;
  try {
    res = await db.query(
      `INSERT INTO shifts (org_id, staff_id)
       SELECT s.org_id, s.id
         FROM staff s
        WHERE s.id = $2 AND s.org_id = $1
       RETURNING *`,
      [orgId, staffId]
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ShiftError("staff member already has an open shift", { status: 409 });
    }
    // Anything else is not this module's to interpret. A connection failure
    // must not come back as a tidy 409 saying the user is already clocked in.
    throw e;
  }

  // Zero rows means the SELECT matched nothing: no such staff member, or one
  // that belongs to a different org. Not a 409 — nothing conflicted.
  if (!res.rows[0]) {
    throw new ShiftError("staff member not found in this org", { status: 404 });
  }
  return res.rows[0];
}

/**
 * clockOut(db, { staffId }) — end the open shift. Returns the closed row.
 *
 * 409 when there is nothing open. A clock-out with no shift is not a no-op to
 * be swallowed: it means the two sides disagree about whether this person is on
 * the clock, and the caller has to be told rather than shown a success screen
 * that changed nothing.
 *
 * ended_at is now(), the database's clock, not a timestamp from the caller.
 * A client-supplied end time is a client-supplied timesheet.
 *
 * The WHERE clause carries `ended_at IS NULL`, so a repeated submit cannot
 * move an already-recorded end time forward; the second one gets the 409.
 * uq_shifts_one_open guarantees at most one row matches. On a database where
 * migration 060 has not landed and duplicates exist, this closes all of them,
 * which is the repair rather than a bug — but it is why the return value is
 * documented as "the closed row" and not "the row".
 */
export async function clockOut(db, { staffId } = {}) {
  requireId(staffId, "clockOut: staffId");

  const res = await db.query(
    `UPDATE shifts
        SET ended_at = now(), updated_at = now()
      WHERE staff_id = $1 AND ended_at IS NULL
      RETURNING *`,
    [staffId]
  );
  if (!res.rows[0]) {
    throw new ShiftError("no open shift to close", { status: 409 });
  }
  return res.rows[0];
}

/**
 * currentShift(db, { staffId }) — the open shift, or null.
 *
 * null is a normal answer (the person is not clocked in), not an error, so this
 * one does not throw a 409. ORDER BY started_at DESC LIMIT 1 makes the result
 * deterministic even on a database that predates uq_shifts_one_open and still
 * holds duplicates; with the index applied there is at most one row and the
 * ordering is free.
 */
export async function currentShift(db, { staffId } = {}) {
  requireId(staffId, "currentShift: staffId");

  const res = await db.query(
    `SELECT * FROM shifts
      WHERE staff_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`,
    [staffId]
  );
  return res.rows[0] ?? null;
}

/**
 * autoCloseStale(db, { olderThanHours }) — close shifts nobody ever clocked out
 * of. Returns the array of closed shifts, oldest first.
 *
 * People forget. A shift left open forever is not a person still working; it is
 * a row that will read as an infinite day to anything that totals hours, and it
 * also blocks that person's next clock-in now that uq_shifts_one_open exists.
 *
 * IDLE, NOT ELAPSED. §14 says auto-close on INACTIVITY, and the owner confirmed
 * that reading on 2026-07-31: "a closer working a 13-hour day with activity
 * should never get auto-closed. Idle 12h closes it." This function used to
 * close on `started_at < now() - threshold`, which is elapsed time — it would
 * have closed that closer mid-shift while they were demonstrably working, and
 * then blocked their next clock-in via uq_shifts_one_open.
 *
 * Activity is `staff_events` rows for the shift. That table is the only record
 * of a staff member doing anything, and its index (staff_id, created_at) exists
 * for exactly this kind of question. The sweep's own AUTO_CLOSE_EVENT_KIND rows
 * are excluded — a row this function wrote is not evidence the person was
 * working.
 *
 * last_active_at = the newest such event, or started_at when there are none.
 * Clocking in is itself an act, so a shift with no events is idle from the
 * moment it opened rather than un-assessable.
 *
 * ended_at IS last_active_at — the last moment we have evidence they were
 * working. NOT now(), which would credit every hour between the forgotten
 * clock-out and whenever the sweep ran (a Friday shift reads as 60 hours on
 * Monday). NOT last_active_at + threshold either: the threshold is how long we
 * wait before deciding they left, not time they worked. Paying the idle window
 * would invent up to 12 hours per forgotten clock-out.
 *
 * ⚠ THIS IS ONLY AS GOOD AS THE TELEMETRY, AND THE TELEMETRY IS PARTIAL.
 * logStaffEvent() (src/shifts/telemetry.mjs) had zero call sites when this was
 * written, so `staff_events` held nothing but this function's own audit rows and
 * every open shift read as idle since clock-in. That is fixed for the work this
 * system can attribute: logAttempt() in src/inquiries/work.mjs now emits
 * `call_made` and `letter_issued`, and telemetry-wiring.pg.test.mjs proves end
 * to end that a shift stays open while those events keep arriving and closes at
 * the last one when they stop.
 *
 * WHAT IS STILL NOT COVERED, and it is the reason this is a ⚠ and not a note:
 * the Inquiry Remover desk is the ONLY work that produces activity. A closer on
 * calls, a funding advisor moving rounds, anyone whose whole day happens on a
 * screen that writes no `staff_events` row — all of them still look idle from
 * the moment they clock in, and this sweep would end their shift at its start
 * time. `pull_run`, `text_sent` and `file_touched` have no writer at all; see
 * src/shifts/TELEMETRY-CALLSITES.md and docs/workflows/finish-the-build.md §W1.
 *
 * Nothing runs this — autoCloseStale() still has no caller and no scheduler — so
 * nothing is currently harmed. BEFORE SCHEDULING IT, decide what happens to a
 * role that generates no telemetry. Its shifts will be closed at their start
 * time, and these are timesheet rows.
 *
 * EVERY CLOSE IS RECORDED. One `staff_events` row per shift, kind
 * AUTO_CLOSE_EVENT_KIND, detail carrying the threshold used, the original
 * started_at, the ended_at written and the wall-clock time of the sweep. A
 * timesheet entry that software wrote must never be indistinguishable from one
 * a human clocked; anyone querying a disputed shift can see it was closed by
 * this function, on what assumption, and when.
 *
 * The whole thing is one statement so the close and its audit row cannot be
 * separated by a crash. Data-modifying CTEs in Postgres always run to
 * completion whether or not the primary query reads their output, so `logged`
 * executes even though the final SELECT only reads `closed`.
 *
 * Idempotent: `ended_at IS NULL` means a second run finds nothing left to do.
 */
export async function autoCloseStale(db, { olderThanHours = STALE_SHIFT_HOURS } = {}) {
  // Validated rather than coerced. `Number(undefined)` is NaN, and a NaN
  // interval in the WHERE clause is not "close nothing" — it is a comparison
  // Postgres will reject or, worse, an interval built from a value nobody
  // chose. A threshold of 0 would close every open shift on earth, which is why
  // it is rejected too instead of being treated as "immediately".
  const hours = typeof olderThanHours === "number" ? olderThanHours : NaN;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new ShiftError("autoCloseStale: olderThanHours must be a positive number of hours");
  }

  const res = await db.query(
    `WITH activity AS (
       SELECT s.id,
              GREATEST(s.started_at, COALESCE(MAX(e.created_at), s.started_at)) AS last_active_at,
              count(e.id) > 0                                                   AS had_activity
         FROM shifts s
         LEFT JOIN staff_events e
                ON e.shift_id = s.id
               AND e.kind IS DISTINCT FROM $2::text
        WHERE s.ended_at IS NULL
        GROUP BY s.id, s.started_at
     ),
     closed AS (
       UPDATE shifts s
          SET ended_at   = a.last_active_at,
              updated_at = now()
         FROM activity a
        WHERE s.id = a.id
          AND s.ended_at IS NULL
          AND a.last_active_at < now() - make_interval(secs => $1::double precision * 3600)
        RETURNING s.id, s.org_id, s.staff_id, s.started_at, s.ended_at,
                  a.had_activity
     ),
     logged AS (
       INSERT INTO staff_events (org_id, staff_id, shift_id, kind, detail)
       SELECT c.org_id, c.staff_id, c.id, $2::text, jsonb_build_object(
                'reason',          'shift idle past the stale-shift threshold and was closed by the sweep, not by the staff member',
                'closed_by',       'src/shifts/store.mjs autoCloseStale',
                'rule',            'inactivity since last recorded staff_event (spec 14), not elapsed time since clock-in',
                'threshold_hours', $1::double precision,
                'started_at',      c.started_at,
                'ended_at',        c.ended_at,
                -- false means there was NO recorded activity at all, so ended_at
                -- fell back to started_at. A reader auditing a disputed shift
                -- needs to know the estimate had nothing behind it.
                'had_activity',    c.had_activity,
                'swept_at',        now()
              )
         FROM closed c
       RETURNING shift_id
     )
     SELECT c.id, c.org_id, c.staff_id, c.started_at, c.ended_at, c.had_activity
       FROM closed c
      ORDER BY c.started_at ASC`,
    [hours, AUTO_CLOSE_EVENT_KIND]
  );
  return res.rows;
}
