// Postgres-backed tests for the ACTIVE-SHIFT GATE on POST /api/inquiries.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead.
//
// WHAT THESE ASSERT AGAINST. Every refusal is checked against inquiry_log and
// inquiry_attempts, not against the JSON the handler returned. A 403 body is the
// endpoint's account of what it did; the absence of a row is what it did. A gate
// that answers 403 and writes anyway is the exact failure this file exists to
// catch, and only the table can see it.
//
// The three POST actions all write inquiry_log.worked_by / worked_at — the
// attribution columns — so all three are gated and all three are checked here.
//
// GET IS CHECKED TOO, from the other direction: the read half of this same
// handler, and a wholly separate untouched read endpoint (/api/read/inquiries),
// must both still answer 200 for a staff member with no shift at all. That is
// the guard against over-gating, which is the more expensive mistake — it locks
// a working employee out of their own screen.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handlers are
// imported inside before() so that the skip is a real skip.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinels. Everything this file creates carries one of these, and the purge
// runs before() as well as after(): a crashed previous run must not collide
// with idx_staff_email_org.
const STAFF_EMAIL = "inqwrite_pg_test@example.com";
const STAFF_EMAIL_LIKE = "inqwrite_pg_test%@example.com";
const CLIENT_EMAIL = "inqwrite.pg.test@example.com";
const CLIENT_EMAIL_LIKE = "inqwrite.pg.test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("POST /api/inquiries — active-shift gate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, readHandler, org, staffId, token, clientId, inquiryId;

  /* The handler runs the real requirePrincipal against the real sessions table,
     so every call carries a token minted for a real staff row. There is no
     injection seam, deliberately. */
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

  // --- what the database actually holds -------------------------------------
  const inquiryRow = async () => (await db.query(
    `SELECT status, call_attempts, outcome, worked_by, worked_at, confirmed_at
       FROM inquiry_log WHERE id = $1`, [inquiryId])).rows[0];

  const attemptRows = async () => (await db.query(
    `SELECT id, kind, outcome, note, staff_id FROM inquiry_attempts
      WHERE inquiry_id = $1 ORDER BY created_at, id`, [inquiryId])).rows;

  /* The `staff_events` rows this endpoint caused. Scoped to the fixture staff
     member, because the seeded accounts and the other suites write here too. */
  const eventRows = async () => (await db.query(
    `SELECT id, org_id, staff_id, shift_id, kind, detail, created_at
       FROM staff_events WHERE staff_id = $1 ORDER BY created_at, id`, [staffId])).rows;

  const clearEvents = async () => {
    await db.query(`DELETE FROM staff_events WHERE staff_id = $1`, [staffId]);
  };

  // --- the clock ------------------------------------------------------------
  // Written with plain SQL rather than through src/shifts/store.mjs on purpose:
  // that module belongs to another workflow, and this suite is testing the gate,
  // not the clock. `ended_at IS NULL` is the whole definition of "open" (see the
  // predicate on uq_shifts_one_open), so these two statements are it.
  const openShift = async () => (await db.query(
    `INSERT INTO shifts (org_id, staff_id) VALUES ($1,$2) RETURNING id`,
    [org, staffId])).rows[0].id;

  const closeAllShifts = async () => {
    await db.query(`DELETE FROM shifts WHERE staff_id = $1`, [staffId]);
  };

  // Reset the inquiry row to its pristine, never-worked state between tests, so
  // "the write did not happen" is a statement about THIS test and not about
  // whichever one ran before it.
  const resetInquiry = async () => {
    await clearEvents();
    await db.query(`DELETE FROM inquiry_attempts WHERE inquiry_id = $1`, [inquiryId]);
    await db.query(
      `UPDATE inquiry_log
          SET status = 'New', call_attempts = 0, outcome = NULL,
              worked_by = NULL, worked_at = NULL, confirmed_at = NULL
        WHERE id = $1`, [inquiryId]);
  };

  const assertUntouched = async (where) => {
    const row = await inquiryRow();
    assert.equal((await eventRows()).length, 0, `${where}: a staff_events row was written anyway`);
    assert.equal((await attemptRows()).length, 0, `${where}: an inquiry_attempts row was written anyway`);
    assert.equal(row.call_attempts, 0, `${where}: call_attempts moved`);
    assert.equal(row.status, "New", `${where}: status was changed`);
    assert.equal(row.worked_by, null, `${where}: worked_by was attributed`);
    assert.equal(row.worked_at, null, `${where}: worked_at was stamped`);
    assert.equal(row.confirmed_at, null, `${where}: confirmed_at was stamped`);
  };

  async function purge() {
    // inquiry_log and inquiry_attempts cascade from clients; staff is deleted
    // separately and takes its sessions and shifts with it (both ON DELETE
    // CASCADE). Order matters only in that clients must go before staff is
    // irrelevant — they are unrelated FKs — so this is just both.
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    /* events does NOT cascade from clients - events_client_id_fkey is one of the
       16 client foreign keys deliberately left blocking, so an audit row cannot
       vanish with the client it describes. The comment above says inquiry_log
       and inquiry_attempts cascade, which is true, but the inquiry writes here
       also emit bus events. Clear those first or the client DELETE fails. */
    if (ids.length) await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
    if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/inquiries.mjs"));
    ({ default: readHandler } = await import("../../api/read/inquiries.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    // inquiry_specialist, because that is who works this queue. Any staff role
    // reaches the endpoint — requirePrincipal names kinds, not roles — but the
    // realistic caller is the one worth testing.
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Inqwrite Pgtest','inquiry_specialist',$2,'active') RETURNING id`,
      [org, STAFF_EMAIL])).rows[0].id;

    token = (await createSession(db, { staffId, orgId: org })).token;

    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Inqwrite','Pgtest',$2) RETURNING id`,
      [org, CLIENT_EMAIL])).rows[0].id;

    inquiryId = (await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status, call_attempts)
       VALUES ($1,$2,'Equifax','Synchrony inqwrite','New',0) RETURNING id`,
      [org, clientId])).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  // =========================================================================
  // NO OPEN SHIFT → 403 no_active_shift, and nothing written.
  // =========================================================================
  describe("with no open shift", () => {
    before(async () => { await closeAllShifts(); });

    test('action:"attempt" (a call outcome) is refused and logs nothing', async () => {
      await resetInquiry();
      const r = await call("POST", {
        token,
        body: { inquiry_id: inquiryId, action: "attempt", kind: "call", outcome: "removed", note: "spoke to furnisher" }
      });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("attempt");
    });

    test('action:"confirm" is refused and confirms nothing', async () => {
      await resetInquiry();
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "confirm", status: "Removed" } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("confirm");
    });

    test('action:"status" is refused and moves nothing', async () => {
      await resetInquiry();
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "status", status: "Hold" } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("status");
    });

    test("the refusal names the fix, so the screen can tell it from a role denial", async () => {
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "attempt" } });
      assert.equal(r.code, 403);
      assert.match(String(r.body.message), /clock in/i);
    });

    test("the gate fires BEFORE the body is validated — a bad payload is still refused as off-shift", async () => {
      // Whether you may write at all is not a question about the payload. If
      // this ever returns 400 it means the gate moved below the validation and
      // an attacker can map the endpoint's parameter rules while off the clock.
      const r = await call("POST", { token, body: { inquiry_id: "not-a-uuid", action: "attempt" } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
    });

    // ---- the untouched reads. The guard against over-gating. ----
    test("GET /api/inquiries (the same handler's read branch) still works off the clock", async () => {
      await resetInquiry();
      const r = await call("GET", { token, query: { inquiry_id: inquiryId } });
      assert.equal(r.code, 200, `the read half was gated: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.attempts));
    });

    test("GET /api/read/inquiries — a separate, untouched read endpoint — still works off the clock", async () => {
      const r = res();
      await readHandler({ method: "GET", query: { client_id: clientId, limit: "50" },
                          headers: { authorization: "Bearer " + token } }, r);
      assert.equal(r.code, 200, `an untouched read endpoint was gated: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.items));
    });
  });

  // =========================================================================
  // AN OPEN SHIFT → the writes go through, exactly as before the gate existed.
  // =========================================================================
  describe("with an open shift", () => {
    let shiftId;
    before(async () => { await closeAllShifts(); shiftId = await openShift(); });
    after(async () => { await closeAllShifts(); });

    test('action:"attempt" logs the call and attributes it', async () => {
      await resetInquiry();
      const r = await call("POST", {
        token,
        body: { inquiry_id: inquiryId, action: "attempt", kind: "call", outcome: "removed", note: "spoke to furnisher" }
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);

      const attempts = await attemptRows();
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].kind, "call");
      assert.equal(attempts[0].staff_id, staffId);

      const row = await inquiryRow();
      assert.equal(row.call_attempts, 1);
      assert.equal(row.outcome, "removed");
      assert.equal(row.worked_by, staffId, "the attribution column is the reason this is gated");
      assert.ok(row.worked_at, "worked_at was not stamped");
    });

    test('action:"confirm" writes confirmed_at', async () => {
      await resetInquiry();
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "confirm", status: "Removed" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = await inquiryRow();
      assert.equal(row.status, "Removed");
      assert.ok(row.confirmed_at, "confirmed_at was not stamped");
      assert.equal(row.worked_by, staffId);
    });

    test('action:"status" moves the status', async () => {
      await resetInquiry();
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "status", status: "Hold" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = await inquiryRow();
      assert.equal(row.status, "Hold");
      assert.equal(row.worked_by, staffId);
    });

    // ---- STAFF TELEMETRY -----------------------------------------------------
    // The whole reason `staff_events` was empty is that nothing called
    // logStaffEvent(). This is the endpoint end of that wiring, checked against
    // the table rather than against the 200 the handler returned.

    test('action:"attempt" kind:"call" writes a call_made event on the caller\'s own shift', async () => {
      await resetInquiry();
      const r = await call("POST", {
        token,
        body: { inquiry_id: inquiryId, action: "attempt", kind: "call", outcome: "removed", note: "spoke to furnisher" }
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const events = await eventRows();
      assert.equal(events.length, 1, "one attempt, one event");
      const ev = events[0];
      assert.equal(ev.kind, "call_made");
      assert.equal(ev.staff_id, staffId);
      assert.equal(ev.shift_id, shiftId,
        "the gate had already resolved this shift; an unlinked event cannot be repaired later");
      assert.equal(ev.org_id, org, "org_id comes off the staff row, never off the request body");
      assert.equal(ev.detail.inquiry_id, inquiryId);
      assert.equal(ev.detail.client_id, clientId);
      assert.equal(ev.detail.outcome, "removed");
      assert.equal(ev.detail.attempt_no, 1);
      assert.equal(ev.detail.note, undefined, "the free-text note must not be copied into telemetry");
    });

    test('action:"attempt" kind:"letter" writes letter_issued', async () => {
      await resetInquiry();
      const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "attempt", kind: "letter" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const events = await eventRows();
      assert.equal(events.length, 1);
      assert.equal(events[0].kind, "letter_issued");
      assert.equal(events[0].shift_id, shiftId);
    });

    test('kind:"portal" and kind:"note" write no event — neither has a kind in the vocabulary', async () => {
      for (const kind of ["portal", "note"]) {
        await resetInquiry();
        const r = await call("POST", { token, body: { inquiry_id: inquiryId, action: "attempt", kind } });
        assert.equal(r.code, 200, JSON.stringify(r.body));
        assert.equal((await attemptRows()).length, 1, `${kind}: the attempt itself must still be logged`);
        assert.equal((await eventRows()).length, 0,
          `${kind}: no EVENT_KINDS entry covers this, and inventing one corrupts the counts`);
      }
      await resetInquiry();
    });

    test('action:"confirm" and action:"status" write no event — file_touched is undefined', async () => {
      // Both write inquiry_log.worked_by, so both are staff work. The only kind
      // that could describe them is `file_touched`, which the schema names and
      // nothing defines. Picking call sites for it would be inventing the
      // definition; it is reported as a gap instead.
      await resetInquiry();
      await call("POST", { token, body: { inquiry_id: inquiryId, action: "confirm", status: "Removed" } });
      await call("POST", { token, body: { inquiry_id: inquiryId, action: "status", status: "Hold" } });
      assert.equal((await eventRows()).length, 0);
      await resetInquiry();
    });

    test("a broken staff_events write still answers 200 and still logs the attempt", async () => {
      // The design constraint, driven through the real endpoint: telemetry must
      // never fail the business action it observes. The failure is injected at
      // the staff_events INSERT alone, so nothing else in the request is
      // disturbed and a 500 here could only have come from telemetry.
      await resetInquiry();

      const realQuery = db.query;
      let sawTelemetryWrite = false;
      db.query = (sql, params) => {
        if (/INSERT INTO staff_events/i.test(String(sql))) {
          sawTelemetryWrite = true;
          return Promise.reject(Object.assign(new Error("simulated outage"), { code: "08006" }));
        }
        return realQuery(sql, params);
      };

      const realError = console.error;
      const logged = [];
      console.error = (...a) => logged.push(a.join(" "));

      let r;
      try {
        r = await call("POST", {
          token,
          body: { inquiry_id: inquiryId, action: "attempt", kind: "call", outcome: "removed" }
        });
      } finally {
        db.query = realQuery;
        console.error = realError;
      }

      assert.ok(sawTelemetryWrite, "the telemetry write never ran — this test proved nothing");
      assert.equal(r.code, 200, `telemetry took the attempt down with it: ${JSON.stringify(r.body)}`);

      const attempts = await attemptRows();
      assert.equal(attempts.length, 1, "the attempt is the record; it must survive a broken observer");
      const row = await inquiryRow();
      assert.equal(row.call_attempts, 1);
      assert.equal(row.worked_by, staffId);
      assert.equal((await eventRows()).length, 0, "and the event genuinely did not land");
      assert.ok(logged.some((l) => /\[telemetry\].*write_failed/.test(l)),
        `a swallowed failure must be logged, not silent: ${JSON.stringify(logged)}`);

      await resetInquiry();
    });
  });

  // =========================================================================
  // THE GATE FOLLOWS THE SHIFT. Clocking out closes the endpoint again — it is
  // not a one-time check performed at sign-in.
  // =========================================================================
  test("clocking out closes the endpoint again", async () => {
    await closeAllShifts();
    await resetInquiry();
    await openShift();

    const ok = await call("POST", { token, body: { inquiry_id: inquiryId, action: "attempt", kind: "call" } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));

    await db.query(`UPDATE shifts SET ended_at = now() WHERE staff_id = $1 AND ended_at IS NULL`, [staffId]);

    const before = await attemptRows();
    const refused = await call("POST", { token, body: { inquiry_id: inquiryId, action: "attempt", kind: "call" } });
    assert.equal(refused.code, 403);
    assert.equal(refused.body.error, "no_active_shift");
    assert.equal((await attemptRows()).length, before.length, "a second attempt was logged after clock-out");

    await closeAllShifts();
    await resetInquiry();
  });

  // =========================================================================
  // A FAILED CHECK IS 503, NOT A SILENT PASS.
  //
  // AUDIT-FINDINGS.md lesson 3: "'Absent config' must never mean 'no gate.'" An
  // outage is absent config. requireActiveShift already answers 503 when the
  // shift lookup throws; what is proved HERE is that this handler's composition
  // does not defeat it — that the 503 reaches the caller and, above all, that
  // the write does not happen anyway.
  //
  // The failure is injected at the one query the gate makes (SELECT ... FROM
  // shifts) rather than by breaking the pool, because breaking the pool would
  // fail requirePrincipal first and this test would pass for the wrong reason.
  // db is a plain { query } object from src/db.mjs and this file runs in its own
  // process, so the patch cannot leak into another suite; it is restored in a
  // finally regardless.
  // =========================================================================
  test("a database failure inside the shift check is a 503, and still writes nothing", async () => {
    await closeAllShifts();
    await openShift();          // clocked IN — so a pass here would be a real write
    await resetInquiry();

    const realQuery = db.query;
    let sawShiftQuery = false;
    db.query = (sql, params) => {
      if (/FROM\s+shifts/i.test(String(sql))) {
        sawShiftQuery = true;
        return Promise.reject(Object.assign(new Error("simulated outage"), { code: "25P02" }));
      }
      return realQuery(sql, params);
    };

    let r;
    try {
      r = await call("POST", {
        token,
        body: { inquiry_id: inquiryId, action: "attempt", kind: "call", outcome: "removed" }
      });
    } finally {
      db.query = realQuery;
    }

    assert.ok(sawShiftQuery, "the shift check never ran — this test proved nothing");
    assert.equal(r.code, 503, `a failed shift check must not fall through: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, "shift_unavailable");
    assert.equal(r.body.db, "down");
    await assertUntouched("outage");

    await closeAllShifts();
  });
});
