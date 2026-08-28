// The end-to-end case §14 is actually about, against real Postgres:
//
//   a shift stays open while the person keeps working, and closes once they stop.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// WHY THIS FILE EXISTS. autoCloseStale() closes on INACTIVITY measured from
// `staff_events`, and until now nothing wrote to `staff_events`. store.pg.test.mjs
// covers the sweep's arithmetic by INSERTing activity rows by hand — which
// proves the SQL and proves nothing at all about whether real work produces
// real rows. Its own header said so: "⚠ THIS IS ONLY AS GOOD AS THE TELEMETRY,
// AND THE TELEMETRY HAS NO WRITERS."
//
// So every event below is written by the actual business action —
// logAttempt() in src/inquiries/work.mjs, the call site that now emits
// `call_made` — and not by a hand-written INSERT. Delete the logStaffEvent()
// call from work.mjs and this file goes red, which is the whole point: it is
// the test that says the sweep can now be scheduled safely.
//
// HOW TIME IS SIMULATED. A test cannot wait thirty minutes, so `created_at` on
// the events the real writer produced is moved backwards to stand for time
// passing. The rows are genuine; only the clock is staged, and each shift is
// asserted against explicitly rather than against "whatever the sweep returned".
//
// WHY THE THRESHOLD IS HALF AN HOUR AND NOT TWELVE. autoCloseStale() is global
// — it closes every stale open shift in the database — and node --test runs
// suites in parallel processes. A shift idle for hours here would be fair game
// for store.pg.test.mjs's 8-hour sweep running at the same moment, and this
// file would fail for a reason that has nothing to do with what it tests.
// Keeping every interval under an hour means no other suite's sweep can reach
// these shifts, and no sweep here can reach a shift another suite just opened.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { clockIn, autoCloseStale, AUTO_CLOSE_EVENT_KIND } from "./store.mjs";
import { logAttempt } from "../inquiries/work.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const STAFF_EMAIL = "telemetry_wiring_pg_test@example.com";
const CLIENT_EMAIL = "telemetry.wiring.pg.test@example.com";

// Half an hour. See the header for why it is not the 12-hour policy default.
const IDLE_HOURS = 0.5;

describe("autoCloseStale with real telemetry flowing", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId, staffId, clientId, inquiryId;

  async function wipe() {
    await db.query(`DELETE FROM clients WHERE email = $1`, [CLIENT_EMAIL]); // cascades inquiry_log → inquiry_attempts
    // staff_events.staff_id and shifts.staff_id are both ON DELETE CASCADE, so
    // dropping the fixture staff member takes this file's events and shifts
    // with it and touches nobody else's.
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    await wipe();
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    // Created, not looked up. A `SELECT id FROM staff LIMIT 1` on a fresh
    // database returns nothing and every assertion below would skip into green.
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1,'Telemetry Wiring Pgtest',$2,'inquiry_specialist','active') RETURNING id`,
      [orgId, STAFF_EMAIL])).rows[0].id;

    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Telemetry','Wiring',$2) RETURNING id`,
      [orgId, CLIENT_EMAIL])).rows[0].id;

    inquiryId = (await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status, call_attempts)
       VALUES ($1,$2,'Equifax','Synchrony telemetry wiring','New',0) RETURNING id`,
      [orgId, clientId])).rows[0].id;
  });

  after(async () => {
    await wipe();
    await close();
  });

  // --- the fixture's own vocabulary ------------------------------------------

  /** Open a shift through the real writer, then backdate it.
   *
   *  The previous test's events go first. staff_events.shift_id is ON DELETE
   *  SET NULL, so dropping a shift without them leaves unlinked rows behind and
   *  "how many events have no shift" stops being a statement about this test. */
  const openShiftStartedMinutesAgo = async (minutes) => {
    await db.query(`DELETE FROM staff_events WHERE staff_id = $1`, [staffId]);
    await db.query(`DELETE FROM shifts WHERE staff_id = $1`, [staffId]);
    const shift = await clockIn(db, { orgId, staffId });
    await db.query(
      `UPDATE shifts SET started_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [shift.id, minutes]);
    return shift.id;
  };

  /** Do a real piece of work. The `call_made` row is a side effect of this, not
   *  of anything the test wrote. */
  const workTheInquiry = (shiftId, outcome) =>
    /* orgId is REQUIRED by logAttempt (work.mjs:82 throws 403 without it) and
       was never passed here, so every call in this file threw before writing a
       single staff_event and all five tests died. The org is already resolved
       in before(); it just never reached the call. */
    logAttempt(db, { inquiryId, staffId, orgId, kind: "call", outcome, shiftId });

  /** Time passing, staged: move this shift's activity further into the past. */
  const ageActivityByMinutes = (shiftId, minutes) => db.query(
    `UPDATE staff_events SET created_at = created_at - make_interval(mins => $2) WHERE shift_id = $1`,
    [shiftId, minutes]);

  const activityFor = async (shiftId) => (await db.query(
    `SELECT kind, created_at, detail FROM staff_events
      WHERE shift_id = $1 AND kind <> $2 ORDER BY created_at`, [shiftId, AUTO_CLOSE_EVENT_KIND])).rows;

  const shiftRow = async (shiftId) =>
    (await db.query(`SELECT started_at, ended_at FROM shifts WHERE id = $1`, [shiftId])).rows[0];

  // ==========================================================================

  test("the business action itself puts a row in staff_events — telemetry is no longer decorative", async () => {
    const shiftId = await openShiftStartedMinutesAgo(90);
    await workTheInquiry(shiftId, "No answer");

    const events = await activityFor(shiftId);
    assert.equal(events.length, 1, "logging a call attempt must produce exactly one staff_events row");
    assert.equal(events[0].kind, "call_made");
    assert.equal(events[0].detail.inquiry_id, inquiryId);
  });

  test("a shift stays open while events keep arriving, however long it has run", async () => {
    // The case the owner named: someone hours into a shift who is still working
    // must never be auto-closed. Under the old elapsed-time rule this shift was
    // closed mid-shift and uq_shifts_one_open then blocked the next clock-in.
    const shiftId = await openShiftStartedMinutesAgo(180);   // three hours in

    // A morning's work: three attempts, spread across the shift. Each is a real
    // logAttempt(); only their timestamps are staged.
    await workTheInquiry(shiftId, "No answer");
    await ageActivityByMinutes(shiftId, 20);                 // that one now sits 20 min back
    await workTheInquiry(shiftId, "Left voicemail");
    await ageActivityByMinutes(shiftId, 8);                  // 28 min and 8 min back
    await workTheInquiry(shiftId, "Spoke to furnisher");     // and one just now

    assert.equal((await activityFor(shiftId)).length, 3, "three attempts, three events");

    const closed = await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
    assert.ok(!closed.find((r) => r.id === shiftId),
      "three hours elapsed but active seconds ago — closing this is the bug, not the feature");
    assert.equal((await shiftRow(shiftId)).ended_at, null,
      "and it is genuinely still open, not merely absent from the return value");

    // Still arriving. A second sweep must reach the same answer, not drift into
    // closing it because one more cycle went by.
    await ageActivityByMinutes(shiftId, 25);                 // newest is now 25 min back — still inside 30
    await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
    assert.equal((await shiftRow(shiftId)).ended_at, null, "25 minutes idle is inside a 30-minute threshold");

    await workTheInquiry(shiftId, "Callback booked");        // they are back
    await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
    assert.equal((await shiftRow(shiftId)).ended_at, null, "a fresh event must reset the idle clock");
  });

  test("it closes once the events stop, at the last one — not at the moment of the sweep", async () => {
    const shiftId = await openShiftStartedMinutesAgo(180);
    await workTheInquiry(shiftId, "No answer");
    await workTheInquiry(shiftId, "Left voicemail");

    // Then they went home without clocking out. Everything they did recedes
    // past the threshold; nothing new arrives.
    await ageActivityByMinutes(shiftId, 45);
    const lastActivity = (await activityFor(shiftId)).at(-1).created_at;

    const closed = await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
    const mine = closed.find((r) => r.id === shiftId);
    assert.ok(mine, "45 minutes of silence is past a 30-minute threshold — this shift is forgotten");

    assert.equal(new Date(mine.ended_at).toISOString(), new Date(lastActivity).toISOString(),
      "ended_at is the last moment there is evidence of work; now() would pay the idle window");
    assert.equal(mine.had_activity, true,
      "the audit must record that the estimate had evidence behind it — this is a timesheet input");

    const audit = (await db.query(
      `SELECT detail FROM staff_events WHERE shift_id = $1 AND kind = $2`, [shiftId, AUTO_CLOSE_EVENT_KIND])).rows;
    assert.equal(audit.length, 1, "one audit row per closed shift");
    assert.equal(audit[0].detail.had_activity, true);
    assert.equal(audit[0].detail.threshold_hours, IDLE_HOURS, "the assumption used is recorded, not implied");
  });

  test("with the telemetry flowing, a busy shift and an abandoned one are told apart in one sweep", async () => {
    // The distinction the sweep could not make while staff_events was empty:
    // with no events, last_active_at is started_at for everybody, so every open
    // shift reads as idle since clock-in and the sweep closes the working ones
    // too. Both shifts here are the same age; only their activity differs.
    const second = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1,'Telemetry Wiring Pgtest Two',$2,'closer','active') RETURNING id`,
      [orgId, "two." + STAFF_EMAIL])).rows[0].id;

    try {
      const busy = await openShiftStartedMinutesAgo(180);
      const abandoned = (await db.query(
        `INSERT INTO shifts (org_id, staff_id, started_at) VALUES ($1,$2, now() - make_interval(mins => 180))
         RETURNING id`, [orgId, second])).rows[0].id;

      await workTheInquiry(busy, "Spoke to furnisher");      // busy: evidence, seconds old

      const closed = await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
      assert.ok(!closed.find((r) => r.id === busy), "the working shift must survive the sweep");
      assert.ok(closed.find((r) => r.id === abandoned), "the shift with no evidence at all must not");
      assert.equal(closed.find((r) => r.id === abandoned).had_activity, false,
        "no activity means the ended_at estimate had nothing behind it, and the audit must say so");
      assert.equal((await shiftRow(busy)).ended_at, null);
    } finally {
      await db.query(`DELETE FROM staff WHERE id = $1`, [second]);
    }
  });

  test("work logged off the clock does not hold somebody else's shift open", async () => {
    // shift_id NULL is a legitimate state — work done off the clock — and the
    // row is written rather than refused. It is simply not evidence about any
    // shift, and the sweep joins on shift_id so it cannot be mistaken for some.
    const shiftId = await openShiftStartedMinutesAgo(180);
    await workTheInquiry(shiftId, "No answer");
    await ageActivityByMinutes(shiftId, 45);

    const unlinked = await logAttempt(db, { inquiryId, staffId, orgId, kind: "call", outcome: "off the clock", shiftId: null });
    assert.ok(unlinked, "the attempt itself still succeeds");
    assert.equal((await db.query(
      `SELECT count(*)::int AS n FROM staff_events WHERE staff_id = $1 AND shift_id IS NULL`, [staffId])).rows[0].n,
      1, "the unlinked event is recorded, not dropped");

    const closed = await autoCloseStale(db, { olderThanHours: IDLE_HOURS });
    assert.ok(closed.find((r) => r.id === shiftId),
      "an event with no shift_id must not count as activity on a shift it was never linked to");
  });
});
