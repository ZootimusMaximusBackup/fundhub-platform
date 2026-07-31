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

const CLIENT = "44444444-4444-4444-8444-444444444444";
const SHIFT = "55555555-5555-4555-8555-555555555555";

/* A stub that records every statement and answers the two SELECT/RETURNING
   shapes these functions depend on. connect() is implemented so the
   transactional path is the one under test, not the fallback.

   `telemetryFails` makes the staff_events INSERT throw, so the tests below can
   prove that a broken telemetry write does not take the attempt with it. */
function stubDb({ found = true, telemetryFails = false } = {}) {
  const calls = [];
  const client = {
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/INSERT INTO staff_events/.test(sql)) {
        if (telemetryFails) throw new Error("staff_events is on fire");
        return { rows: [{ id: "event", kind: params[3] }] };
      }
      if (/FOR UPDATE/.test(sql)) return { rows: found ? [{ id: INQUIRY, org_id: ORG }] : [] };
      if (/RETURNING/.test(sql)) {
        return { rows: found ? [{ id: INQUIRY, org_id: ORG, client_id: CLIENT, call_attempts: 1 }] : [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: (s, p) => client.query(s, p) };
}

/** The one staff_events statement in a run, or undefined. */
const telemetryCall = (db) => db.calls.find((c) => /INSERT INTO staff_events/.test(c.sql));

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

/* ---------------------------------------------------------------------------
   STAFF TELEMETRY. logAttempt() is the only place in this repository where a
   real employee's action reaches `staff_events`; these guard the two ways that
   can go wrong. Emitting for the wrong attempt kind puts a number in front of a
   manager that nobody can reconcile, and emitting inside the transaction lets a
   telemetry failure destroy the attempt it was only supposed to describe.
   --------------------------------------------------------------------------- */

test("a call emits call_made, after the commit and never inside it", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "No answer", shiftId: SHIFT });

  const sqls = db.calls.map((c) => c.sql);
  const commit = sqls.indexOf("COMMIT");
  const emit = sqls.findIndex((s) => /INSERT INTO staff_events/.test(s));
  assert.ok(emit > -1, "a logged call must be counted");
  assert.ok(commit > -1 && emit > commit, "telemetry inside the transaction can roll the attempt back");

  const call = telemetryCall(db);
  assert.equal(call.params[3], "call_made");
});

test("a letter emits letter_issued, not call_made", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "letter", outcome: "Mailed" });
  assert.equal(telemetryCall(db).params[3], "letter_issued");
});

test("a note emits nothing — it is not an attempt and must not be counted as one", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "note", note: "Client called back" });
  assert.equal(telemetryCall(db), undefined);
});

test("a portal filing emits nothing — there is no kind for it, and it is not a letter", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "portal", outcome: "Filed" });
  assert.equal(telemetryCall(db), undefined,
    "borrowing letter_issued for a portal filing would make the letter count wrong");
});

test("the shift the work fell on is stamped on the event, and is null when there is none", async () => {
  const withShift = stubDb();
  await logAttempt(withShift, { inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT });
  assert.equal(telemetryCall(withShift).params[2], SHIFT);

  const without = stubDb();
  await logAttempt(without, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  assert.equal(telemetryCall(without).params[2], null, "unlinked is honest; invented is not");
});

test("the event carries the row it describes, and an unknown outcome stays unknown", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  const detail = JSON.parse(telemetryCall(db).params[4]);
  assert.equal(detail.inquiry_id, INQUIRY);
  assert.equal(detail.client_id, CLIENT);
  assert.equal(detail.attempt_no, 1);
  assert.equal(detail.outcome, null, "no outcome recorded yet must not become an outcome");
});

test("telemetry blowing up does not lose the attempt it was describing", async () => {
  const db = stubDb({ telemetryFails: true });
  const row = await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "No answer" });

  assert.equal(row.id, INQUIRY, "the attempt is the fact; the event is only an index over it");
  assert.ok(db.calls.some((c) => c.sql === "COMMIT"), "and it must still be committed");
  assert.ok(!db.calls.some((c) => c.sql === "ROLLBACK"));
});
