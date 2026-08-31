// "NEXT 11:00 AM", AGAINST REAL SQL.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// The call screen prints one line beside the client's name: the time of this
// call, how long until it, and the time of the call after it. The last part was
// picked off the up_next[] array, and up_next cannot answer that question. Its
// ORDER BY is
//
//     ORDER BY CASE WHEN t.client_id = $3 THEN 0 ELSE 1 END, t.due_at ASC
//
// which forces every one of the OPEN client's tasks to the front of the list
// whatever the clock says, and then LIMIT 5 cuts it. Three ordinary days were
// measured against a real Postgres on 2026-08-31 and each one printed something
// false:
//
//   A) Open client booked 3:00 PM. Somebody else at 11:00 AM.
//      Array order: 3:00 PM, 11:00 AM. The screen said "next 11:00 AM" —
//      four hours BEFORE the call it was printed beside.
//
//   B) Open client has 10:00 AM and 4:00 PM. Somebody else at 11:00 AM.
//      Array order: 10:00 AM, 4:00 PM, 11:00 AM. The screen said "next 4:00 PM".
//      The closer's real next appointment was never named. That reads as six
//      hours of runway when there is one.
//
//   C) Open client at 3:00 PM, five other calls at 9, 10, 11, 12 and 4:00 PM.
//      LIMIT 5 keeps 3:00 PM, 9, 10, 11, 12 and DROPS the 4:00 PM. Sorting the
//      array by time — the obvious fix — still answers "nothing after this",
//      which is false. C is why this is a query and not a loop: the honest
//      answer is not in that array at any ordering.
//
// These assertions cannot be made against a stub, because what is being tested
// IS the SQL: an ORDER BY, a strict `>` and a LIMIT.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { pool, close } from "../db.mjs";
import { upcomingCalls, nextCallAfter } from "./cockpit.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const TAG = "next-call-pg-test";

let db = null;
let ORG = null;
let STAFF = null;
let OPEN = null;   // the client whose screen is open
let OTHER = null;  // somebody else on the same closer's day

/** A task at N hours past midnight today, on this closer's list. */
async function task(clientId, hours, title) {
  const r = await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee_role, assignee_staff_id, title, body, due_at)
     VALUES ($1, $2, 'closer', $3, $4, $5, date_trunc('day', now()) + ($6 || ' hours')::interval)
     RETURNING id, due_at`,
    [ORG, clientId, STAFF, title, `${TAG}-${title}`, String(hours)]
  );
  return r.rows[0];
}

/* Rows are compared BY TASK ID, never by a clock string. due_at is built with
   date_trunc('day', now()), which is midnight in the database's own time zone —
   formatting it in the runner's zone makes an assertion that passes in one
   place and fails in another, and says nothing about the ordering under test. */
const same = (row, task) => !!row && !!task && String(row.task_id || row.id) === String(task.id);

/** Wipe the day between scenarios. */
async function clearDay() {
  await db.query(`DELETE FROM tasks WHERE org_id = $1 AND body LIKE $2`, [ORG, `${TAG}-%`]);
}

before(async () => {
  if (!HAS_DB) return;
  db = await pool().connect();
  await db.query("BEGIN");
  ORG = (await db.query(`SELECT id FROM orgs WHERE slug = 'fundhub'`)).rows[0].id;
  STAFF = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, 'Next Call Closer', $2, 'closer', 'active') RETURNING id`,
    [ORG, `${TAG}-closer@example.com`])).rows[0].id;
  OPEN = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Open', 'Client') RETURNING id`,
    [ORG, `${TAG}-open@example.com`])).rows[0].id;
  OTHER = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Other', 'Client') RETURNING id`,
    [ORG, `${TAG}-other@example.com`])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await db.query("ROLLBACK");
  db.release();
  await close();
});

// ---------------------------------------------------------------------------
test("up_next really is out of time order — this is the trap, on the record",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const threePm = await task(OPEN, 15, "A-open-3pm");
    const elevenAm = await task(OTHER, 11, "A-other-11am");

    const list = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.equal(list.length, 2);
    assert.ok(same(list[0], threePm),
      "the open client's task is forced to the head of up_next whatever the clock says");
    assert.ok(same(list[1], elevenAm),
      "…so element [1] is EARLIER than element [0]. Anything that reads 'the next call' " +
      "off this array is reading a list that is not in time order.");
    assert.ok(new Date(list[1].due_at) < new Date(list[0].due_at),
      "measured, not assumed: the second row really is the earlier time");
  });

test("A) the call after a 3:00 PM is not the 11:00 AM that sits in front of it in the array",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 15, "A2-open-3pm");
    await task(OTHER, 11, "A2-other-11am");

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.equal(next, null,
      "there is genuinely nothing after 3:00 PM. The old code printed 'next 11:00 AM' — " +
      "a time four hours BEFORE the call it was printed beside.");
  });

test("B) the closer's real next appointment is named, not this client's later one",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 10, "B-open-10am");
    await task(OPEN, 16, "B-open-4pm");
    const elevenAm = await task(OTHER, 11, "B-other-11am");

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.ok(next, "there is a call after 10:00 AM");
    assert.ok(same(next, elevenAm),
      "the old code said 'next 4:00 PM' because this client's own 4:00 PM sorts ahead of " +
      "somebody else's 11:00 AM in up_next. A closer reading 4:00 PM believes they have six " +
      "hours of runway. They have one.");
  });

test("C) a later call the LIMIT 5 drops is still found — sorting the array cannot do this",
  { skip: !HAS_DB }, async () => {
    await clearDay();
    const cur = await task(OPEN, 15, "C-open-3pm");
    for (const h of [9, 10, 11, 12]) await task(OTHER, h, `C-other-${h}`);
    const fourPm = await task(OTHER, 16, "C-other-4pm");

    const list = await upcomingCalls(db, { orgId: ORG, staffId: STAFF, includeClientId: OPEN });
    assert.equal(list.length, 5, "LIMIT 5");
    assert.ok(
      !list.some((r) => same(r, fourPm)),
      "the 4:00 PM is cut off the array — so no amount of sorting it finds this call"
    );

    const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
    assert.ok(next, '"nothing after this" would have been a lie here');
    assert.ok(same(next, fourPm));
  });

test("a call already logged is not the next one", { skip: !HAS_DB }, async () => {
  await clearDay();
  const cur = await task(OPEN, 10, "D-open-10am");
  const done = await task(OTHER, 11, "D-other-11am-logged");
  const noon = await task(OTHER, 12, "D-other-12pm");
  await db.query(
    `INSERT INTO call_outcomes (org_id, client_id, staff_id, task_id, outcome)
     VALUES ($1, $2, $3, $4, 'no_show')`,
    [ORG, OTHER, STAFF, done.id]
  );

  const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
  assert.ok(same(next, noon),
    "an appointment that has already been dispositioned is not still coming up");
});

test("the current call cannot be its own next call", { skip: !HAS_DB }, async () => {
  await clearDay();
  const cur = await task(OPEN, 10, "E-open-10am");
  const next = await nextCallAfter(db, { orgId: ORG, staffId: STAFF, after: cur.due_at });
  assert.equal(next, null, "strictly after, so the open call never names itself");
});
