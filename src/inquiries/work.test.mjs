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
import { logAttempt, confirmRemoval, setStatus, setExpectedName, InquiryWriteError } from "./work.mjs";

const INQUIRY = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const SHIFT = "55555555-5555-4555-8555-555555555555";

/* A stub that records every statement and answers the SELECT/RETURNING shapes
   these functions depend on. connect() is implemented so the transactional path
   is the one under test, not the fallback.

   `failOn` injects a database error at whichever statement it matches. It is
   how the telemetry tests below break the `staff_events` write specifically,
   without breaking the inquiry write that must survive it.

   `openShift` is what a `SELECT ... FROM shifts` answers, so the shift-id
   fallback can be driven both ways.

   THE staff_events AND shifts BRANCHES COME FIRST. The staff_events statement
   also contains RETURNING, so a generic /RETURNING/ test would answer it with
   an inquiry row and quietly hide which statement was actually issued. */
function stubDb({ found = true, failOn = null, openShift = null } = {}) {
  const calls = [];
  const client = {
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (failOn && failOn.test(sql)) {
        return Promise.reject(Object.assign(new Error("simulated outage"), { code: "08006" }));
      }
      if (/INSERT INTO staff_events/.test(sql)) {
        return { rows: [{ id: "ev-1", org_id: ORG, staff_id: params[0], shift_id: params[2], kind: params[3] }] };
      }
      if (/FROM orgs/.test(sql)) return { rows: [{ id: ORG }] };
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "bus-evt-1" }] };
      if (/FROM shifts/.test(sql)) return { rows: openShift ? [{ id: openShift }] : [] };
      if (/FOR UPDATE/.test(sql)) return { rows: found ? [{ id: INQUIRY, org_id: ORG }] : [] };
      if (/UPDATE inquiry_log/.test(sql) && /RETURNING/.test(sql)) {
        return { rows: found ? [{ id: INQUIRY, org_id: ORG, client_id: CLIENT, call_attempts: 1, case_id: null }] : [] };
      }
      if (/RETURNING/.test(sql)) {
        return { rows: found ? [{ id: INQUIRY, org_id: ORG, client_id: CLIENT, call_attempts: 1, case_id: null }] : [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: (s, p) => client.query(s, p) };
}

/** The staff_events statements a run issued, if any. */
const telemetryCalls = (db) => db.calls.filter((c) => /INSERT INTO staff_events/.test(c.sql));

/* logStaffEvent announces every skipped write on console.error. A test that
   expects a skip captures the line rather than printing it into the run, and
   asserts on it — a silent skip and a logged skip are different bugs. */
async function quietly(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try { return { value: await fn(), lines }; } finally { console.error = real; }
}

test("logAttempt requires an inquiry and a staff member", async () => {
  const db = stubDb();
  await assert.rejects(() => logAttempt(db, { orgId: ORG, staffId: STAFF }), InquiryWriteError);
  await assert.rejects(() => logAttempt(db, { orgId: ORG, inquiryId: INQUIRY }), (e) => e.status === 401);
});

test("logAttempt refuses an unknown kind rather than storing it", async () => {
  const db = stubDb();
  await assert.rejects(
    () => logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "telepathy" }),
    /unknown attempt kind/
  );
});

test("logAttempt runs in a transaction and locks the row first", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, outcome: "No answer" });

  const sqls = db.calls.map((c) => c.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.match(sqls[1], /FOR UPDATE/);
  assert.match(sqls[1], /org_id = \$2/);
  assert.deepEqual(db.calls[1].params, [INQUIRY, ORG]);
  assert.match(sqls[2], /INSERT INTO inquiry_attempts/);
  assert.match(sqls[3], /UPDATE inquiry_log/);
  assert.match(sqls[3], /org_id = \$4/);
  assert.equal(sqls[4], "COMMIT");
});

test("the counter is recomputed from the attempt rows, never incremented", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.match(update.sql, /call_attempts = \( SELECT count\(\*\) FROM inquiry_attempts/);
  assert.doesNotMatch(update.sql, /call_attempts \+ 1/);
});

test("a note does not carry an outcome onto the row", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "note", outcome: "Removed" });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.equal(update.params[1], null, "a working note must not rewrite the row's outcome");
});

test("a real attempt does carry its outcome", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "Left voicemail" });
  const update = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql));
  assert.equal(update.params[1], "Left voicemail");
});

test("a missing inquiry is a 404 and rolls back", async () => {
  const db = stubDb({ found: false });
  await assert.rejects(() => logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF }), (e) => e.status === 404);
  assert.ok(db.calls.some((c) => c.sql === "ROLLBACK"), "a failed attempt must not leave a partial write");
});

test("confirmRemoval attributes the confirmation and defaults the wording", async () => {
  const db = stubDb();
  await confirmRemoval(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF });
  const call = db.calls.find((c) => /UPDATE inquiry_log/.test(c.sql) && /confirmed_at/.test(c.sql));
  assert.ok(call, "expected inquiry_log confirmation update");
  assert.match(call.sql, /confirmed_at = now\(\)/);
  assert.match(call.sql, /org_id = \$4/);
  assert.match(call.sql, /is_open = false/);
  assert.deepEqual(call.params, [INQUIRY, STAFF, "Removed", ORG]);
  assert.equal(db.calls.some((c) => /INSERT INTO events/.test(c.sql)), false,
    "standalone inquiry confirm must not emit inquiry.removed (case-level only)");
});

test("setStatus clears confirmed_at when a row moves off a confirmed state", async () => {
  const db = stubDb();
  await setStatus(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, status: "Pending Removal" });
  assert.equal(db.calls.at(-1).params[3], false, "reopening must not keep a stale confirmation");
  assert.equal(db.calls.at(-1).params[4], ORG);

  await setStatus(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, status: "Removed" });
  assert.equal(db.calls.at(-1).params[3], true);
});

test("setStatus requires a non-empty status", async () => {
  const db = stubDb();
  await assert.rejects(() => setStatus(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, status: "  " }), /status is required/);
});

test("setExpectedName stores the staff-typed name and leaves the bureau string alone", async () => {
  const db = stubDb();
  await setExpectedName(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, expectedName: "Chase Ink" });
  const call = db.calls.find((c) => /expected_name/.test(c.sql));
  assert.ok(call);
  assert.equal(call.params[2], "Chase Ink");
  assert.doesNotMatch(call.sql, /inquiry_name/);
});

test("setExpectedName refuses a blank name", async () => {
  const db = stubDb();
  await assert.rejects(
    () => setExpectedName(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, expectedName: "  " }),
    /expected name is required/
  );
});

test("logAttempt refuses a missing orgId", async () => {
  const db = stubDb();
  await assert.rejects(
    () => logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF }),
    (e) => e.status === 403
  );
});

// =============================================================================
// STAFF TELEMETRY — the `staff_events` write this function now emits.
//
// src/shifts/telemetry.mjs had zero call sites, so `staff_events` was empty and
// autoCloseStale() — which measures idleness from that table — read every open
// shift as idle since clock-in. These are the two call sites that fill it.
//
// The ordering and the swallowing are the two things that matter here and both
// are asserted rather than described: the emit is after COMMIT, and a broken
// telemetry write does not fail the attempt it was observing.
// =============================================================================

test("a call attempt emits call_made, and a letter attempt emits letter_issued", async () => {
  for (const [attemptKind, eventKind] of [["call", "call_made"], ["letter", "letter_issued"]]) {
    const db = stubDb();
    await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: attemptKind, shiftId: SHIFT });
    const ev = telemetryCalls(db);
    assert.equal(ev.length, 1, `${attemptKind}: expected exactly one staff_events write`);
    assert.equal(ev[0].params[3], eventKind);
  }
});

test("a portal filing and a working note emit nothing — neither has a kind in the vocabulary", async () => {
  // `portal` is a real staff-performed action with no EVENT_KINDS equivalent and
  // is reported as a gap; filing it under letter_issued would make "letters
  // issued" a number nobody can trust. `note` is not an attempt at all.
  for (const kind of ["portal", "note"]) {
    const db = stubDb();
    await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind, shiftId: SHIFT });
    assert.equal(telemetryCalls(db).length, 0, `${kind} must not be filed under one of the other four kinds`);
  }
});

test("the telemetry row is written AFTER the commit, never inside the transaction", async () => {
  // Inside the transaction, a failed telemetry write would roll back the
  // attempt it describes, and a rolled-back attempt would still have said
  // "called". Both are one-way mistakes, so the position is asserted.
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT });
  const sqls = db.calls.map((c) => c.sql);
  const commit = sqls.indexOf("COMMIT");
  const emit = sqls.findIndex((s) => /INSERT INTO staff_events/.test(s));
  assert.ok(commit >= 0 && emit >= 0, "both statements must have been issued");
  assert.ok(emit > commit, "the staff_events write ran inside the transaction");
});

test("the caller's open shift is stamped on the event", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT });
  assert.equal(telemetryCalls(db)[0].params[2], SHIFT, "shift_id must be the shift the caller named");
  assert.equal(db.calls.filter((c) => /FROM shifts/.test(c.sql)).length, 0,
    "the HTTP layer already resolved the shift — looking it up again is a wasted query per action");
});

test("with no shift named, the open shift is looked up and used", async () => {
  const db = stubDb({ openShift: SHIFT });
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  assert.equal(telemetryCalls(db)[0].params[2], SHIFT);
});

test("work done off the clock is logged with a NULL shift, not refused", async () => {
  // NULL is a legitimate state: somebody worked a row without clocking in. A
  // telemetry writer that refuses it loses the record of the work entirely.
  const db = stubDb({ openShift: null });
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  const ev = telemetryCalls(db);
  assert.equal(ev.length, 1, "an unlinked event is still an event");
  assert.equal(ev[0].params[2], null);
});

test("an explicit shiftId of null is taken at its word and skips the lookup", async () => {
  const db = stubDb({ openShift: SHIFT });
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: null });
  assert.equal(telemetryCalls(db)[0].params[2], null);
  assert.equal(db.calls.filter((c) => /FROM shifts/.test(c.sql)).length, 0);
});

test("org_id comes off the inquiry row that was just written, never off the caller", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT });
  // params: [staffId, orgId-filter, shiftId, kind, detail]
  assert.equal(telemetryCalls(db)[0].params[1], ORG);
  assert.equal(telemetryCalls(db)[0].params[0], STAFF);
});

test("the detail carries the ids and the outcome, and never the free-text note", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG,
    inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT,
    outcome: "Left voicemail", note: "consumer said her SSN ends 1234"
  });
  const detail = JSON.parse(telemetryCalls(db)[0].params[4]);
  assert.equal(detail.inquiry_id, INQUIRY);
  assert.equal(detail.client_id, CLIENT);
  assert.equal(detail.attempt_kind, "call");
  assert.equal(detail.outcome, "Left voicemail");
  assert.equal(detail.attempt_no, 1);
  assert.equal(detail.note, undefined,
    "operator free text about a consumer's dispute must not be copied into a telemetry index");
});

test("an unknown outcome stays NULL rather than being recorded as a result", async () => {
  const db = stubDb();
  await logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", shiftId: SHIFT });
  assert.equal(JSON.parse(telemetryCalls(db)[0].params[4]).outcome, null);
});

// --- THE ONE THAT MATTERS MOST ----------------------------------------------

test("a database error on the telemetry write does NOT fail the attempt it observes", async () => {
  // The whole design constraint of src/shifts/telemetry.mjs, asserted from the
  // call site rather than trusted from its header. The failure is injected at
  // the staff_events INSERT only, so the inquiry write is untouched and a
  // failure here can only have come from telemetry.
  const db = stubDb({ failOn: /INSERT INTO staff_events/ });

  const { value: updated, lines } = await quietly(() =>
    logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "removed", shiftId: SHIFT })
  );

  assert.equal(updated.id, INQUIRY, "the attempt must still be returned when telemetry is broken");
  assert.equal(updated.call_attempts, 1);
  assert.ok(db.calls.some((c) => c.sql === "COMMIT"), "the attempt must still have committed");
  assert.ok(!db.calls.some((c) => c.sql === "ROLLBACK"), "a telemetry failure must not roll the attempt back");
  assert.ok(lines.some((l) => /\[telemetry\].*write_failed/.test(l)),
    `the swallowed failure must be logged, not silent: ${JSON.stringify(lines)}`);
});

test("a database error on the open-shift lookup does NOT fail the attempt either", async () => {
  // The lookup runs after the commit, so the attempt is already recorded. The
  // shift link is lost; the work is not.
  const db = stubDb({ failOn: /FROM shifts/ });

  const { value: updated, lines } = await quietly(() =>
    logAttempt(db, { orgId: ORG, inquiryId: INQUIRY, staffId: STAFF, kind: "call" })
  );

  assert.equal(updated.id, INQUIRY);
  assert.equal(telemetryCalls(db).length, 1, "the event is still written, with no shift attached");
  assert.equal(telemetryCalls(db)[0].params[2], null);
  assert.ok(lines.some((l) => /open-shift lookup failed/.test(l)), JSON.stringify(lines));
});
