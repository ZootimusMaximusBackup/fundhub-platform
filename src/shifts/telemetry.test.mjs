// Unit tests for the staff telemetry writer: the vocabulary it will accept, the
// column names it writes, and — the point of the module — the fact that nothing
// it does can throw into the business action it is observing.
//
// What is asserted against a real database instead lives in telemetry.pg.test.mjs:
// that the row actually lands, that org_id comes off the staff row, and that a
// foreign key violation is swallowed. A fake that models the schema I wish
// existed cannot fail when the real schema moves (AUDIT-FINDINGS), so the
// statements here are checked for what they say, not for what Postgres does
// with them.

import { test } from "node:test";
import assert from "node:assert";
import { EVENT_KINDS, isEventKind, assertKind, logStaffEvent } from "./telemetry.mjs";

// Records every statement; returns whatever the caller stubs.
function recordingDb(result = { rows: [{ id: "ev-1" }] }) {
  const calls = [];
  return {
    calls,
    last: () => calls[calls.length - 1],
    async query(sql, params) {
      calls.push({ sql, params });
      return typeof result === "function" ? result(sql, params) : result;
    }
  };
}

// Every test in this file provokes a console.error on the swallow paths, which
// is the module working as designed and is pure noise in the test output.
function quietly(fn) {
  const real = console.error;
  const lines = [];
  console.error = (msg) => lines.push(String(msg));
  return fn().finally(() => { console.error = real; }).then((v) => ({ value: v, lines }));
}

const OK = { staffId: "11111111-1111-1111-1111-111111111111", kind: "call_made" };

// --- the vocabulary -----------------------------------------------------------

test("EVENT_KINDS is exactly the five kinds named in the 001_init.sql column comment", () => {
  assert.deepEqual([...EVENT_KINDS], [
    "file_touched", "pull_run", "letter_issued", "text_sent", "call_made"
  ]);
});

test("EVENT_KINDS is frozen, so a call site cannot mint a kind by pushing onto it", () => {
  assert.throws(() => EVENT_KINDS.push("whatever"), TypeError);
  assert.equal(EVENT_KINDS.length, 5);
});

test("the trailing '...' in the schema comment is an ellipsis, not a sixth kind", () => {
  assert.equal(isEventKind("..."), false);
  assert.equal(isEventKind(""), false);
});

test("assertKind throws for a kind nobody catalogued — the dev-time half of the check", () => {
  assert.equal(assertKind("pull_run"), "pull_run");
  assert.throws(() => assertKind("pull-run"), TypeError, "a hyphen is a different word");
  assert.throws(() => assertKind("PULL_RUN"), TypeError, "and so is a different case");
  assert.throws(() => assertKind(undefined), TypeError);
});

test("shift_auto_closed is deliberately NOT in the vocabulary, even though store.mjs writes it", () => {
  // src/shifts/store.mjs autoCloseStale() writes that kind through its own SQL.
  // Copying the token here to make the two agree would be inventing a
  // vocabulary decision nobody made — see the note on EVENT_KINDS.
  assert.equal(isEventKind("shift_auto_closed"), false);
});

// --- the columns --------------------------------------------------------------

test("the insert names kind and detail — never event_type or event_data", async () => {
  const db = recordingDb();
  await logStaffEvent(db, { ...OK, orgId: "org-1", detail: { inquiry_id: "iq-1" } });
  const { sql } = db.last();
  assert.match(sql, /INSERT INTO staff_events \(org_id, staff_id, shift_id, kind, detail\)/);
  assert.equal(/event_type|event_data/i.test(sql), false, "those columns do not exist on this table");
});

test("the org written is the staff row's own, never the argument", async () => {
  const db = recordingDb();
  await logStaffEvent(db, { ...OK, orgId: "org-1" });
  const { sql, params } = db.last();
  assert.match(sql, /SELECT s\.org_id/, "the stored org comes off the staff row");
  assert.match(sql, /s\.org_id = \$2/, "and the argument is only a filter");
  assert.equal(params[1], "org-1");
});

test("orgId is optional, and omitting it does not write a null org", async () => {
  const db = recordingDb();
  const res = await logStaffEvent(db, OK);
  assert.equal(res.logged, true);
  assert.equal(db.last().params[1], null, "the filter is skipped");
  assert.match(db.last().sql, /\$2::uuid IS NULL OR/, "a null filter matches the staff member's own org");
});

test("shiftId is optional because the column is a nullable FK and 'not on a shift' is an answer", async () => {
  const db = recordingDb();
  await logStaffEvent(db, OK);
  assert.equal(db.last().params[2], null);
  await logStaffEvent(db, { ...OK, shiftId: "sh-1" });
  assert.equal(db.last().params[2], "sh-1");
});

test("detail defaults to the empty object the column itself defaults to", async () => {
  const db = recordingDb();
  await logStaffEvent(db, OK);
  assert.equal(db.last().params[4], "{}");
  await logStaffEvent(db, { ...OK, detail: null });
  assert.equal(db.last().params[4], "{}", "an explicit null is the same as absent, not a null jsonb");
});

test("detail is serialised as jsonb, with its keys intact", async () => {
  const db = recordingDb();
  await logStaffEvent(db, { ...OK, detail: { inquiry_id: "iq-1", outcome: null } });
  assert.deepEqual(JSON.parse(db.last().params[4]), { inquiry_id: "iq-1", outcome: null },
    "a null inside the detail survives — it means unknown");
});

test("a successful write returns the row it wrote", async () => {
  const db = recordingDb({ rows: [{ id: "ev-9", kind: "call_made" }] });
  const res = await logStaffEvent(db, OK);
  assert.deepEqual(res, { logged: true, event: { id: "ev-9", kind: "call_made" } });
});

// --- nothing here may fail the business action --------------------------------

test("an unknown kind is refused quietly and nothing is sent to the database", async () => {
  const db = recordingDb();
  const { value, lines } = await quietly(() => logStaffEvent(db, { ...OK, kind: "coffee_made" }));
  assert.deepEqual(value, { logged: false, reason: "unknown_kind" });
  assert.equal(db.calls.length, 0, "an unvalidated kind never reaches the free-text column");
  assert.equal(lines.length, 1, "but it is logged, so it is not invisible");
});

test("a missing staffId is refused before the NOT NULL has to catch it", async () => {
  const db = recordingDb();
  const { value } = await quietly(() => logStaffEvent(db, { kind: "call_made" }));
  assert.equal(value.logged, false);
  assert.equal(value.reason, "missing_staff_id");
  assert.equal(db.calls.length, 0);
});

test("a database failure is swallowed: telemetry never fails the action it observes", async () => {
  const db = { async query() { throw Object.assign(new Error("connection terminated"), { code: "57P01" }); } };
  const { value, lines } = await quietly(() => logStaffEvent(db, OK));
  assert.deepEqual(value, { logged: false, reason: "write_failed" });
  assert.match(lines[0], /connection terminated/, "the real error is written down, not discarded");
});

test("a foreign key violation is swallowed the same way — a bad shift_id loses the row, not the call", async () => {
  const db = { async query() { throw Object.assign(new Error("violates foreign key constraint"), { code: "23503" }); } };
  const { value } = await quietly(() => logStaffEvent(db, { ...OK, shiftId: "22222222-2222-2222-2222-222222222222" }));
  assert.equal(value.logged, false);
  assert.equal(value.reason, "write_failed");
});

test("a staff id that matches nothing is not an error and is not an oracle", async () => {
  const db = recordingDb({ rows: [] });
  const { value } = await quietly(() => logStaffEvent(db, { ...OK, orgId: "other-org" }));
  assert.deepEqual(value, { logged: false, reason: "staff_not_found" },
    "no such staff member and wrong org give the same answer");
});

test("an unserialisable detail loses the row rather than throwing out of the call site", async () => {
  const circular = { a: 1 };
  circular.self = circular;
  const db = recordingDb();
  const { value } = await quietly(() => logStaffEvent(db, { ...OK, detail: circular }));
  assert.deepEqual(value, { logged: false, reason: "undetailable" });
  assert.equal(db.calls.length, 0);
});

test("a detail that is not a plain object is refused, so every reader sees one shape", async () => {
  const db = recordingDb();
  for (const bad of ["a note", 42, true, ["a"]]) {
    const { value } = await quietly(() => logStaffEvent(db, { ...OK, detail: bad }));
    assert.equal(value.reason, "invalid_detail", `detail=${JSON.stringify(bad)}`);
  }
  assert.equal(db.calls.length, 0);
});

test("called with no arguments at all it still does not throw", async () => {
  const db = recordingDb();
  const { value } = await quietly(() => logStaffEvent(db));
  assert.equal(value.logged, false);
  const { value: noDb } = await quietly(() => logStaffEvent(undefined, OK));
  assert.equal(noDb.logged, false, "not even a missing db handle escapes as a throw");
  assert.equal(noDb.reason, "write_failed");
});

test("every refusal answers with the same shape, so a caller can branch on one field", async () => {
  const db = recordingDb({ rows: [] });
  const cases = [
    { kind: "call_made" },                                  // missing_staff_id
    { ...OK, kind: "nope" },                                // unknown_kind
    { ...OK, detail: 7 },                                   // invalid_detail
    { ...OK }                                               // staff_not_found
  ];
  for (const args of cases) {
    const { value } = await quietly(() => logStaffEvent(db, args));
    assert.equal(value.logged, false);
    assert.equal(typeof value.reason, "string");
    assert.equal("event" in value, false, "a failure never carries a half-built row");
  }
});
