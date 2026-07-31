// Real-Postgres tests for the "no active shift, no dashboard actions" gate.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT THIS PROVES THAT requireActiveShift.test.mjs CANNOT.
//
// The unit tests drive the gate's branches through a fake `db` that returns the
// rows the test wants. That fake is a model of the `shifts` table, and
// AUDIT-FINDINGS.md lesson 1 is that a fake modelling the schema you wish you
// had cannot fail when the schema moves. Everything below runs against the real
// table: the open shift is a real row, "no open shift" is a real absence, and
// the transitions between them go through the real clockIn/clockOut writers, so
// a rename of `ended_at` or a change to what "open" means breaks these tests
// rather than passing them.
//
// THE OUTAGE CASE IS A REAL POSTGRES FAILURE, NOT A STUB THAT THROWS. A client
// whose transaction has been aborted rejects every subsequent statement with
// SQLSTATE 25P02. That is an error produced by the database, on a live
// connection, from a query this repo wrote — which is the only way to be sure
// the gate 503s on the kind of failure it will actually meet rather than on a
// synthetic Error somebody threw on its behalf.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close, pool } from "../../db.mjs";
import { clockIn, clockOut } from "../../shifts/store.mjs";
import { requireActiveShift, activeShift, SHIFT_UNAVAILABLE } from "./requireActiveShift.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const EMAIL_ON = "require_active_shift_pg_test@example.com";
const EMAIL_OFF = "require_active_shift_pg_test_off@example.com";
const EMAIL_LIKE = "require_active_shift_pg_test%@example.com";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

describe("requireActiveShift against real Postgres", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId = null;
  let onShift = null;   // clocked in
  let offShift = null;  // never clocked in

  async function wipe() {
    // staff_events.shift_id is ON DELETE SET NULL, so events go before shifts.
    // shifts.staff_id and sessions.staff_id are ON DELETE CASCADE, so deleting
    // the staff rows takes the rest. Run before as well as after: a crashed
    // previous run must not collide with the staff email unique index.
    await db.query(
      `DELETE FROM staff_events WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [EMAIL_LIKE]);
  }

  before(async () => {
    await wipe();
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    // Fixture staff CREATED, not looked up. `SELECT id FROM staff LIMIT 1` on a
    // fresh database returns nothing, and every assertion below would then be
    // asserting about undefined.
    const mk = async (email, name) => (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1,$2,$3,'closer','active') RETURNING id`, [orgId, name, email])).rows[0].id;

    onShift = await mk(EMAIL_ON, "Active Shift Gate On");
    offShift = await mk(EMAIL_OFF, "Active Shift Gate Off");
  });

  after(async () => { await wipe(); await close(); });

  const staffReq = (id) => ({ staff: { id, org_id: orgId, role: "closer" } });
  const principalReq = (id) => [{ headers: {} }, { db, principal: { kind: "staff", staffId: id, orgId } }];

  // ── the gate, closed ──────────────────────────────────────────────────────

  test("a staff member who has never clocked in is refused with 403 no_active_shift", async () => {
    const open = (await db.query(
      `SELECT id FROM shifts WHERE staff_id=$1 AND ended_at IS NULL`, [offShift])).rows;
    assert.equal(open.length, 0, "precondition: no open shift row exists for this person");

    const r = res();
    const out = await requireActiveShift(staffReq(offShift), r, { db });
    assert.equal(out, null);
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "no_active_shift");
    assert.match(r.body.message, /clock in/i);
  });

  // ── the gate, open ────────────────────────────────────────────────────────

  test("clocking in opens the gate, and the shift the gate returns is the row in the table", async () => {
    const row = await clockIn(db, { orgId, staffId: onShift });

    const req = staffReq(onShift);
    const r = res();
    const shift = await requireActiveShift(req, r, { db });

    assert.equal(r.code, null, "a response was written on the success path");
    assert.ok(shift, "a clocked-in staff member was refused");
    assert.equal(shift.id, row.id, "the gate returned a different shift than the one just opened");
    assert.equal(shift.ended_at, null);
    assert.equal(req.shift.id, row.id, "req.shift was not attached");
  });

  test("the gate works downstream of requirePrincipal, which attaches nothing to the request", async () => {
    // resolvePrincipal() calls authenticate(), not attachStaff(), so a handler
    // built like api/shifts.mjs has no req.staff at all. If this path broke,
    // every hand-rolled write endpoint would 401 while clocked in.
    const r = res();
    const [req, opts] = principalReq(onShift);
    const shift = await requireActiveShift(req, r, opts);
    assert.equal(r.code, null);
    assert.ok(shift);
    assert.equal(shift.staff_id, onShift);
  });

  test("one person's open shift does not open the gate for anybody else", async () => {
    const r = res();
    const out = await requireActiveShift(staffReq(offShift), r, { db });
    assert.equal(out, null, "a colleague's shift let this person through");
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "no_active_shift");
  });

  // ── the gate closes again ─────────────────────────────────────────────────

  test("clocking out closes the gate again in the same request cycle", async () => {
    await clockOut(db, { staffId: onShift });

    const r = res();
    const out = await requireActiveShift(staffReq(onShift), r, { db });
    assert.equal(out, null, "a clocked-out staff member still had dashboard access");
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "no_active_shift");
  });

  test("a closed shift row is not an active shift — the gate reads ended_at, not row existence", async () => {
    const rows = (await db.query(
      `SELECT id, ended_at FROM shifts WHERE staff_id=$1`, [onShift])).rows;
    assert.equal(rows.length, 1, "precondition: the closed shift is still on the table");
    assert.ok(rows[0].ended_at, "precondition: it is closed");

    assert.equal(await activeShift(staffReq(onShift), { db }), null,
      "a gate keyed on 'has this person ever had a shift' would pass here forever");
  });

  test("clocking back in reopens the gate", async () => {
    const row = await clockIn(db, { orgId, staffId: onShift });
    const r = res();
    const shift = await requireActiveShift(staffReq(onShift), r, { db });
    assert.equal(r.code, null);
    assert.equal(shift.id, row.id);
    await clockOut(db, { staffId: onShift });
  });

  // ── an outage is not an open gate, and not a closed one either ────────────

  test("a real Postgres error is a 503, NEVER a pass and never 'you are not clocked in'", async () => {
    // A genuine failure from the server: once a transaction is aborted, every
    // further statement on that client comes back 25P02. No stub, no injected
    // throw — this is what a query against a sick connection actually does.
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT this_column_does_not_exist FROM shifts").catch(() => {});

      const broken = { query: (sql, params) => client.query(sql, params) };
      await assert.rejects(() => broken.query("SELECT 1"), (e) => e.code === "25P02",
        "precondition: the connection is genuinely refusing queries");

      const req = staffReq(onShift);
      const r = res();
      const out = await requireActiveShift(req, r, { db: broken });

      assert.equal(out, null, "the gate let a request through while the database was failing");
      assert.equal(r.code, 503, `an outage answered ${r.code}`);
      assert.equal(r.body.error, "shift_unavailable");
      assert.equal(r.body.db, "down");
      assert.notEqual(r.body.error, "no_active_shift",
        "telling someone to clock in sends them to a button whose write hits the same dead database");
      assert.equal(req.shift, undefined);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  test("activeShift reports the same real failure as SHIFT_UNAVAILABLE rather than null", async () => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT this_column_does_not_exist FROM shifts").catch(() => {});
      const broken = { query: (sql, params) => client.query(sql, params) };
      const out = await activeShift(staffReq(onShift), { db: broken });
      assert.equal(out, SHIFT_UNAVAILABLE);
      assert.notEqual(out, null, "an outage collapsed into 'not clocked in'");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  // ── identity ──────────────────────────────────────────────────────────────

  test("a staff id that does not exist is refused, not passed", async () => {
    // Nothing joins to `staff` here — the lookup is on shifts.staff_id — so a
    // stale or bogus id has to fall out as "no open shift" rather than as an
    // error the gate might mishandle.
    const r = res();
    const out = await requireActiveShift(
      staffReq("00000000-0000-4000-8000-0000000000aa"), r, { db });
    assert.equal(out, null);
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "no_active_shift");
  });

  test("a malformed staff id is refused with a real answer rather than an unhandled crash", async () => {
    // uuid parse failure is SQLSTATE 22P02, a client data error. It surfaces
    // through the same catch as an outage — a 503 — which is the conservative
    // side: the gate never opens for input it could not evaluate.
    const r = res();
    const out = await requireActiveShift(staffReq("not-a-uuid"), r, { db });
    assert.equal(out, null, "an unparseable id must not open the gate");
    assert.equal(r.body.ok, false);
    assert.ok(r.code === 503 || r.code === 403, `unexpected status ${r.code}`);
  });

  test("no principal at all is a 401, and touches nothing that a clocked-in session would", async () => {
    const r = res();
    const out = await requireActiveShift({ headers: {} }, r, { db });
    assert.equal(out, null);
    assert.equal(r.code, 401);
    assert.deepEqual(r.body, { ok: false, error: "unauthorized" });
  });
});
