// Unit tests for the inquiry write path.
//
// SCOPE, STATED HONESTLY: these use a recording stub, so they prove the
// argument checking, the transaction shape, and which parameters each statement
// is issued with. They do NOT prove the SQL means what it says — recomputing
// call_attempts from the attempt rows is a claim about Postgres, and it is
// tested against Postgres in work.pg.test.mjs. A fake that re-implemented the
// counting would only be testing itself.

import { test } from "node:test";
import assert from "node:assert";
import { logAttempt, confirmRemoval, setStatus, InquiryWriteError } from "./work.mjs";

const INQUIRY = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

/* A stub that records every statement and answers the two SELECT/RETURNING
   shapes these functions depend on. connect() is implemented so the
   transactional path is the one under test, not the fallback. */
function stubDb({ found = true } = {}) {
  const calls = [];
  const client = {
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/FOR UPDATE/.test(sql)) return { rows: found ? [{ id: INQUIRY, org_id: ORG }] : [] };
      if (/RETURNING/.test(sql)) return { rows: found ? [{ id: INQUIRY, call_attempts: 1 }] : [] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: (s, p) => client.query(s, p) };
}

test("logAttempt requires an inquiry and a staff member", async () => {
  const db = stubDb();
  await assert.rejects(() => logAttempt(db, { staffId: STAFF }), InquiryWriteError);
  await assert.rejects(() => logAttempt(db, { inquiryId: INQUIRY }), (e) => e.status === 401);
});

test("logAttempt refuses an unknown kind rather than storing it", async () => {
  const db = stubDb();
  await assert.rejects(
    () => logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "telepathy" }),
    /unknown attempt kind/
  );
});

test("logAttempt runs in a transaction and locks the row first", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, outcome: "No answer" });

  const sqls = db.calls.map((c) => c.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.match(sqls[1], /FOR UPDATE/);
  assert.match(sqls[2], /INSERT INTO inquiry_attempts/);
  assert.match(sqls[3], /UPDATE inquiry_log/);
  assert.equal(sqls[4], "COMMIT");
});

test("the counter is recomputed from the attempt rows, never incremented", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.match(update.sql, /call_attempts = \( SELECT count\(\*\) FROM inquiry_attempts/);
  assert.doesNotMatch(update.sql, /call_attempts \+ 1/);
});

test("a note does not carry an outcome onto the row", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "note", outcome: "Removed" });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.equal(update.params[1], null, "a working note must not rewrite the row's outcome");
});

test("a real attempt does carry its outcome", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "Left voicemail" });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.equal(update.params[1], "Left voicemail");
});

test("a missing inquiry is a 404 and rolls back", async () => {
  const db = stubDb({ found: false });
  await assert.rejects(() => logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF }), (e) => e.status === 404);
  assert.ok(db.calls.some((c) => c.sql === "ROLLBACK"), "a failed attempt must not leave a partial write");
});

test("confirmRemoval attributes the confirmation and defaults the wording", async () => {
  const db = stubDb();
  await confirmRemoval(db, { inquiryId: INQUIRY, staffId: STAFF });
  const call = db.calls.at(-1);
  assert.match(call.sql, /confirmed_at = now\(\)/);
  assert.deepEqual(call.params, [INQUIRY, STAFF, "Removed"]);
});

test("setStatus clears confirmed_at when a row moves off a confirmed state", async () => {
  const db = stubDb();
  await setStatus(db, { inquiryId: INQUIRY, staffId: STAFF, status: "Pending Removal" });
  assert.equal(db.calls.at(-1).params[3], false, "reopening must not keep a stale confirmation");

  await setStatus(db, { inquiryId: INQUIRY, staffId: STAFF, status: "Removed" });
  assert.equal(db.calls.at(-1).params[3], true);
});

test("setStatus requires a non-empty status", async () => {
  const db = stubDb();
  await assert.rejects(() => setStatus(db, { inquiryId: INQUIRY, staffId: STAFF, status: "  " }), /status is required/);
});
