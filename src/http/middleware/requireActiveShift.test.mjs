import { test } from "node:test";
import assert from "node:assert";
import {
  requireActiveShift,
  activeShift,
  attachShift,
  staffIdFrom,
  SHIFT_UNAVAILABLE
} from "./requireActiveShift.mjs";

const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const OPEN_SHIFT = {
  id: "33333333-3333-4333-8333-333333333333",
  org_id: "org-1",
  staff_id: STAFF_ID,
  started_at: new Date("2026-07-30T09:00:00Z"),
  ended_at: null
};

/* fakeDb — stands in for Postgres for the pure paths only. The real question
   ("does an open shifts row exist") is asked of a real database in
   requireActiveShift.pg.test.mjs; this fake exists to drive the branches a live
   database cannot be made to take on demand, principally the outage. */
function fakeDb({ open = true, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (throws) throw new Error("connection refused");
      return { rows: open ? [OPEN_SHIFT] : [] };
    }
  };
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const STAFF = { id: STAFF_ID, org_id: "org-1", role: "closer", email: "a@b.com", name: "A", status: "active" };
const principalOf = (staffId = STAFF_ID) => ({
  kind: "staff", staffId, orgId: "org-1", email: "a@b.com", name: "A", role: "closer",
  staff: { ...STAFF, id: staffId }
});

// ------------------------------------------------------- identity resolution

test("staffIdFrom reads the staff id requireAuth attaches at req.staff.id", () => {
  assert.deepEqual(staffIdFrom({ staff: STAFF }), { staffId: STAFF_ID, kind: "staff" });
});

test("staffIdFrom reads the staffId requirePrincipal returns, which it does not attach to the request", () => {
  // resolvePrincipal() calls authenticate() rather than attachStaff(), so a
  // handler using requirePrincipal has NO req.staff — the principal must be
  // passed in, and if this stopped working the gate would 401 every /api/shifts
  // -style handler in the repo.
  assert.deepEqual(staffIdFrom({ headers: {} }, { principal: principalOf() }),
    { staffId: STAFF_ID, kind: "staff" });
});

test("staffIdFrom prefers an explicitly passed principal over whatever is attached to the request", () => {
  const out = staffIdFrom({ staff: STAFF }, { principal: principalOf(OTHER_ID) });
  assert.equal(out.staffId, OTHER_ID,
    "the gate answered about a different person than the handler was serving");
});

test("staffIdFrom never borrows a non-staff principal's own id as a staff id", () => {
  // A client principal's `id` is an account id. Using it would be a lookup in
  // the wrong key space that returns zero rows and reads as "not clocked in".
  const out = staffIdFrom({}, { principal: { kind: "client", id: "client-abc", clientId: "client-abc" } });
  assert.equal(out.staffId, null);
  assert.equal(out.kind, "client", "the kind is reported so the gate can 403 rather than say 'clock in'");
});

test("staffIdFrom returns nulls rather than throwing on nothing at all", () => {
  for (const req of [undefined, null, {}, { headers: {} }, { staff: null }, { staff: {} }]) {
    assert.deepEqual(staffIdFrom(req), { staffId: null, kind: null }, JSON.stringify(req));
  }
});

// ------------------------------------------------------------- activeShift

test("activeShift returns the open shift and looks it up by the caller's own staff id", async () => {
  const db = fakeDb();
  const req = { staff: STAFF };
  const shift = await activeShift(req, { db });
  assert.equal(shift.id, OPEN_SHIFT.id);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].params[0], STAFF_ID,
    "the shift was looked up by something other than the session's staff id");
});

test("activeShift returns null when there is no open shift", async () => {
  assert.equal(await activeShift({ staff: STAFF }, { db: fakeDb({ open: false }) }), null);
});

test("a database failure is SHIFT_UNAVAILABLE, not null and not a throw", async () => {
  // The whole point. null here would mean "not clocked in", which a caller
  // upstream is free to turn into a pass or a 403 — either way the gate would
  // have made a claim about a fact it could not establish.
  const out = await activeShift({ staff: STAFF }, { db: fakeDb({ throws: true }) });
  assert.equal(out, SHIFT_UNAVAILABLE);
  assert.notEqual(out, null, "an outage must not look like nobody being clocked in");
  assert.notEqual(out, undefined);
});

test("activeShift issues no query at all when it cannot name a staff member", async () => {
  // currentShift(db, { staffId: undefined }) throws its own ShiftError, which
  // would land in the catch and be reported as a database outage. A wiring bug
  // must not masquerade as one.
  const db = fakeDb();
  assert.equal(await activeShift({}, { db }), null);
  assert.equal(db.calls.length, 0);
});

test("activeShift does not throw on a database failure, so a caller cannot forget to handle it", async () => {
  await assert.doesNotReject(() => activeShift({ staff: STAFF }, { db: fakeDb({ throws: true }) }));
});

// -------------------------------------------------------------- attachShift

test("attachShift hangs the shift off the request", async () => {
  const req = { staff: STAFF };
  const shift = await attachShift(req, { db: fakeDb() });
  assert.equal(shift.id, OPEN_SHIFT.id);
  assert.equal(req.shift.id, OPEN_SHIFT.id);
  assert.equal(req.shiftUnavailable, undefined);
});

test("attachShift leaves req.shift unset when nobody is clocked in", async () => {
  const req = { staff: STAFF };
  assert.equal(await attachShift(req, { db: fakeDb({ open: false }) }), null);
  assert.equal(req.shift, undefined, "a handler reading req.shift would have been handed a stale truthy value");
});

test("attachShift flags an outage on the request instead of losing the distinction", async () => {
  const req = { staff: STAFF };
  assert.equal(await attachShift(req, { db: fakeDb({ throws: true }) }), null);
  assert.equal(req.shiftUnavailable, true);
  assert.equal(req.shift, undefined);
});

// --------------------------------------------------------------- the gate

test("requireActiveShift returns the shift on success and writes no response", async () => {
  const res = fakeRes();
  const req = { staff: STAFF };
  const shift = await requireActiveShift(req, res, { db: fakeDb() });
  assert.equal(shift.id, OPEN_SHIFT.id);
  assert.equal(res.statusCode, null, "a response was written on the success path");
  assert.equal(req.shift.id, OPEN_SHIFT.id);
});

test("requireActiveShift works downstream of requirePrincipal, which attaches nothing", async () => {
  const res = fakeRes();
  const req = { headers: {} };
  const shift = await requireActiveShift(req, res, { db: fakeDb(), principal: principalOf() });
  assert.equal(shift.id, OPEN_SHIFT.id);
  assert.equal(res.statusCode, null);
});

test("no open shift is a 403 no_active_shift telling the caller to clock in", async () => {
  const res = fakeRes();
  const out = await requireActiveShift({ staff: STAFF }, res, { db: fakeDb({ open: false }) });
  assert.equal(out, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "no_active_shift");
  assert.match(res.body.message, /clock in/i,
    "the one 403 a real employee sees on a real morning must name the fix");
});

test("a database failure is a 503, NEVER a pass", async () => {
  // AUDIT-FINDINGS.md lesson 3: "absent config must never mean no gate." An
  // outage is absent config. This is the assertion that mutation-tests the
  // over-broad direction — a gate that returned the request through on an error
  // would pass every other test in this file.
  const res = fakeRes();
  const req = { staff: STAFF };
  const out = await requireActiveShift(req, res, { db: fakeDb({ throws: true }) });
  assert.equal(out, null, "the gate let a request through while the database was down");
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "shift_unavailable");
  assert.equal(res.body.db, "down",
    "public/app/data.js keys its 'backend unavailable' banner off status 503 or db:'down'");
  assert.equal(req.shift, undefined);
});

test("a database failure is not reported as 'you are not clocked in'", async () => {
  // The misleading answer: told to clock in, they press the button, that write
  // hits the same dead database.
  const res = fakeRes();
  await requireActiveShift({ staff: STAFF }, res, { db: fakeDb({ throws: true }) });
  assert.notEqual(res.statusCode, 403);
  assert.notEqual(res.body.error, "no_active_shift");
});

test("no principal at all is a 401 unauthorized — the sibling gates' own answer — and never a pass", async () => {
  // requireAuth answers a request it cannot identify with exactly this body.
  // The likelier cause here is a handler that forgot to call requirePrincipal
  // first; either way the gate could not name the person it is about, and the
  // one thing it must not do in that state is let the request through.
  const res = fakeRes();
  const db = fakeDb();
  const out = await requireActiveShift({ headers: {} }, res, { db });
  assert.equal(out, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
  assert.equal(db.calls.length, 0, "an unidentified request should not reach the database");
});

test("a client, affiliate or partner session is a 403 forbidden, not advice to clock in", async () => {
  // requirePrincipal's answer to a session of the wrong kind, reused verbatim.
  // There is no client clock-in button, so "clock in" would be unactionable.
  for (const kind of ["client", "affiliate", "partner"]) {
    const res = fakeRes();
    const db = fakeDb();
    const out = await requireActiveShift({}, res, { db, principal: { kind, id: "acct-1" } });
    assert.equal(out, null, kind);
    assert.equal(res.statusCode, 403, kind);
    assert.equal(res.body.error, "forbidden", kind);
    assert.notEqual(res.body.error, "no_active_shift", kind);
    assert.equal(db.calls.length, 0, kind);
  }
});

test("the refusal bodies carry no staff id, no email and no shift id", async () => {
  for (const [label, opts, req] of [
    ["no shift", { db: fakeDb({ open: false }) }, { staff: STAFF }],
    ["outage", { db: fakeDb({ throws: true }) }, { staff: STAFF }],
    ["no principal", { db: fakeDb() }, {}]
  ]) {
    const res = fakeRes();
    await requireActiveShift(req, res, opts);
    const blob = JSON.stringify(res.body);
    assert.ok(!blob.includes(STAFF_ID), label);
    assert.ok(!blob.includes(STAFF.email), label);
    assert.ok(!blob.includes(OPEN_SHIFT.id), label);
  }
});

test("every refusal uses the repo's { ok: false, error: snake_case } shape", async () => {
  for (const [label, opts, req] of [
    ["no shift", { db: fakeDb({ open: false }) }, { staff: STAFF }],
    ["outage", { db: fakeDb({ throws: true }) }, { staff: STAFF }],
    ["no principal", { db: fakeDb() }, {}],
    ["wrong kind", { db: fakeDb(), principal: { kind: "client" } }, {}]
  ]) {
    const res = fakeRes();
    await requireActiveShift(req, res, opts);
    assert.equal(res.body.ok, false, label);
    assert.match(res.body.error, /^[a-z][a-z0-9_]*$/, label);
  }
});

test("the gate never authenticates: it does not read headers or tokens", async () => {
  // It composes AFTER requireAuth/requirePrincipal and must not become a second
  // place that decides who you are. A bearer token alone gets nothing.
  const res = fakeRes();
  const db = fakeDb();
  const out = await requireActiveShift({ headers: { authorization: "Bearer whatever" } }, res, { db });
  assert.equal(out, null);
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.length, 0);
});
