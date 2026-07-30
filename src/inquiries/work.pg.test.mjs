// Real-Postgres integration test for the inquiry write path.
// SKIPS unless DATABASE_URL is set.
//
// This is where the claims the unit tests could only assert *about the SQL* get
// checked against a database: that call_attempts really equals the number of
// counting attempts, that a note really does not move it, and that the attempt
// log survives as a dated trail.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { logAttempt, confirmRemoval, setStatus, listAttempts } from "./work.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "inquiry_work_pg_test@example.com";

let orgId = null;
let clientId = null;
let staffId = null;
let inquiryId = null;

async function wipe() {
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]); // cascades inquiry_log → inquiry_attempts
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  staffId = (await db.query(`SELECT id FROM staff ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId && staffId, "an org and a staff member must exist — run the seed");

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Inq','Work') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  inquiryId = (await db.query(
    `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status)
     VALUES ($1,$2,'Experian','Some Lender','Pending Removal') RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("logging attempts moves the counter and records who worked the row", { skip: !HAS_DB }, async () => {
  await logAttempt(db, { inquiryId, staffId, kind: "call", outcome: "No answer" });
  const row = await logAttempt(db, { inquiryId, staffId, kind: "letter", outcome: "Mailed" });

  assert.equal(row.call_attempts, 2);
  assert.equal(row.outcome, "Mailed");
  assert.equal(row.worked_by, staffId, "the Worked stat is recorded, not inferred");
  assert.ok(row.worked_at instanceof Date);
});

test("a note joins the timeline without inflating the attempt count", { skip: !HAS_DB }, async () => {
  const row = await logAttempt(db, { inquiryId, staffId, kind: "note", note: "Client called back" });
  assert.equal(row.call_attempts, 2, "notes are not attempts");
  assert.equal(row.outcome, "Mailed", "a note must not overwrite the last real outcome");

  const attempts = await listAttempts(db, { inquiryId });
  assert.equal(attempts.length, 3, "but it is still in the history");
  assert.equal(attempts[0].kind, "note", "newest first");
});

test("confirming sets a timestamp as well as the free-text status", { skip: !HAS_DB }, async () => {
  const row = await confirmRemoval(db, { inquiryId, staffId });
  assert.equal(row.status, "Removed");
  assert.ok(row.confirmed_at instanceof Date);
});

test("reopening a confirmed row clears the confirmation", { skip: !HAS_DB }, async () => {
  const row = await setStatus(db, { inquiryId, staffId, status: "Pending Removal" });
  assert.equal(row.confirmed_at, null, "a reopened row must not carry a stale confirmation");
});

test("the attempt log is not disturbed by status changes", { skip: !HAS_DB }, async () => {
  const attempts = await listAttempts(db, { inquiryId });
  assert.equal(attempts.length, 3, "append-only means append-only");
});
