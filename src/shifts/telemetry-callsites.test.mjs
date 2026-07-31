// The call sites, not the writer. telemetry.test.mjs proves logStaffEvent()
// behaves; this proves the four wired call sites call it — with the right kind,
// after the work, and never in a way that can fail the work.
//
// WHAT THESE TESTS ENCODE, AND WHY IT LOOKS LIKE SO FEW ROWS: two of the four
// kinds have no actor in this system. `pull_run` and `text_sent` are performed
// by Inngest workflows, which have an org and a client and no staff member, and
// `staff_events.staff_id` is NOT NULL. Both call sites are therefore wired to
// emit ONLY when an actor is named, and nothing names one today. The tests below
// assert the silence as deliberately as they assert the writes — a row appearing
// there would mean somebody invented an employee.

import { test } from "node:test";
import assert from "node:assert";
import { logAttempt } from "../inquiries/work.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { onAnalysisCompleted } from "../handlers/client-lifecycle.mjs";

const INQUIRY = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const SHIFT = "55555555-5555-4555-8555-555555555555";

/* One stub for all three call sites. It records every statement, so a test can
   assert both what was written and the ORDER it was written in. */
function stubDb({ openShift = SHIFT, clientFound = true, failStaffEvents = false } = {}) {
  const calls = [];
  const client = {
    query(sql, params = []) {
      const flat = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: flat, params });
      if (/INSERT INTO staff_events/.test(sql)) {
        if (failStaffEvents) throw new Error("staff_events is on fire");
        return { rows: [{ id: "ev-1", kind: params[3], staff_id: params[0], shift_id: params[2] }] };
      }
      if (/FROM shifts/.test(sql)) return { rows: openShift ? [{ id: openShift }] : [] };
      if (/FOR UPDATE/.test(sql)) return { rows: [{ id: INQUIRY, org_id: ORG }] };
      if (/UPDATE inquiry_log/.test(sql)) {
        return { rows: [{ id: INQUIRY, org_id: ORG, client_id: CLIENT, call_attempts: 3 }] };
      }
      if (/FROM clients WHERE id/.test(sql)) return { rows: clientFound ? [{ first_name: "Ada" }] : [] };
      if (/FROM message_templates/.test(sql)) return { rows: [{ body: "hi {{contact.first_name}}", subject: null }] };
      if (/FROM opt_outs|opted/i.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM crs_results/.test(sql)) return { rows: [] };
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      return { rows: [] };
    },
    release() {}
  };
  return {
    calls,
    connect: async () => client,
    query: (s, p) => client.query(s, p),
    staffEvents: () => calls.filter((c) => /INSERT INTO staff_events/.test(c.sql))
  };
}

/** The kind is the 4th bound parameter of the telemetry INSERT. */
const kindsWritten = (db) => db.staffEvents().map((c) => c.params[3]);

// ---------------------------------------------------------------------------
// call_made and letter_issued — the two that have a real actor
// ---------------------------------------------------------------------------

test("a logged call writes call_made, attributed to the person who made it", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call", outcome: "No answer" });

  assert.deepEqual(kindsWritten(db), ["call_made"]);
  const [staffParam, , shiftParam, , detail] = db.staffEvents()[0].params;
  assert.equal(staffParam, STAFF);
  assert.equal(shiftParam, SHIFT, "the work is linked to the shift the person is on");
  assert.deepEqual(JSON.parse(detail), {
    inquiry_id: INQUIRY, client_id: CLIENT, outcome: "No answer", attempt_no: 3
  });
});

test("a logged letter writes letter_issued", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "letter" });
  assert.deepEqual(kindsWritten(db), ["letter_issued"]);
  assert.equal(JSON.parse(db.staffEvents()[0].params[4]).outcome, null,
    "an outcome nobody knows yet stays null — it is not filled in");
});

test("a portal filing and a note write no telemetry row at all", async () => {
  // inquiry_attempts.kind includes `portal`, a real staff action, and
  // EVENT_KINDS has no word for it. Filing it under letter_issued would make the
  // letter count wrong. A note is explicitly not an attempt.
  for (const kind of ["portal", "note"]) {
    const db = stubDb();
    await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind });
    assert.deepEqual(kindsWritten(db), [], `${kind} must not be filed under another kind`);
  }
});

test("the telemetry row is written AFTER the commit, never inside the transaction", async () => {
  const db = stubDb();
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  const sqls = db.calls.map((c) => c.sql);
  const commit = sqls.indexOf("COMMIT");
  const telemetry = sqls.findIndex((s) => /INSERT INTO staff_events/.test(s));
  assert.ok(commit > -1 && telemetry > commit,
    "a row saying 'called' must not exist for a call whose transaction rolled back");
});

test("telemetry blowing up does not fail the attempt it is describing", async () => {
  const db = stubDb({ failStaffEvents: true });
  const updated = await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  assert.equal(updated.id, INQUIRY, "the work is the fact; the row is an index over it");
  assert.equal(updated.call_attempts, 3);
});

test("someone who is not clocked in still gets a row, with no shift on it", async () => {
  const db = stubDb({ openShift: null });
  await logAttempt(db, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  assert.deepEqual(kindsWritten(db), ["call_made"]);
  assert.equal(db.staffEvents()[0].params[2], null, "'not on a shift' is an answer, not a gap");
});

// ---------------------------------------------------------------------------
// text_sent — wired, and silent until a staff-initiated send exists
// ---------------------------------------------------------------------------

test("a workflow send writes no staff_events row, because a workflow is not a person", async () => {
  const db = stubDb();
  // Asserting on the absence of a ROW is not enough here: logStaffEvent() would
  // refuse a null staff id anyway, so the row count cannot tell a deliberate
  // skip from a swallowed failure. What it CAN tell is the noise — a swallowed
  // failure prints one "[telemetry] staff_events write skipped" line, and 39
  // workflow call sites would print one on every send forever. Silence is the
  // behaviour under test.
  const original = console.error;
  const noise = [];
  console.error = (...a) => noise.push(a.join(" "));
  try {
    const out = await sendTemplated(db, {
      orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: "n-01", eventId: "evt-1"
    });
    assert.equal(out.sent, true, "the message still goes");
  } finally {
    console.error = original;
  }
  assert.deepEqual(kindsWritten(db), [], "all 39 existing call sites land here");
  assert.deepEqual(noise.filter((l) => /\[telemetry\]/.test(l)), [],
    "an automated send must not even attempt a write it knows has no actor");
});

test("a send a person initiated writes text_sent", async () => {
  const db = stubDb();
  await sendTemplated(db, {
    orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: "n-01", eventId: "evt-1",
    staffId: STAFF, shiftId: SHIFT
  });
  assert.deepEqual(kindsWritten(db), ["text_sent"]);
  assert.deepEqual(JSON.parse(db.staffEvents()[0].params[4]),
    { client_id: CLIENT, template_key: "n-01", channel: "sms" });
});

test("an email a person initiated is not a text", async () => {
  const db = stubDb();
  await sendTemplated(db, {
    orgId: ORG, clientId: CLIENT, channel: "email", templateKey: "n-01", eventId: "evt-1", staffId: STAFF
  });
  assert.deepEqual(kindsWritten(db), [], "EVENT_KINDS has no word for an email");
});

// ---------------------------------------------------------------------------
// pull_run — wired, and silent until a pull has an actor
// ---------------------------------------------------------------------------

test("an automated pull writes no staff_events row, because nobody ran it", async () => {
  const db = stubDb();
  await onAnalysisCompleted({ id: "evt-9", orgId: ORG, clientId: CLIENT, payload: {} }, db);
  assert.ok(db.calls.some((c) => /INSERT INTO crs_results/.test(c.sql)), "the pull WAS stored");
  assert.deepEqual(kindsWritten(db), [],
    "a pull is requested by a workflow on diagnostic.paid — there is no employee to attribute it to");
});

test("a pull that names who ran it writes pull_run", async () => {
  const db = stubDb();
  await onAnalysisCompleted(
    { id: "evt-9", orgId: ORG, clientId: CLIENT, payload: { actorStaffId: STAFF, outcomeTier: "PREMIUM_STACK" } },
    db
  );
  assert.deepEqual(kindsWritten(db), ["pull_run"]);
  assert.deepEqual(JSON.parse(db.staffEvents()[0].params[4]),
    { client_id: CLIENT, event_id: "evt-9", outcome_tier: "PREMIUM_STACK" });
});

test("a replayed pull does not log a second one", async () => {
  const db = stubDb();
  db.connect = async () => ({ query: () => ({ rows: [] }), release() {} });
  const seen = {
    query(sql, params) {
      db.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/SELECT 1 FROM crs_results/.test(sql)) return { rows: [{ "?column?": 1 }] };  // already stored
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      return { rows: [] };
    }
  };
  const wrapped = { ...db, query: seen.query, staffEvents: db.staffEvents };
  await onAnalysisCompleted(
    { id: "evt-9", orgId: ORG, clientId: CLIENT, payload: { actorStaffId: STAFF } },
    wrapped
  );
  assert.deepEqual(kindsWritten(db), [], "replay must not count the same pull twice");
});
