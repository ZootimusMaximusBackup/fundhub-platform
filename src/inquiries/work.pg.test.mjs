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
  /* logAttempt now emits a `staff_events` row for call and letter attempts, and
     this suite borrows a seeded staff member rather than creating its own — so
     nothing cascades those rows away. They are matched by the inquiry they name
     and must go BEFORE the client, which is what makes them findable. */
  await db.query(
    `DELETE FROM staff_events
      WHERE detail->>'inquiry_id' IN (
        SELECT il.id::text FROM inquiry_log il
          JOIN clients c ON c.id = il.client_id
         WHERE c.email = $1)`, [EMAIL]);
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
  await logAttempt(db, { orgId, inquiryId, staffId, kind: "call", outcome: "No answer" });
  const row = await logAttempt(db, { orgId, inquiryId, staffId, kind: "letter", outcome: "Mailed" });

  assert.equal(row.call_attempts, 2);
  assert.equal(row.outcome, "Mailed");
  assert.equal(row.worked_by, staffId, "the Worked stat is recorded, not inferred");
  assert.ok(row.worked_at instanceof Date);
});

test("a note joins the timeline without inflating the attempt count", { skip: !HAS_DB }, async () => {
  const row = await logAttempt(db, { orgId, inquiryId, staffId, kind: "note", note: "Client called back" });
  assert.equal(row.call_attempts, 2, "notes are not attempts");
  assert.equal(row.outcome, "Mailed", "a note must not overwrite the last real outcome");

  const attempts = await listAttempts(db, { orgId, inquiryId });
  assert.equal(attempts.length, 3, "but it is still in the history");
  assert.equal(attempts[0].kind, "note", "newest first");
});

test("confirming sets a timestamp as well as the free-text status", { skip: !HAS_DB }, async () => {
  const row = await confirmRemoval(db, { orgId, inquiryId, staffId });
  assert.equal(row.status, "Removed");
  assert.ok(row.confirmed_at instanceof Date);
});

test("reopening a confirmed row clears the confirmation", { skip: !HAS_DB }, async () => {
  const row = await setStatus(db, { orgId, inquiryId, staffId, status: "Pending Removal" });
  assert.equal(row.confirmed_at, null, "a reopened row must not carry a stale confirmation");
});

test("the attempt log is not disturbed by status changes", { skip: !HAS_DB }, async () => {
  const attempts = await listAttempts(db, { orgId, inquiryId });
  assert.equal(attempts.length, 3, "append-only means append-only");
});

/* ───────────────────────────────────────────────────────────────────────────
   THE CASE BRANCH — previously uncovered, and that is why it shipped broken.

   confirmRemoval only touches inquiry_removal_cases when the inquiry_log row is
   linked to a case AND it was the last open one. Neither existing suite ever
   built that shape: work.test.mjs mocks the row with `case_id: null`, and every
   fixture above leaves case_id NULL. So the UPDATE in that branch was never
   executed by any test, and it carried `case_status = 'Cleared'` — a value the
   inquiry_case_status enum does not have. Postgres answers 22P02 and the whole
   call throws, which also means the inquiry.removed emit on the next line never
   ran. On the live desk, "Mark confirmed" on the last open inquiry of a case
   500'd every time.

   These two tests pin both halves: the case really reaches 'Completed', and a
   case that is already finished is left alone.
   ─────────────────────────────────────────────────────────────────────────── */

const CASE_EMAIL = "inquiry_work_pg_case_test@example.com";

async function wipeCase() {
  await db.query(
    `DELETE FROM staff_events
      WHERE detail->>'inquiry_id' IN (
        SELECT il.id::text FROM inquiry_log il
          JOIN clients c ON c.id = il.client_id
         WHERE c.email = $1)`, [CASE_EMAIL]);
  // events.client_id is a plain FK with no ON DELETE CASCADE, and this is the one
  // branch that writes an inquiry.removed row — so the event has to go before the
  // client, or the delete below fails with 23503.
  await db.query(
    `DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`,
    [CASE_EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [CASE_EMAIL]);
}

async function buildLinkedCase() {
  const cid = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Case','Branch') RETURNING id`,
    [orgId, CASE_EMAIL]
  )).rows[0].id;
  const caseRow = (await db.query(
    `INSERT INTO inquiry_removal_cases (org_id, client_id, case_id, case_status, open_inquiry_count)
     VALUES ($1,$2,$3,'Queued',1) RETURNING *`,
    [orgId, cid, `IRC-PGTEST-${Date.now()}`]
  )).rows[0];
  const inqId = (await db.query(
    `INSERT INTO inquiry_log (org_id, client_id, case_id, bureau, inquiry, status, is_open)
     VALUES ($1,$2,$3,'Experian','Some Lender','Pending Removal',true) RETURNING id`,
    [orgId, cid, caseRow.id]
  )).rows[0].id;
  return { clientId: cid, caseRow, inquiryId: inqId };
}

test("confirming the last open inquiry completes its case instead of throwing on the enum",
  { skip: !HAS_DB }, async () => {
    await wipeCase();
    const built = await buildLinkedCase();

    await confirmRemoval(db, { orgId, inquiryId: built.inquiryId, staffId });

    const after = (await db.query(
      `SELECT case_status::text AS case_status, cleared_at, completed_at, open_inquiry_count, master_call_state
         FROM inquiry_removal_cases WHERE id = $1`, [built.caseRow.id])).rows[0];

    assert.equal(after.case_status, "Completed",
      "the finished state is 'Completed' — 'Cleared' is not a member of inquiry_case_status");
    assert.equal(after.open_inquiry_count, 0);
    assert.equal(after.master_call_state, "completed");
    assert.ok(after.cleared_at instanceof Date, "cleared_at is stamped");
    assert.ok(after.completed_at instanceof Date, "completed_at is stamped");

    const ev = await db.query(
      `SELECT COUNT(*)::int AS n FROM events WHERE name = 'inquiry.removed' AND client_id = $1`,
      [built.clientId]);
    assert.equal(ev.rows[0].n, 1,
      "the event fires — before the fix the enum error threw before this line was reached");

    await wipeCase();
  });

test("a case that is already finished is not re-completed", { skip: !HAS_DB }, async () => {
  await wipeCase();
  const built = await buildLinkedCase();
  await db.query(
    `UPDATE inquiry_removal_cases
        SET case_status = 'Canceled'::inquiry_case_status, updated_at = now()
      WHERE id = $1`, [built.caseRow.id]);

  await confirmRemoval(db, { orgId, inquiryId: built.inquiryId, staffId });

  const after = (await db.query(
    `SELECT case_status::text AS case_status FROM inquiry_removal_cases WHERE id = $1`,
    [built.caseRow.id])).rows[0];
  assert.equal(after.case_status, "Canceled", "a terminal case stays where it is");

  await wipeCase();
});
