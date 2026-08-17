// Unit tests for the clock-in / clock-out writer.
//
// SCOPE, STATED HONESTLY: these run against a recording stub, so they prove the
// argument checking, the error translation, the parameters each statement is
// issued with, and — the one that matters most here — that clockIn issues
// exactly one statement and never a check-then-insert. They do NOT prove that
// the database refuses a second open shift. That is a claim about Postgres and
// about migration 060, and it is attacked against a real Postgres in
// store.pg.test.mjs. A stub that re-implemented the unique index would only be
// testing itself, and this whole module exists because an index everyone
// believed enforced something did not.

import { test } from "node:test";
import assert from "node:assert";
import {
  clockIn,
  clockOut,
  currentShift,
  listOpenRoster,
  autoCloseStale,
  ShiftError,
  STALE_SHIFT_HOURS,
  AUTO_CLOSE_EVENT_KIND
} from "./store.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const SHIFT = "33333333-3333-4333-8333-333333333333";

/* Records every statement issued. `rows` is what the next query answers with;
   `throws` is an error the query raises instead, so the unique-violation path
   can be driven without a database. */
function stubDb({ rows = [{ id: SHIFT, org_id: ORG, staff_id: STAFF }], throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (throws) throw throws;
      return { rows };
    }
  };
}

const pgError = (code) => Object.assign(new Error(`stub pg error ${code}`), { code });

// --- the error class ---------------------------------------------------------

test("ShiftError carries an HTTP status and defaults to 400, like InquiryWriteError", () => {
  const e = new ShiftError("nope");
  assert.equal(e.name, "ShiftError");
  assert.equal(e.status, 400);
  assert.ok(e instanceof Error);
  assert.equal(new ShiftError("nope", { status: 409 }).status, 409);
});

// --- clockIn -----------------------------------------------------------------

test("clockIn: a missing org or staff id is refused rather than inserted as NULL", async () => {
  const db = stubDb();
  await assert.rejects(() => clockIn(db, { staffId: STAFF }), ShiftError);
  await assert.rejects(() => clockIn(db, { orgId: ORG }), ShiftError);
  await assert.rejects(() => clockIn(db, {}), (e) => e.status === 400);
  assert.equal(db.calls.length, 0, "nothing reaches the database once an argument is missing");
});

test("clockIn: the unique index is the gate — no SELECT-then-INSERT race window", async () => {
  const db = stubDb();
  await clockIn(db, { orgId: ORG, staffId: STAFF });
  assert.equal(db.calls.length, 1, "one statement, so two racing requests cannot both pass a check");
  assert.match(db.calls[0].sql, /^INSERT INTO shifts/);
});

test("clockIn: the org_id stored comes from the staff row, not from the caller's argument", async () => {
  const db = stubDb();
  await clockIn(db, { orgId: ORG, staffId: STAFF });
  assert.match(db.calls[0].sql, /SELECT s\.org_id, s\.id FROM staff s/);
  assert.match(db.calls[0].sql, /WHERE s\.id = \$2 AND s\.org_id = \$1/);
  assert.deepEqual(db.calls[0].params, [ORG, STAFF]);
});

test("clockIn: started_at is left to the column default, never sent by the caller", async () => {
  const db = stubDb();
  await clockIn(db, { orgId: ORG, staffId: STAFF });
  assert.doesNotMatch(db.calls[0].sql, /started_at/, "a caller-supplied start time is a caller-supplied timesheet");
});

test("clockIn: a duplicate open shift is a 409, not a 500", async () => {
  const db = stubDb({ throws: pgError("23505") });
  await assert.rejects(
    () => clockIn(db, { orgId: ORG, staffId: STAFF }),
    (e) => e instanceof ShiftError && e.status === 409 && /already has an open shift/.test(e.message)
  );
});

test("clockIn: an error that is not a unique violation is rethrown untouched", async () => {
  const boom = pgError("08006"); // connection failure
  const db = stubDb({ throws: boom });
  await assert.rejects(() => clockIn(db, { orgId: ORG, staffId: STAFF }), (e) => e === boom);
});

test("clockIn: an unknown staff member is a 404, not a 409 — nothing conflicted", async () => {
  const db = stubDb({ rows: [] });
  await assert.rejects(
    () => clockIn(db, { orgId: ORG, staffId: STAFF }),
    (e) => e instanceof ShiftError && e.status === 404
  );
});

test("clockIn returns the inserted shift row", async () => {
  const db = stubDb({ rows: [{ id: SHIFT, staff_id: STAFF, ended_at: null }] });
  assert.deepEqual(await clockIn(db, { orgId: ORG, staffId: STAFF }), { id: SHIFT, staff_id: STAFF, ended_at: null });
});

// --- clockOut ----------------------------------------------------------------

test("clockOut: a missing staff id is refused before any statement is issued", async () => {
  const db = stubDb();
  await assert.rejects(() => clockOut(db, {}), (e) => e instanceof ShiftError && e.status === 400);
  assert.equal(db.calls.length, 0);
});

test("clockOut only ever closes a shift that is still open", async () => {
  const db = stubDb();
  await clockOut(db, { staffId: STAFF });
  assert.match(db.calls[0].sql, /UPDATE shifts SET ended_at = now\(\)/);
  assert.match(db.calls[0].sql, /WHERE staff_id = \$1 AND ended_at IS NULL/);
  assert.deepEqual(db.calls[0].params, [STAFF]);
});

test("clockOut stamps the database's clock, never a time supplied by the caller", async () => {
  const db = stubDb();
  await clockOut(db, { staffId: STAFF });
  assert.equal(db.calls[0].params.length, 1, "the only parameter is the staff id");
});

test("clockOut with nothing open is a 409, not a silent success", async () => {
  const db = stubDb({ rows: [] });
  await assert.rejects(
    () => clockOut(db, { staffId: STAFF }),
    (e) => e instanceof ShiftError && e.status === 409 && /no open shift/.test(e.message)
  );
});

// --- currentShift ------------------------------------------------------------

test("currentShift returns null when nobody is clocked in rather than throwing", async () => {
  const db = stubDb({ rows: [] });
  assert.equal(await currentShift(db, { staffId: STAFF }), null);
});

test("currentShift considers only open shifts and returns a deterministic one", async () => {
  const db = stubDb();
  await currentShift(db, { staffId: STAFF });
  assert.match(db.calls[0].sql, /WHERE staff_id = \$1 AND ended_at IS NULL/);
  assert.match(db.calls[0].sql, /ORDER BY started_at DESC LIMIT 1/);
});

test("currentShift: a missing staff id is refused", async () => {
  await assert.rejects(() => currentShift(stubDb(), {}), ShiftError);
});

test("listOpenRoster excludes demo staff the same way sales-floor does", async () => {
  const db = stubDb({ rows: [] });
  await listOpenRoster(db, { orgId: ORG });
  assert.match(db.calls[0].sql, /COALESCE\(s\.is_demo,\s*false\)\s*=\s*false/);
  assert.match(db.calls[0].sql, /ended_at IS NULL/);
  assert.deepEqual(db.calls[0].params, [ORG]);
});

test("listOpenRoster: a missing org id is refused", async () => {
  await assert.rejects(() => listOpenRoster(stubDb(), {}), ShiftError);
});

// --- autoCloseStale ----------------------------------------------------------

test("the stale-shift threshold has exactly one definition, and it is the owner's 12 hours", async () => {
  assert.equal(typeof STALE_SHIFT_HOURS, "number");
  assert.ok(STALE_SHIFT_HOURS > 0);

  // 12 is the policy the owner set on 2026-07-31. It is pinned here rather than
  // left as "some positive number" because changing it changes when people's
  // forgotten shifts get closed, and that is a decision, not a refactor.
  assert.equal(STALE_SHIFT_HOURS, 12, "the stale-shift threshold is 12 hours by owner decision");

  // There is still no second threshold hiding under another name. One decided
  // rule, one export, so no call site can apply a different number by accident.
  const exported = Object.keys(await import("./store.mjs"));
  const thresholds = exported.filter((k) => /HOUR|STALE|THRESHOLD/.test(k));
  assert.deepEqual(thresholds, ["STALE_SHIFT_HOURS"]);
});

test("autoCloseStale takes the threshold as a parameter instead of hard-coding one", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, { olderThanHours: 3 });
  assert.equal(db.calls[0].params[0], 3);
});

test("autoCloseStale with no threshold applies the 12-hour policy, not a number of its own", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, {});
  assert.equal(db.calls[0].params[0], STALE_SHIFT_HOURS);
  assert.equal(db.calls[0].params[0], 12, "the default sent to Postgres is the owner's 12 hours");
});

test("autoCloseStale refuses a threshold of zero rather than closing every open shift", async () => {
  const db = stubDb({ rows: [] });
  await assert.rejects(() => autoCloseStale(db, { olderThanHours: 0 }), ShiftError);
  assert.equal(db.calls.length, 0);
});

test("autoCloseStale refuses a negative, NaN or non-numeric threshold", async () => {
  const db = stubDb({ rows: [] });
  for (const bad of [-1, NaN, Infinity, "12", "twelve", null, {}]) {
    await assert.rejects(
      () => autoCloseStale(db, { olderThanHours: bad }),
      (e) => e instanceof ShiftError,
      `olderThanHours=${JSON.stringify(bad)} must be rejected, not coerced`
    );
  }
  assert.equal(db.calls.length, 0, "a garbage threshold never becomes an interval");
});

test("autoCloseStale ends a shift at its last recorded activity, not at the sweep's clock", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, { olderThanHours: 8 });
  const sql = db.calls[0].sql;
  assert.match(sql, /SET ended_at\s+= a\.last_active_at/);
  assert.doesNotMatch(sql, /SET ended_at\s+= now\(\)/, "stamping the sweep's clock invents hours nobody worked");
  // Nor the idle window: the threshold is how long we wait before deciding they
  // left, not time they worked. Adding it would pay up to 8 hours of absence.
  assert.doesNotMatch(sql, /SET ended_at\s+= a\.last_active_at \+ make_interval/);
});

test("autoCloseStale closes on INACTIVITY, not on elapsed time since clock-in", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, { olderThanHours: 8 });
  const sql = db.calls[0].sql;
  // Spec §14, confirmed by the owner 2026-07-31: a closer working a 13-hour day
  // with activity must never be auto-closed. Gating on started_at did exactly
  // that — and then blocked their next clock-in via uq_shifts_one_open.
  assert.match(sql, /a\.last_active_at < now\(\) - make_interval/);
  assert.doesNotMatch(sql, /s\.started_at < now\(\) - make_interval/,
    "started_at is elapsed time; that is the rule this replaced");
});

test("autoCloseStale reads activity from staff_events and ignores its own sweep rows", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, { olderThanHours: 8 });
  const sql = db.calls[0].sql;
  assert.match(sql, /LEFT JOIN staff_events e/);
  assert.match(sql, /e\.shift_id = s\.id/);
  // A row this function wrote is not evidence the person was working.
  assert.match(sql, /e\.kind IS DISTINCT FROM \$2/);
  // No events at all means idle since clock-in — clocking in is itself an act,
  // so the shift is assessable rather than exempt.
  assert.match(sql, /COALESCE\(MAX\(e\.created_at\), s\.started_at\)/);
});

test("autoCloseStale records why each shift was closed in staff_events, in the same statement", async () => {
  const db = stubDb({ rows: [] });
  await autoCloseStale(db, { olderThanHours: 8 });
  assert.equal(db.calls.length, 1, "the close and its audit row cannot be separated by a crash");
  const sql = db.calls[0].sql;
  assert.match(sql, /INSERT INTO staff_events \(org_id, staff_id, shift_id, kind, detail\)/);
  assert.equal(db.calls[0].params[1], AUTO_CLOSE_EVENT_KIND);
  for (const key of ["threshold_hours", "started_at", "ended_at", "swept_at", "reason", "closed_by", "rule", "had_activity"]) {
    assert.match(sql, new RegExp(`'${key}'`), `the audit detail must record ${key}`);
  }
});

test("autoCloseStale returns the shifts it closed, and an empty sweep is an empty array", async () => {
  assert.deepEqual(await autoCloseStale(stubDb({ rows: [] }), { olderThanHours: 8 }), []);
  const closed = [{ id: SHIFT, staff_id: STAFF }];
  assert.deepEqual(await autoCloseStale(stubDb({ rows: closed }), { olderThanHours: 8 }), closed);
});
