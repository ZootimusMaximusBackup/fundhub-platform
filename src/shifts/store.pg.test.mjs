// Real-Postgres integration test for the clock-in / clock-out writer.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT THIS PROVES THAT store.test.mjs CANNOT. The entire premise of this unit
// is that "one open shift per staff member" is enforced by the database and was
// only believed to be. The build plan cited `idx_shifts_open` from
// 001_init.sql; that index is not unique, and a stub asked whether a second
// insert fails will answer whatever the stub was written to answer. So the
// double-clock-in case is attacked here, twice: once through clockIn(), and
// once with a raw INSERT that bypasses every line of application code, because
// only the second one is a statement about Postgres.
//
// It also asserts the defect itself — that idx_shifts_open is NOT unique — so
// that if someone ever "fixes" this by editing 001_init.sql instead of adding a
// migration, the reason migration 060 exists does not quietly disappear.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  clockIn,
  clockOut,
  currentShift,
  autoCloseStale,
  ShiftError,
  AUTO_CLOSE_EVENT_KIND
} from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL_A = "shifts_pg_test@example.com";
const EMAIL_B = "shifts_pg_test_b@example.com";
const EMAIL_C = "shifts_pg_test_c@example.com";
const EMAILS = [EMAIL_A, EMAIL_B, EMAIL_C];

let orgId = null;
let staffA = null;
let staffB = null;
let staffC = null;

async function wipe() {
  // staff_events.shift_id is ON DELETE SET NULL, so events go before shifts or
  // they survive as orphans pointing at nothing.
  await db.query(
    `DELETE FROM staff_events WHERE staff_id IN (SELECT id FROM staff WHERE email = ANY($1))`, [EMAILS]);
  await db.query(
    `DELETE FROM shifts WHERE staff_id IN (SELECT id FROM staff WHERE email = ANY($1))`, [EMAILS]);
  await db.query(`DELETE FROM staff WHERE email = ANY($1)`, [EMAILS]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  // Fixture staff CREATED, not looked up: a `SELECT id FROM staff LIMIT 1` on a
  // fresh database returns nothing and every assertion below would skip itself
  // into green.
  const mk = async (email, name) => (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status) VALUES ($1,$2,$3,'closer','active') RETURNING id`,
    [orgId, name, email]
  )).rows[0].id;
  staffA = await mk(EMAIL_A, "Shift Tester A");
  staffB = await mk(EMAIL_B, "Shift Tester B");
  staffC = await mk(EMAIL_C, "Shift Tester C");
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const openShifts = async (staffId) =>
  (await db.query(`SELECT * FROM shifts WHERE staff_id=$1 AND ended_at IS NULL`, [staffId])).rows;

// --- the constraint migration 060 adds ---------------------------------------

test("uq_shifts_one_open exists, is UNIQUE, and covers only open shifts", { skip: !HAS_DB }, async () => {
  const def = (await db.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_shifts_one_open'`
  )).rows[0]?.indexdef;
  assert.ok(def, "migration 060 must be applied");
  assert.match(def, /CREATE UNIQUE INDEX/);
  assert.match(def, /\(staff_id\)/);
  assert.match(def, /WHERE \(ended_at IS NULL\)/);
});

test("the pre-existing idx_shifts_open is NOT unique — this is the defect 060 exists for", { skip: !HAS_DB }, async () => {
  const def = (await db.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_shifts_open'`
  )).rows[0]?.indexdef;
  assert.ok(def, "001_init.sql's index is still there — 060 does not drop it");
  assert.doesNotMatch(def, /UNIQUE/, "if this ever becomes unique, 001_init.sql was edited instead of migrated");
});

test("the database itself refuses a second open shift for one staff member", { skip: !HAS_DB }, async () => {
  await db.query(`INSERT INTO shifts (org_id, staff_id) VALUES ($1,$2)`, [orgId, staffA]);
  await assert.rejects(
    // Raw insert: no ShiftError, no clockIn(), nothing this repo wrote. If this
    // succeeds, the constraint is not there and every guarantee above is prose.
    () => db.query(`INSERT INTO shifts (org_id, staff_id) VALUES ($1,$2)`, [orgId, staffA]),
    (e) => e.code === "23505" && /uq_shifts_one_open/.test(e.message + (e.constraint ?? ""))
  );
  assert.equal((await openShifts(staffA)).length, 1);
  await db.query(`DELETE FROM shifts WHERE staff_id=$1`, [staffA]);
});

// --- clockIn -----------------------------------------------------------------

test("clockIn opens exactly one shift, with ended_at NULL and the staff member's own org", { skip: !HAS_DB }, async () => {
  const row = await clockIn(db, { orgId, staffId: staffA });
  assert.equal(row.staff_id, staffA);
  assert.equal(row.org_id, orgId);
  assert.equal(row.ended_at, null);
  assert.ok(row.started_at, "started_at comes from the column default");
  assert.equal((await openShifts(staffA)).length, 1);
});

test("clocking in twice is a 409, and the second attempt creates nothing", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => clockIn(db, { orgId, staffId: staffA }),
    (e) => e instanceof ShiftError && e.status === 409
  );
  assert.equal((await openShifts(staffA)).length, 1, "the race must not leave two open shifts behind");
});

test("one person's open shift does not block anybody else's", { skip: !HAS_DB }, async () => {
  const row = await clockIn(db, { orgId, staffId: staffB });
  assert.equal(row.staff_id, staffB);
  assert.equal((await openShifts(staffB)).length, 1);
  await clockOut(db, { staffId: staffB });
});

test("clockIn for a staff member who is not in the given org is a 404, not a shift under the wrong org", { skip: !HAS_DB }, async () => {
  const otherOrg = "00000000-0000-4000-8000-0000000000ff";
  await assert.rejects(
    () => clockIn(db, { orgId: otherOrg, staffId: staffB }),
    (e) => e instanceof ShiftError && e.status === 404
  );
  assert.equal((await openShifts(staffB)).length, 0, "no row is written for a mismatched pair");
});

test("clockIn for a staff id that does not exist is a 404 rather than a foreign key crash", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => clockIn(db, { orgId, staffId: "00000000-0000-4000-8000-0000000000aa" }),
    (e) => e instanceof ShiftError && e.status === 404
  );
});

// --- clockOut / currentShift --------------------------------------------------

test("currentShift returns the open shift while it is open", { skip: !HAS_DB }, async () => {
  const cur = await currentShift(db, { staffId: staffA });
  assert.ok(cur);
  assert.equal(cur.ended_at, null);
});

test("clockOut ends the shift and currentShift then reports nobody on the clock", { skip: !HAS_DB }, async () => {
  const closed = await clockOut(db, { staffId: staffA });
  assert.ok(closed.ended_at, "ended_at is now set");
  assert.ok(new Date(closed.ended_at) >= new Date(closed.started_at), "a shift cannot end before it began");
  assert.equal(await currentShift(db, { staffId: staffA }), null);
});

test("clocking out twice is a 409 and cannot move an already-recorded end time", { skip: !HAS_DB }, async () => {
  const before = (await db.query(`SELECT ended_at FROM shifts WHERE staff_id=$1`, [staffA])).rows[0].ended_at;
  await assert.rejects(
    () => clockOut(db, { staffId: staffA }),
    (e) => e instanceof ShiftError && e.status === 409
  );
  const after = (await db.query(`SELECT ended_at FROM shifts WHERE staff_id=$1`, [staffA])).rows[0].ended_at;
  assert.deepEqual(after, before, "a repeated submit must not rewrite a recorded timesheet entry");
});

test("a closed shift does not block the next one — the index is partial on ended_at IS NULL", { skip: !HAS_DB }, async () => {
  const row = await clockIn(db, { orgId, staffId: staffA });
  assert.equal(row.ended_at, null);
  const all = (await db.query(`SELECT count(*)::int AS n FROM shifts WHERE staff_id=$1`, [staffA])).rows[0].n;
  assert.equal(all, 2, "yesterday's shift and today's coexist; only one of them is open");
  await clockOut(db, { staffId: staffA });
});

// --- autoCloseStale -----------------------------------------------------------

test("autoCloseStale ends an idle shift at its last activity, not when the sweep ran", { skip: !HAS_DB }, async () => {
  const opened = (await db.query(
    `INSERT INTO shifts (org_id, staff_id, started_at) VALUES ($1,$2, now() - interval '30 hours') RETURNING *`,
    [orgId, staffB]
  )).rows[0];
  // Worked a while, then went quiet 20 hours ago — past an 8-hour idle
  // threshold, so this one is genuinely forgotten.
  const lastAct = (await db.query(
    `INSERT INTO staff_events (org_id, staff_id, shift_id, kind, detail, created_at)
     VALUES ($1,$2,$3,'pull_run','{}'::jsonb, now() - interval '20 hours') RETURNING created_at`,
    [orgId, staffB, opened.id]
  )).rows[0].created_at;

  const closed = await autoCloseStale(db, { olderThanHours: 8 });
  const mine = closed.find((r) => r.id === opened.id);
  assert.ok(mine, "idle for 20 hours is past an 8-hour threshold");

  assert.equal(new Date(mine.ended_at).toISOString(), new Date(lastAct).toISOString(),
    "ended_at is the last recorded activity; now() would credit the 20 idle hours");
  assert.equal(mine.had_activity, true, "the audit must be able to say the estimate had evidence behind it");
  assert.ok(new Date(mine.ended_at) < new Date(), "and it is in the past, not the moment of the sweep");
});

test("autoCloseStale leaves a long shift alone while it is still active — §14 is inactivity", { skip: !HAS_DB }, async () => {
  // The case the owner named on 2026-07-31: a closer 13 hours into a shift who
  // is still working. Under the elapsed-time rule this replaced, that shift was
  // closed mid-shift and uq_shifts_one_open then blocked the next clock-in.
  const opened = (await db.query(
    `INSERT INTO shifts (org_id, staff_id, started_at) VALUES ($1,$2, now() - interval '13 hours') RETURNING *`,
    [orgId, staffC]
  )).rows[0];
  await db.query(
    `INSERT INTO staff_events (org_id, staff_id, shift_id, kind, detail, created_at)
     VALUES ($1,$2,$3,'call_made','{}'::jsonb, now() - interval '10 minutes')`,
    [orgId, staffC, opened.id]
  );

  const closed = await autoCloseStale(db, { olderThanHours: 12 });
  assert.ok(!closed.find((r) => r.id === opened.id),
    "13 hours elapsed but active 10 minutes ago — closing this is the bug, not the feature");

  const still = (await db.query(`SELECT ended_at FROM shifts WHERE id=$1`, [opened.id])).rows[0];
  assert.equal(still.ended_at, null, "and it is genuinely still open, not merely absent from the return");
});

test("the sweep's own audit rows are not activity — a stale shift cannot look busy", { skip: !HAS_DB }, async () => {
  // AUTO_CLOSE_EVENT_KIND rows carry the shift_id they closed. If they counted
  // as activity, last_active_at would advance to the sweep's own write.
  const opened = (await db.query(
    `INSERT INTO shifts (org_id, staff_id, started_at) VALUES ($1,$2, now() - interval '40 hours') RETURNING *`,
    [orgId, staffA]
  )).rows[0];
  await db.query(
    `INSERT INTO staff_events (org_id, staff_id, shift_id, kind, detail, created_at)
     VALUES ($1,$2,$3,$4,'{}'::jsonb, now())`,
    [orgId, staffA, opened.id, AUTO_CLOSE_EVENT_KIND]
  );

  const closed = await autoCloseStale(db, { olderThanHours: 8 });
  const mine = closed.find((r) => r.id === opened.id);
  assert.ok(mine, "a sweep row dated now() must not make a 40-hour-idle shift look active");
  assert.equal(mine.had_activity, false, "there was no real activity — only the sweep's own row");
});

test("every auto-closed shift leaves a staff_events row saying software closed it, on what assumption", { skip: !HAS_DB }, async () => {
  const rows = (await db.query(
    `SELECT * FROM staff_events WHERE staff_id=$1 AND kind=$2`, [staffB, AUTO_CLOSE_EVENT_KIND]
  )).rows;
  assert.equal(rows.length, 1, "one audit row per closed shift, no more and no fewer");
  const ev = rows[0];
  assert.equal(ev.org_id, orgId);
  assert.ok(ev.shift_id, "the event points back at the shift it closed");
  assert.equal(ev.detail.threshold_hours, 8, "the assumption used is recorded, not implied");
  assert.ok(ev.detail.started_at && ev.detail.ended_at && ev.detail.swept_at);
  assert.match(ev.detail.closed_by, /autoCloseStale/);
  assert.ok(ev.detail.reason, "a timesheet entry written by software must never look like one a human clocked");
});

test("autoCloseStale leaves a shift that is still within the threshold alone", { skip: !HAS_DB }, async () => {
  const fresh = await clockIn(db, { orgId, staffId: staffA });
  const closed = await autoCloseStale(db, { olderThanHours: 8 });
  assert.equal(closed.find((r) => r.id === fresh.id), undefined, "a shift someone is working is not stale");
  assert.equal((await currentShift(db, { staffId: staffA }))?.id, fresh.id);
  await clockOut(db, { staffId: staffA });
});

test("a second sweep closes nothing and does not write a second audit row", { skip: !HAS_DB }, async () => {
  const before = (await db.query(
    `SELECT count(*)::int AS n FROM staff_events WHERE staff_id=$1 AND kind=$2`, [staffB, AUTO_CLOSE_EVENT_KIND]
  )).rows[0].n;
  const closed = await autoCloseStale(db, { olderThanHours: 8 });
  assert.equal(closed.filter((r) => r.staff_id === staffB).length, 0, "nothing of ours is left open");
  const after = (await db.query(
    `SELECT count(*)::int AS n FROM staff_events WHERE staff_id=$1 AND kind=$2`, [staffB, AUTO_CLOSE_EVENT_KIND]
  )).rows[0].n;
  assert.equal(after, before, "re-running the sweep must not accumulate audit rows");
});

test("auto-closing frees the staff member to clock in again — an abandoned shift no longer locks them out", { skip: !HAS_DB }, async () => {
  const row = await clockIn(db, { orgId, staffId: staffB });
  assert.equal(row.ended_at, null);
  await clockOut(db, { staffId: staffB });
});
