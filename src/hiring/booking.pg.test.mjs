// Booking an interview, against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// THE THREE TESTS THAT MATTER MOST, and none of them is the happy path:
//
//   1. "the database refuses a double-booked host even when the code is bypassed"
//      — the free check has to be a property of the table, not a habit of this
//      module. A pre-check in JavaScript loses the race the moment two people
//      book the same host in the same second, and the coordinator finds out when
//      both candidates join an empty room. That test writes straight SQL, skips
//      booking.mjs entirely, and expects Postgres to say no.
//
//   2. "nothing invents a meeting link" — this repo has no Zoom, Meet or Whereby
//      integration and cannot mint a room. The only two possible behaviours are
//      "refuse" and "make one up", and public/app/hiring.html already shows what
//      making one up looks like. This pins the refusal.
//
//   3. "`bookings` still has no staff column" — the whole reason the free check
//      is narrow. If someone later adds a host to that table, this test fails,
//      and HOST_BLIND_SPOTS has to be rewritten rather than quietly going stale.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close, pool } from "../db.mjs";
import { apply, advance } from "./pipeline.mjs";
import {
  bookInterview, joinInterview, listOpenInterviews, hostConflicts,
  HOST_BLIND_SPOTS, DEFAULT_DURATION_MIN, BookingError
} from "./booking.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "booktest";
const ROOM = "https://example.test/room/standing";

/* A fixed clock. Every time in this file is derived from it, so nothing depends
   on when the suite happens to run and "in the past" is never ambiguous. */
const NOW = new Date("2026-10-01T15:00:00.000Z");
const at = (hoursFromNow) => new Date(NOW.getTime() + hoursFromNow * 3600_000);

describe("booking a hiring interview", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, hostStaff, roomlessStaff, roleKey, roleId, otherRoleKey;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    hostStaff = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active, meeting_url)
       VALUES ($1,$2,$3,'sales_manager','active',true,$4) RETURNING id`,
      [org, `${TAG} sarah`, `${TAG}-sarah@example.test`, ROOM])).rows[0].id;

    // Named, active, and nobody ever typed in a meeting room for her.
    roomlessStaff = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active)
       VALUES ($1,$2,$3,'sales_manager','active',true) RETURNING id`,
      [org, `${TAG} roomless`, `${TAG}-roomless@example.test`])).rows[0].id;

    // Two throwaway reqs so nothing here mutates the seeded closer/setter rows.
    roleKey = `${TAG}_req`;
    roleId = (await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, hiring_manager_staff_id)
       VALUES ($1,$2,'Booking fixture',1,$3) RETURNING id`,
      [org, roleKey, hostStaff])).rows[0].id;

    otherRoleKey = `${TAG}_other`;
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target)
       VALUES ($1,$2,'Booking fixture (unowned)',1)`, [org, otherRoleKey]);
  });

  after(async () => { await cleanup(); await close(); });

  // ==================================================================== schema

  /* THE FINDING THIS WHOLE LANE EXISTS TO RECORD.
     `bookings` (225) is client-shaped: org, client, source, provider uid, times,
     status, meeting url, attendee name and email. There is no column naming a
     staff member, so a sales call cannot be attributed to a host and cannot be
     seen by any host-based availability question. If that ever changes, this
     fails and HOST_BLIND_SPOTS must be rewritten. */
  test("`bookings` still has no staff column — the free check is blind to sales calls", async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bookings'
        ORDER BY column_name`);
    const cols = rows.map((r) => r.column_name);

    assert.ok(cols.includes("attendee_email"), "sanity: the attendee is on the row");
    const staffish = cols.filter((c) =>
      /staff|host|advisor|closer|assignee|owner/.test(c));
    assert.deepStrictEqual(staffish, [],
      "bookings now names a staff member — src/hiring/booking.mjs HOST_BLIND_SPOTS is stale " +
      "and the free/busy check can and should be widened to cover client calls");
  });

  /* No availability model exists to read. Named here so "we could not check the
     host's real calendar" stays a measured fact rather than an assumption. */
  test("no availability, working-hours or time-off table exists to read", async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE '%availabilit%' OR table_name LIKE '%working_hour%'
               OR table_name LIKE '%time_off%' OR table_name LIKE '%free_busy%')`);
    assert.deepStrictEqual(rows, [],
      "an availability table appeared — the host free check should read it instead of " +
      "only looking at hiring_interviews");
    assert.ok(HOST_BLIND_SPOTS.length >= 4, "the blind spots must stay documented");
  });

  /* Two copies of the same number, pinned together. The pre-check in booking.mjs
     and the column default must guard the same window or the friendly error and
     the constraint disagree about what a clash is. */
  test("DEFAULT_DURATION_MIN matches the column default it mirrors", async () => {
    const { rows } = await db.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name='hiring_interviews'
          AND column_name='duration_min'`);
    assert.strictEqual(Number(String(rows[0].column_default).replace(/\D/g, "")),
      DEFAULT_DURATION_MIN);
  });

  /* ends_at is derived, and a writer is not allowed to disagree with it. If it
     could be set by hand the exclusion constraint would be guarding a window
     nobody scheduled. */
  test("ends_at is derived from the duration, and a hand-written value is overwritten", async () => {
    const { rows } = await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, ends_at, host_staff_id, status)
       VALUES ($1,$2,'one_on_one',$3,45,$4,NULL,'cancelled')
       RETURNING scheduled_for, ends_at`,
      [org, roleId, at(200).toISOString(), at(999).toISOString()]);
    const gap = (new Date(rows[0].ends_at) - new Date(rows[0].scheduled_for)) / 60000;
    assert.strictEqual(gap, 45, "ends_at must follow duration_min, not whatever was passed");
  });

  // ============================================================== booking a 1:1

  test("a booking writes the interview, seats the candidate and moves the stage", async () => {
    const appId = await application("alice");

    const out = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(24), now: NOW
    }));

    assert.strictEqual(out.interview.status, "scheduled");
    assert.strictEqual(out.interview.host_staff_id, hostStaff);
    assert.strictEqual(out.interview.duration_min, DEFAULT_DURATION_MIN);
    assert.strictEqual(out.interview.role_id, roleId);
    // The link came off the host's standing room, not from anywhere clever.
    assert.strictEqual(out.interview.meeting_url, ROOM);
    assert.strictEqual(out.host.source, "person", "the req names a hiring manager");

    // The candidate is actually on it.
    assert.strictEqual(out.attendee.application_id, appId);

    // And the application moved.
    assert.strictEqual(out.advanced.fromStageKey, "applied");
    assert.strictEqual(out.advanced.toStageKey, "one_on_one");
    assert.strictEqual(await stageOf(appId), "one_on_one");

    // Booking decides nothing about the person. 051's invariant, checked here
    // because this is a new write path into the table an adverse-impact review
    // reads.
    const adverse = (await db.query(
      `SELECT count(*)::int AS n FROM hiring_decisions
        WHERE application_id = $1 AND decision IN ('reject','offer_declined')`, [appId]));
    assert.strictEqual(adverse.rows[0].n, 0, "booking must never produce an adverse decision");
  });

  test("booking someone already past that stage does not drag them backwards", async () => {
    const appId = await application("bob");
    await withTx((tx) => advance(tx, {
      orgId: org, applicationId: appId, toStageKey: "offer",
      decidedByStaffId: hostStaff, reason: "fixture"
    }));

    const out = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "group",
      startsAt: at(30), now: NOW
    }));

    assert.strictEqual(out.advanced, null, "no stage move");
    assert.strictEqual(await stageOf(appId), "offer", "still at offer");
  });

  // ================================================================== the gaps

  test("a req with no NAMED manager cannot be booked — a queue cannot host a call", async () => {
    const appId = await application("carol", otherRoleKey);
    const err = await rejected(() => withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(24), now: NOW
    })));
    assert.strictEqual(err.code, "NO_HOST");
    // The message has to name the fix, because the fix is a field nobody has filled in.
    assert.match(err.message, /hiring_manager_staff_id/);
  });

  test("nothing invents a meeting link — a host with no room refuses the booking", async () => {
    const appId = await application("dana");
    const err = await rejected(() => withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(24), hostStaffId: roomlessStaff, now: NOW
    })));
    assert.strictEqual(err.code, "NO_MEETING_URL");
    assert.match(err.message, /meeting room/);

    // And nothing was written on the way to that refusal.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM hiring_interviews WHERE host_staff_id = $1`,
      [roomlessStaff]);
    assert.strictEqual(rows[0].n, 0);
  });

  test("an explicit link is allowed to stand in for a missing standing room", async () => {
    const appId = await application("erin");
    const out = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(48), hostStaffId: roomlessStaff,
      meetingUrl: "https://example.test/room/one-off", now: NOW
    }));
    assert.strictEqual(out.interview.meeting_url, "https://example.test/room/one-off");
  });

  test("a time in the past is refused rather than recorded", async () => {
    const appId = await application("fred");
    const err = await rejected(() => withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(-2), now: NOW
    })));
    assert.strictEqual(err.code, "BAD_TIME");
  });

  test("an application that is not open cannot gain an interview", async () => {
    const appId = await application("gina");
    await withTx((tx) => advance(tx, {
      orgId: org, applicationId: appId, toStageKey: "hired",
      decidedByStaffId: hostStaff, reason: "fixture"
    }));
    const err = await rejected(() => withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: appId, kind: "one_on_one",
      startsAt: at(24), now: NOW
    })));
    assert.strictEqual(err.code, "NOT_OPEN");
  });

  // =========================================================== the host is free

  test("a host already booked in that window is refused, and the clash is named", async () => {
    const first = await application("hank");
    await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: first, kind: "one_on_one",
      startsAt: at(72), now: NOW
    }));

    const second = await application("iris");
    const err = await rejected(() => withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: second, kind: "one_on_one",
      startsAt: at(72.5), now: NOW   // half an hour in, inside the 60-minute slot
    })));
    assert.strictEqual(err.code, "HOST_BUSY");
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.detail.conflicts.length, 1, "the clashing interview comes back");
  });

  test("back to back is not a clash — 10:00-11:00 and 11:00-12:00 both stand", async () => {
    const a = await application("jack");
    const b = await application("kara");
    await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: a, kind: "one_on_one", startsAt: at(96), now: NOW
    }));
    const out = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: b, kind: "one_on_one", startsAt: at(97), now: NOW
    }));
    assert.strictEqual(out.interview.status, "scheduled");
  });

  test("a cancelled interview stops holding the host's time", async () => {
    const a = await application("liam");
    const booked = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: a, kind: "one_on_one", startsAt: at(120), now: NOW
    }));
    await db.query(`UPDATE hiring_interviews SET status = 'cancelled' WHERE id = $1`,
      [booked.interview.id]);

    const b = await application("mona");
    const out = await withTx((tx) => bookInterview(tx, {
      orgId: org, applicationId: b, kind: "one_on_one", startsAt: at(120), now: NOW
    }));
    assert.strictEqual(out.interview.status, "scheduled");

    const clashes = await hostConflicts(db, {
      hostStaffId: hostStaff, startsAt: at(120), durationMin: 60
    });
    assert.strictEqual(clashes.length, 1, "only the live one counts");
  });

  /* THE GUARANTEE, NOT THE HABIT. booking.mjs is not involved at all here. */
  test("the database refuses a double-booked host even when the code is bypassed", async () => {
    const start = at(144).toISOString();
    await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,$5,'scheduled')`,
      [org, roleId, start, ROOM, hostStaff]);

    await assert.rejects(
      () => db.query(
        `INSERT INTO hiring_interviews
           (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
         VALUES ($1,$2,'one_on_one',$3,60,$4,$5,'scheduled')`,
        [org, roleId, start, ROOM, hostStaff]),
      (e) => {
        assert.strictEqual(e.code, "23P01", "exclusion_violation — the constraint, not the app");
        assert.match(String(e.constraint), /hiring_interviews_host_no_overlap/);
        return true;
      });
  });

  test("two different hosts at the same moment is not a clash", async () => {
    const start = at(168).toISOString();
    await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,$5,'scheduled')`,
      [org, roleId, start, ROOM, hostStaff]);
    const { rows } = await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,$5,'scheduled') RETURNING id`,
      [org, roleId, start, ROOM, roomlessStaff]);
    assert.ok(rows[0].id);
  });

  // ========================================================== picking a slot

  test("the only slots offered are sessions a host already committed to", async () => {
    const past = (await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,NULL,'scheduled') RETURNING id`,
      [org, roleId, at(-48).toISOString(), ROOM])).rows[0].id;

    const future = (await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,NULL,'scheduled') RETURNING id`,
      [org, roleId, at(200).toISOString(), ROOM])).rows[0].id;

    const slots = await listOpenInterviews(db, {
      orgId: org, kind: "group", roleKey, now: NOW
    });
    const ids = slots.map((s) => s.id);
    assert.ok(ids.includes(future), "an upcoming session is a slot");
    assert.ok(!ids.includes(past), "a session that already happened is not");
    for (const s of slots) assert.strictEqual(typeof s.attendee_count, "number");
  });

  test("joining a session seats the candidate once, however many times they click", async () => {
    const sessionId = (await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,NULL,'scheduled') RETURNING id`,
      [org, roleId, at(220).toISOString(), ROOM])).rows[0].id;

    const appId = await application("nina");
    const first = await withTx((tx) => joinInterview(tx, {
      orgId: org, applicationId: appId, interviewId: sessionId, now: NOW
    }));
    const again = await withTx((tx) => joinInterview(tx, {
      orgId: org, applicationId: appId, interviewId: sessionId, now: NOW
    }));

    assert.strictEqual(first.attendee.id, again.attendee.id, "one seat, not two");
    assert.strictEqual(await stageOf(appId), "group_interview");
    assert.strictEqual(again.advanced, null, "the second join moves nothing");

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM hiring_interview_attendees WHERE interview_id = $1`,
      [sessionId]);
    assert.strictEqual(rows[0].n, 1);
  });

  test("a session for another job is not joinable", async () => {
    const otherRoleId = (await db.query(
      `SELECT id FROM hiring_roles WHERE org_id = $1 AND key = $2`,
      [org, otherRoleKey])).rows[0].id;
    const sessionId = (await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,NULL,'scheduled') RETURNING id`,
      [org, otherRoleId, at(240).toISOString(), ROOM])).rows[0].id;

    const appId = await application("omar");
    const err = await rejected(() => withTx((tx) => joinInterview(tx, {
      orgId: org, applicationId: appId, interviewId: sessionId, now: NOW
    })));
    assert.strictEqual(err.code, "WRONG_ROLE");
  });

  test("a cancelled session cannot be joined", async () => {
    const sessionId = (await db.query(
      `INSERT INTO hiring_interviews
         (org_id, role_id, kind, scheduled_for, duration_min, meeting_url, host_staff_id, status)
       VALUES ($1,$2,'group',$3,60,$4,NULL,'cancelled') RETURNING id`,
      [org, roleId, at(260).toISOString(), ROOM])).rows[0].id;

    const appId = await application("pia");
    const err = await rejected(() => withTx((tx) => joinInterview(tx, {
      orgId: org, applicationId: appId, interviewId: sessionId, now: NOW
    })));
    assert.strictEqual(err.code, "NOT_SCHEDULED");
  });

  test("an interview in another company is not found, not borrowed", async () => {
    const appId = await application("quinn");
    const err = await rejected(() => withTx((tx) => joinInterview(tx, {
      orgId: "00000000-0000-0000-0000-000000000000",
      applicationId: appId,
      interviewId: "00000000-0000-0000-0000-000000000000",
      now: NOW
    })));
    assert.ok(err instanceof BookingError);
    assert.strictEqual(err.code, "NOT_FOUND");
  });

  // ------------------------------------------------------------------ helpers

  async function application(who, key = roleKey) {
    const out = await withTx((tx) => apply(tx, {
      orgId: org, roleKey: key,
      fullName: `${TAG} ${who}`,
      email: `${TAG}-${who}@example.test`,
      answers: { why: "because" }
    }));
    return out.application.id;
  }

  async function stageOf(applicationId) {
    const { rows } = await db.query(
      `SELECT s.key FROM candidate_applications a
         JOIN pipeline_stages s ON s.id = a.stage_id WHERE a.id = $1`, [applicationId]);
    return rows[0].key;
  }

  /* assert.rejects hands the error to a predicate rather than back to the test,
     so this catches it instead — the code and the detail are what is being
     asserted, and reading them out of a predicate makes the failure output
     useless. */
  async function rejected(fn) {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected a refusal, and none came");
  }

  async function withTx(fn) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ query: (sql, params) => client.query(sql, params) });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* the original error matters */ }
      throw e;
    } finally { client.release(); }
  }

  /* Scoped to this file's own fixtures, NOT to the org.
     hiring.pg.test.mjs clears `hiring_interviews` for the whole default org; two
     hiring test files doing that would delete each other's rows mid-run. Here
     only the interviews belonging to this file's reqs and hosts are removed.

     The audit-trail triggers come off inside ONE transaction and go back on in
     the same one, the same discipline hiring.pg.test.mjs documents: table-wide
     DDL run on the pool would leave those guards off for every other connection
     for the length of the cleanup. */
  async function cleanup() {
    await withTx(async (tx) => {
      const roleIds = (await tx.query(
        `SELECT id FROM hiring_roles WHERE org_id = $1 AND key LIKE $2`,
        [org, `${TAG}_%`])).rows.map((r) => r.id);
      const staffIds = (await tx.query(
        `SELECT id FROM staff WHERE email LIKE $1`, [`${TAG}-%`])).rows.map((r) => r.id);
      const candidateIds = (await tx.query(
        `SELECT id FROM candidates WHERE email LIKE $1`, [`${TAG}-%`])).rows.map((r) => r.id);

      for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                              ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
        await tx.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
      }
      await tx.query(`ALTER TABLE candidate_applications DISABLE TRIGGER trg_application_terminal`);

      if (candidateIds.length) {
        const apps = (await tx.query(
          `SELECT id FROM candidate_applications WHERE candidate_id = ANY($1)`,
          [candidateIds])).rows.map((r) => r.id);
        if (apps.length) {
          await tx.query(`DELETE FROM hiring_interview_attendees WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM application_scores WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM hiring_decisions WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM candidate_applications WHERE id = ANY($1)`, [apps]);
        }
        await tx.query(`DELETE FROM candidates WHERE id = ANY($1)`, [candidateIds]);
      }
      if (roleIds.length || staffIds.length) {
        await tx.query(
          `DELETE FROM hiring_interviews
            WHERE org_id = $1 AND (role_id = ANY($2) OR host_staff_id = ANY($3))`,
          [org, roleIds, staffIds]);
      }
      if (roleIds.length) {
        await tx.query(`DELETE FROM hiring_roles WHERE id = ANY($1)`, [roleIds]);
      }
      if (staffIds.length) {
        await tx.query(`DELETE FROM staff WHERE id = ANY($1)`, [staffIds]);
      }

      await tx.query(`ALTER TABLE candidate_applications ENABLE TRIGGER trg_application_terminal`);
      for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                              ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
        await tx.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
      }
    });
  }
});
