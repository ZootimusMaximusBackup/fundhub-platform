// Postgres-backed tests for /api/shifts — the clock-in endpoint.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in
// api/ is never collected and passes forever by never running. The handler is
// imported from here instead.
//
// WHAT THESE ASSERT AGAINST. The security property of this endpoint — "you can
// only clock yourself in" — is checked against the `shifts` TABLE, not against
// the JSON the store happened to return. A response body is the endpoint's
// account of what it did; the row is what it did. If some future refactor
// starts reshaping the payload, these tests still fail the moment a shift lands
// under the wrong staff_id, which is the failure that matters.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handler is
// imported inside before() rather than at the top of the file so that the skip
// is a real skip — a top-level import runs even when the suite does not.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// One sentinel, two rows: the caller, and somebody else to try to clock in.
const EMAIL_ME = "shifts_pg_test@example.com";
const EMAIL_OTHER = "shifts_pg_test_other@example.com";
const EMAIL_LIKE = "shifts_pg_test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("/api/shifts", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, org, me, other, token, otherToken;

  /* The handler runs the real requireAuth against the real sessions table, so
     every call carries a token minted for a real staff row. A token is the only
     way in — there is no injection seam, deliberately. */
  const call = async (method, { body, query, token: tok } = {}) => {
    const r = res();
    await handler({
      method,
      query: query || {},
      body,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  const openShifts = async (staffId) => (await db.query(
    `SELECT id, org_id, staff_id, started_at, ended_at
       FROM shifts WHERE staff_id = $1 AND ended_at IS NULL
      ORDER BY started_at`, [staffId])).rows;

  const allShifts = async (staffId) => (await db.query(
    `SELECT id, ended_at FROM shifts WHERE staff_id = $1`, [staffId])).rows;

  const wipeShifts = async () => {
    await db.query(`DELETE FROM shifts WHERE staff_id = ANY($1)`, [[me, other].filter(Boolean)]);
  };

  async function purgeStaff() {
    // shifts.staff_id and sessions.staff_id are both ON DELETE CASCADE, so the
    // staff delete takes the rest with it. Run first as well as last: a crashed
    // previous run must not collide with idx_staff_email_org.
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [EMAIL_LIKE]);
  }

  before(async () => {
    // Imported here, not at module scope — see the header.
    ({ default: handler } = await import("../../api/shifts.mjs"));
    org = await resolveDefaultOrg(db);
    await purgeStaff();

    const mk = async (name, email) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,'setter',$3,'active') RETURNING id`, [org, name, email])).rows[0].id;

    me = await mk("Shifts Pgtest Caller", EMAIL_ME);
    other = await mk("Shifts Pgtest Other", EMAIL_OTHER);

    token = (await createSession(db, { staffId: me, orgId: org })).token;
    otherToken = (await createSession(db, { staffId: other, orgId: org })).token;
  });

  after(async () => { await purgeStaff(); await close(); });

  // ── the ordinary day ──────────────────────────────────────────────────────

  test("GET with nothing open answers shift: null, not an empty object", async () => {
    await wipeShifts();
    const r = await call("GET", { token });
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.strictEqual(r.body.shift, null,
      "a staff member who is not on shift got something truthy back");
  });

  test("clock_in opens exactly one shift, owned by the session's staff member", async () => {
    await wipeShifts();
    const r = await call("POST", { token, body: { action: "clock_in" } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.ok(r.body.shift && typeof r.body.shift === "object", "no shift came back");

    const rows = await openShifts(me);
    assert.equal(rows.length, 1, "clock_in did not leave exactly one open row");
    assert.equal(rows[0].staff_id, me);
    assert.equal(rows[0].org_id, org, "the shift landed under the wrong org");
    assert.equal(r.body.shift.id, rows[0].id, "the response described a different row");
  });

  test("GET then returns that open shift", async () => {
    const rows = await openShifts(me);
    assert.equal(rows.length, 1, "precondition: one open shift");
    const r = await call("GET", { token });
    assert.equal(r.code, 200);
    assert.equal(r.body.shift.id, rows[0].id);
  });

  test("a second clock_in is a 409 and does not open a second shift", async () => {
    const before = await openShifts(me);
    assert.equal(before.length, 1, "precondition: already clocked in");

    const r = await call("POST", { token, body: { action: "clock_in" } });
    assert.equal(r.code, 409, `double clock-in returned ${r.code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false);

    const after = await openShifts(me);
    assert.equal(after.length, 1, "a double clock-in produced two open shifts — double hours");
    assert.equal(after[0].id, before[0].id, "the second clock-in replaced the first one's row");
  });

  test("clock_out closes the open shift", async () => {
    const before = await openShifts(me);
    assert.equal(before.length, 1, "precondition: clocked in");

    const r = await call("POST", { token, body: { action: "clock_out" } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);

    assert.equal((await openShifts(me)).length, 0, "clock_out left the shift open");
    const row = (await allShifts(me)).find((s) => s.id === before[0].id);
    assert.ok(row, "the shift row disappeared instead of being closed");
    assert.ok(row.ended_at instanceof Date, "ended_at was not stamped");
  });

  test("GET after clocking out is null again", async () => {
    const r = await call("GET", { token });
    assert.equal(r.code, 200);
    assert.strictEqual(r.body.shift, null);
  });

  test("clock_out with nothing open is a 409, not a silent success", async () => {
    assert.equal((await openShifts(me)).length, 0, "precondition: nothing open");
    const r = await call("POST", { token, body: { action: "clock_out" } });
    assert.equal(r.code, 409, `clock-out with nothing open returned ${r.code}`);
    assert.equal(r.body.ok, false);
    assert.equal((await openShifts(me)).length, 0);
  });

  // ── identity is not a request parameter ───────────────────────────────────

  test("a body carrying somebody else's staff_id is REFUSED, not ignored", async () => {
    await wipeShifts();
    const r = await call("POST", { token, body: { action: "clock_in", staff_id: other } });

    // 400, not a 200 that quietly clocked the caller in: a client that sent
    // staff_id believes it did something, and a success confirms that belief.
    assert.equal(r.code, 400, `a foreign staff_id was accepted (${r.code})`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "staff_id_not_accepted");

    assert.equal((await allShifts(other)).length, 0,
      "a staff member clocked somebody else in — hours filed under the wrong person");
    assert.equal((await allShifts(me)).length, 0,
      "the request was refused but still wrote a shift");
  });

  test("even the caller's OWN staff_id in the body is refused", async () => {
    await wipeShifts();
    const r = await call("POST", { token, body: { action: "clock_in", staff_id: me } });
    assert.equal(r.code, 400, "staff_id was accepted when it happened to be correct");
    assert.equal(r.body.error, "staff_id_not_accepted");
    assert.equal((await allShifts(me)).length, 0);
  });

  test("org_id in the body is refused too — the session owns the tenant", async () => {
    await wipeShifts();
    const r = await call("POST", { token, body: { action: "clock_in", org_id: org } });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.equal((await allShifts(me)).length, 0);
  });

  test("two staff members hold independent shifts", async () => {
    await wipeShifts();
    assert.equal((await call("POST", { token, body: { action: "clock_in" } })).code, 200);
    assert.equal((await call("POST", { token: otherToken, body: { action: "clock_in" } })).code, 200);

    assert.equal((await openShifts(me)).length, 1);
    assert.equal((await openShifts(other)).length, 1);
    assert.notEqual((await openShifts(me))[0].id, (await openShifts(other))[0].id);

    // One person clocking out must not close the other's shift.
    assert.equal((await call("POST", { token, body: { action: "clock_out" } })).code, 200);
    assert.equal((await openShifts(me)).length, 0);
    assert.equal((await openShifts(other)).length, 1,
      "clocking out closed somebody else's shift");
    await wipeShifts();
  });

  // ── the refusals ──────────────────────────────────────────────────────────

  test("an unknown action is a 400 invalid_action and opens nothing", async () => {
    await wipeShifts();
    for (const action of ["clockin", "CLOCK_IN", "", null, undefined, 1, { action: "clock_in" }]) {
      const r = await call("POST", { token, body: { action } });
      assert.equal(r.code, 400, `action ${JSON.stringify(action)} was not rejected`);
      assert.equal(r.body.error, "invalid_action");
    }
    assert.equal((await allShifts(me)).length, 0, "a rejected action still wrote a shift");
  });

  test("a POST with no body at all is a 400, not a 500", async () => {
    const r = await call("POST", { token });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_action");
  });

  test("no session is a 401 on both methods, and writes nothing", async () => {
    await wipeShifts();
    for (const method of ["GET", "POST"]) {
      const r = await call(method, { body: { action: "clock_in" } });
      assert.equal(r.code, 401, `${method} without a token returned ${r.code}`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.shift, undefined, "a 401 still returned shift data");
    }
    assert.equal((await allShifts(me)).length, 0, "an unauthenticated POST wrote a shift");
  });

  test("PUT and DELETE are 405 and say what is allowed", async () => {
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const r = await call(method, { token, body: { action: "clock_in" } });
      assert.equal(r.code, 405, `${method} was not refused`);
      assert.equal(r.body.error, "method_not_allowed");
      assert.equal(r.getHeader("allow"), "GET, POST",
        `${method} refused without telling the caller what to use`);
    }
    assert.equal((await allShifts(me)).length, 0, "a 405 still wrote a shift");
  });
});
