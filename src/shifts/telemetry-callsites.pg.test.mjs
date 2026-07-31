// The wired call site, end to end, against real Postgres.
// SKIPS unless DATABASE_URL is set.
//
// The unit tests prove logAttempt() ISSUES the telemetry write. This proves the
// row lands: staff_events has a real FK to staff and to shifts, `kind` has no
// CHECK but `detail` is jsonb NOT NULL, and a stub cannot fail any of that.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { logAttempt } from "../inquiries/work.mjs";
import { clockIn, clockOut } from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "telemetry_callsites_pg_test@example.com";
const STAFF_EMAIL = "telemetry_callsites_staff@example.com";

let orgId = null;
let clientId = null;
let staffId = null;
let inquiryId = null;

async function wipe() {
  await db.query(`DELETE FROM staff_events WHERE staff_id IN (SELECT id FROM staff WHERE email=$1)`, [STAFF_EMAIL]);
  await db.query(`DELETE FROM shifts WHERE staff_id IN (SELECT id FROM staff WHERE email=$1)`, [STAFF_EMAIL]);
  await db.query(`DELETE FROM inquiry_attempts WHERE inquiry_id IN (SELECT id FROM inquiry_log WHERE client_id IN (SELECT id FROM clients WHERE email=$1))`, [EMAIL]);
  await db.query(`DELETE FROM inquiry_log WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
  await db.query(`DELETE FROM staff WHERE email=$1`, [STAFF_EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  staffId = (await db.query(
    `INSERT INTO staff (org_id, name, email, role) VALUES ($1,'Telemetry Tester',$2,'inquiry_specialist') RETURNING id`,
    [orgId, STAFF_EMAIL]
  )).rows[0].id;
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Tele','Metry') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  inquiryId = (await db.query(
    `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status) VALUES ($1,$2,'Experian','Acme Bank','open') RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const eventsFor = async () =>
  (await db.query(`SELECT * FROM staff_events WHERE staff_id=$1 ORDER BY created_at`, [staffId])).rows;

test("a logged call lands one staff_events row, linked to the open shift", { skip: !HAS_DB }, async () => {
  const shift = await clockIn(db, { orgId, staffId });
  await logAttempt(db, { inquiryId, staffId, kind: "call", outcome: "No answer" });

  const rows = await eventsFor();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "call_made");
  assert.equal(rows[0].shift_id, shift.id, "the work is on the clock it happened on");
  assert.equal(rows[0].org_id, orgId);
  assert.equal(rows[0].detail.inquiry_id, inquiryId);
  assert.equal(rows[0].detail.outcome, "No answer");
  assert.equal(rows[0].detail.attempt_no, 1, "the attempt number comes off the row just written");

  await clockOut(db, { staffId });
});

test("off the clock, the row still lands with a null shift", { skip: !HAS_DB }, async () => {
  await logAttempt(db, { inquiryId, staffId, kind: "letter" });
  const rows = await eventsFor();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, "letter_issued");
  assert.equal(rows[1].shift_id, null, "'not on a shift' is an answer, not a gap");
});

test("a portal filing adds an attempt but no telemetry row", { skip: !HAS_DB }, async () => {
  const before = (await eventsFor()).length;
  const updated = await logAttempt(db, { inquiryId, staffId, kind: "portal" });
  assert.equal(updated.call_attempts, 3, "it still counts as an attempt");
  assert.equal((await eventsFor()).length, before, "EVENT_KINDS has no word for it, so it is not filed under one");
});
