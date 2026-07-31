// Real-Postgres integration test for the staff telemetry writer.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT THIS PROVES THAT telemetry.test.mjs CANNOT:
//
//   1. The row lands. `staff_events` has never had a writer, so "the INSERT is
//      valid against the real table" is not a thing any fake can answer — the
//      column names (kind / detail, NOT event_type / event_data) and the jsonb
//      cast are only real here.
//   2. org_id is the staff row's own. Two plain FKs that disagree insert
//      happily; only Postgres can show which value actually landed.
//   3. THE SWALLOW IS REAL. A shift_id that does not exist is a genuine 23503
//      from the server, not a stubbed rejection, and the module has to come back
//      with { logged: false } rather than throwing into a call site.
//   4. `kind` has NO CHECK CONSTRAINT AND NO CATALOG. The last test inserts
//      nonsense straight past the module and Postgres accepts it, which is
//      exactly why EVENT_KINDS exists in JavaScript. If someone ever adds a
//      constraint, that test fails and the vocabulary's home moves to the
//      database, where it belongs.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { logStaffEvent, EVENT_KINDS } from "./telemetry.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "shift_telemetry_pg_test@example.com";
const ABSENT_UUID = "00000000-0000-0000-0000-0000000000ff";

let orgId = null;
let staffId = null;
let shiftId = null;

async function wipe() {
  // staff_events.shift_id is ON DELETE SET NULL, so the events go before the
  // shifts or they survive as orphans pointing at nothing.
  await db.query(
    `DELETE FROM staff_events WHERE staff_id IN (SELECT id FROM staff WHERE email = $1)`, [EMAIL]);
  await db.query(
    `DELETE FROM shifts WHERE staff_id IN (SELECT id FROM staff WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM staff WHERE email = $1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  // Fixture staff CREATED, not looked up: a `SELECT id FROM staff LIMIT 1` on a
  // fresh database returns nothing and every assertion below would skip itself
  // into green.
  staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1,'Telemetry Tester',$2,'inquiry_specialist','active') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;

  shiftId = (await db.query(
    `INSERT INTO shifts (org_id, staff_id) VALUES ($1,$2) RETURNING id`,
    [orgId, staffId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const eventsFor = async () =>
  (await db.query(`SELECT * FROM staff_events WHERE staff_id = $1 ORDER BY created_at`, [staffId])).rows;

const countFor = async () =>
  (await db.query(`SELECT count(*)::int n FROM staff_events WHERE staff_id = $1`, [staffId])).rows[0].n;

/* console.error is the module's swallow channel; the failure paths below are it
   working, so the noise is captured rather than printed. */
async function quietly(fn) {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
}

// --- the row lands ------------------------------------------------------------

test("a logged event becomes one staff_events row on the real kind/detail columns", { skip: !HAS_DB }, async () => {
  const before_ = await countFor();
  const res = await logStaffEvent(db, {
    orgId, staffId, shiftId,
    kind: "call_made",
    detail: { inquiry_id: "iq-1", outcome: "no answer", attempt: 3 }
  });
  assert.equal(res.logged, true);
  assert.equal(await countFor(), before_ + 1);

  const row = (await db.query(`SELECT * FROM staff_events WHERE id = $1`, [res.event.id])).rows[0];
  assert.equal(row.kind, "call_made");
  assert.deepEqual(row.detail, { inquiry_id: "iq-1", outcome: "no answer", attempt: 3 },
    "detail round-trips as a jsonb object, not a string");
  assert.equal(row.shift_id, shiftId, "the work is attributed to the shift it happened on");
  assert.ok(row.created_at instanceof Date);
});

test("every kind in EVENT_KINDS is actually writable against the real table", { skip: !HAS_DB }, async () => {
  for (const kind of EVENT_KINDS) {
    const res = await logStaffEvent(db, { orgId, staffId, kind, detail: { probe: kind } });
    assert.equal(res.logged, true, `${kind} must be insertable`);
    assert.equal(res.event.kind, kind);
  }
  const kinds = (await eventsFor()).map((r) => r.kind);
  for (const kind of EVENT_KINDS) assert.ok(kinds.includes(kind), `${kind} landed`);
});

test("the stored org_id is the staff row's own, not whatever the caller passed", { skip: !HAS_DB }, async () => {
  const res = await logStaffEvent(db, { staffId, kind: "file_touched" });   // no orgId at all
  assert.equal(res.logged, true);
  assert.equal(res.event.org_id, orgId, "read off staff, so a row cannot land under the wrong tenant");
});

test("shift_id is nullable and a null one is an honest row, not a failure", { skip: !HAS_DB }, async () => {
  const res = await logStaffEvent(db, { orgId, staffId, kind: "text_sent", detail: {} });
  assert.equal(res.logged, true);
  assert.equal(res.event.shift_id, null);
});

// --- the swallow, against the real server -------------------------------------

test("a shift_id that does not exist loses the telemetry row, not the calling action", { skip: !HAS_DB }, async () => {
  const before_ = await countFor();
  const res = await quietly(() => logStaffEvent(db, {
    orgId, staffId, shiftId: ABSENT_UUID, kind: "pull_run"
  }));
  // A real 23503 from Postgres. The module must absorb it.
  assert.deepEqual(res, { logged: false, reason: "write_failed" });
  assert.equal(await countFor(), before_, "and nothing was written");
});

test("a staff member from another org is refused rather than filed across tenants", { skip: !HAS_DB }, async () => {
  const before_ = await countFor();
  const res = await quietly(() => logStaffEvent(db, {
    orgId: ABSENT_UUID, staffId, kind: "letter_issued"
  }));
  assert.deepEqual(res, { logged: false, reason: "staff_not_found" });
  assert.equal(await countFor(), before_);
});

test("an unknown staff id is refused without a foreign key error reaching the caller", { skip: !HAS_DB }, async () => {
  const res = await quietly(() => logStaffEvent(db, { orgId, staffId: ABSENT_UUID, kind: "call_made" }));
  assert.deepEqual(res, { logged: false, reason: "staff_not_found" });
});

test("an unknown kind never reaches the free-text column", { skip: !HAS_DB }, async () => {
  const before_ = await countFor();
  const res = await quietly(() => logStaffEvent(db, { orgId, staffId, kind: "coffee_made" }));
  assert.deepEqual(res, { logged: false, reason: "unknown_kind" });
  assert.equal(await countFor(), before_);
});

// --- why EVENT_KINDS has to exist in JavaScript --------------------------------

test("staff_events.kind has no CHECK and no catalog — the vocabulary is only enforced in code", { skip: !HAS_DB }, async () => {
  const checks = (await db.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'staff_events' AND c.contype = 'c'`
  )).rows;
  const onKind = checks.filter((c) => /\bkind\b/.test(c.def));
  assert.equal(onKind.length, 0,
    "if this ever fails, a constraint was added and EVENT_KINDS should be reconciled with it");

  // And the demonstration: nonsense inserts fine when the module is bypassed.
  const raw = await db.query(
    `INSERT INTO staff_events (org_id, staff_id, kind) VALUES ($1,$2,'not_a_real_kind') RETURNING id, kind`,
    [orgId, staffId]
  );
  assert.equal(raw.rows[0].kind, "not_a_real_kind");
  await db.query(`DELETE FROM staff_events WHERE id = $1`, [raw.rows[0].id]);
});
