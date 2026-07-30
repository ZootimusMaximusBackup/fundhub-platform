// Postgres-backed tests for the dead-letter queue and the isolated dispatch.
// Skipped without DATABASE_URL, like the other *.pg.test.mjs files.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, _resetOrgCache } from "./bus.mjs";
import { on, clearHandlers } from "./registry.mjs";
import {
  record, due, retry, retryOne, retryDue, reschedule,
  markResolved, markIgnored, summary,
  backoffMinutes, nextAttemptAt, handlerName,
  BACKOFF_MINUTES, MAX_ATTEMPTS
} from "./dead-letter.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("dead-letter queue", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    _resetOrgCache();
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
  });

  beforeEach(async () => {
    clearHandlers();
    // failed_events blocks DELETE by design, so clear it the way the trigger
    // allows: drop the trigger for the duration of the fixture reset.
    await db.query(`ALTER TABLE failed_events DISABLE TRIGGER trg_failed_events_no_delete`);
    await db.query(`DELETE FROM failed_events WHERE org_id = $1`, [org]);
    await db.query(`ALTER TABLE failed_events ENABLE TRIGGER trg_failed_events_no_delete`);
  });

  after(async () => {
    clearHandlers();
    await db.query(`ALTER TABLE failed_events DISABLE TRIGGER trg_failed_events_no_delete`);
    await db.query(`DELETE FROM failed_events WHERE org_id = $1`, [org]);
    await db.query(`ALTER TABLE failed_events ENABLE TRIGGER trg_failed_events_no_delete`);
    await close();
  });

  const rowsFor = async (name) => (await db.query(
    `SELECT * FROM failed_events WHERE org_id = $1 AND event_name = $2 ORDER BY handler_name`,
    [org, name])).rows;

  // ── the core promise: a throwing handler lands here instead of vanishing ──

  test("a throwing handler is recorded, and its siblings still run", async () => {
    const ran = [];
    function goodOne() { ran.push("goodOne"); }
    function badOne() { throw new Error("kaboom"); }
    function goodTwo() { ran.push("goodTwo"); }

    on("entry.captured", goodOne);
    on("entry.captured", badOne);
    on("entry.captured", goodTwo);

    const res = await emit(db, "entry.captured", { who: "test" },
      { idempotencyKey: "dlq-siblings-" + Date.now() });

    // The sibling AFTER the throwing handler is the one the old loop skipped.
    assert.deepEqual(ran, ["goodOne", "goodTwo"]);
    assert.equal(res.dispatched.handlers, 3);
    assert.equal(res.dispatched.failed, 1);
    assert.equal(res.dispatched.recorded, 1);

    const rows = await rowsFor("entry.captured");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].handler_name, "badOne");
    assert.equal(rows[0].error_message, "kaboom");
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].attempts, 1);
    assert.ok(rows[0].error_stack, "the stack should be captured");
    assert.ok(rows[0].next_attempt_at, "a pending row must be scheduled");
    assert.deepEqual(rows[0].payload, { who: "test" });
  });

  test("the event is still committed when a handler fails", async () => {
    on("entry.captured", function alwaysBad() { throw new Error("nope"); });
    const key = "dlq-committed-" + Date.now();
    const res = await emit(db, "entry.captured", { a: 1 }, { idempotencyKey: key });
    const ev = await db.query(`SELECT id FROM events WHERE id = $1`, [res.id]);
    assert.equal(ev.rows.length, 1, "the event row must survive a handler failure");
  });

  // ── idempotence: the property that keeps a replay storm from flooding ──

  test("the same handler failing twice is one row with attempts=2", async () => {
    const base = {
      orgId: org, eventId: null, eventName: "payment.received",
      payload: { n: 1 }, handler: "chargeThing"
    };
    const a = await record(db, { ...base, error: new Error("first") });
    const b = await record(db, { ...base, payload: { n: 2 }, error: new Error("second") });

    assert.ok(a.ok && b.ok);
    assert.equal(a.id, b.id, "a repeat must update, not insert");
    assert.equal(b.attempts, 2);

    const rows = await rowsFor("payment.received");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].error_message, "second", "latest error wins");
    assert.deepEqual(rows[0].payload, { n: 2 }, "latest payload wins");
    assert.ok(rows[0].last_seen_at >= rows[0].first_seen_at);
  });

  test("two different handlers on the same event are two rows", async () => {
    const base = { orgId: org, eventId: null, eventName: "sale.closed", payload: {} };
    await record(db, { ...base, handler: "one", error: new Error("x") });
    await record(db, { ...base, handler: "two", error: new Error("y") });
    assert.equal((await rowsFor("sale.closed")).length, 2);
  });

  // ── backoff and exhaustion ──

  test("backoff is the documented schedule, then holds", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 12].map(backoffMinutes),
      [...BACKOFF_MINUTES, 1440, 1440]
    );
    assert.equal(backoffMinutes(0), BACKOFF_MINUTES[0], "attempt 0 is treated as the first");
    const from = new Date("2026-01-01T00:00:00Z");
    assert.equal(nextAttemptAt(1, from).toISOString(), "2026-01-01T00:01:00.000Z");
    assert.equal(nextAttemptAt(4, from).toISOString(), "2026-01-01T01:00:00.000Z");
  });

  test("a row exhausts at max_attempts and stops scheduling itself", async () => {
    const base = {
      orgId: org, eventId: null, eventName: "round.funded",
      payload: {}, handler: "keepsFailing", maxAttempts: 3
    };
    const r1 = await record(db, { ...base, error: new Error("1") });
    assert.equal(r1.status, "pending");
    const r2 = await record(db, { ...base, error: new Error("2") });
    assert.equal(r2.status, "pending");
    const r3 = await record(db, { ...base, error: new Error("3") });
    assert.equal(r3.attempts, 3);
    assert.equal(r3.status, "exhausted");

    const rows = await rowsFor("round.funded");
    assert.equal(rows[0].next_attempt_at, null, "an exhausted row must not be rescheduled");

    // And it must not come back on the due list.
    assert.equal((await due(db, { orgId: org, now: new Date(Date.now() + 9e8) })).length, 0);
  });

  // ── the retry paths ──

  test("retryOne: a handler that now succeeds resolves the row", async () => {
    let calls = 0;
    function flaky() { calls += 1; if (calls === 1) throw new Error("transient"); }
    on("deposit.paid", flaky);

    await emit(db, "deposit.paid", { v: 1 }, { idempotencyKey: "dlq-retry-" + Date.now() });
    const [row] = await rowsFor("deposit.paid");
    assert.equal(row.status, "pending");

    const out = await retryOne(db, row.id, () => flaky);
    assert.equal(out.outcome, "resolved");
    assert.equal(calls, 2);

    const [after] = await rowsFor("deposit.paid");
    assert.equal(after.status, "resolved");
    assert.ok(after.resolved_at, "a resolved row must record when");
    assert.equal(after.next_attempt_at, null);
    assert.equal(after.resolution_note, "retry succeeded");
  });

  test("retry: still failing reschedules with a longer backoff", async () => {
    const rec = await record(db, {
      orgId: org, eventId: null, eventName: "analysis.completed",
      payload: {}, handler: "stillBad", error: new Error("again")
    });
    const [row] = await rowsFor("analysis.completed");
    const out = await retry(db, { ...row, org_id: org },
      () => function stillBad() { throw new Error("still broken"); });

    assert.equal(out.outcome, "rescheduled");
    const [after] = await rowsFor("analysis.completed");
    assert.equal(after.attempts, 2);
    assert.equal(after.status, "pending");
    assert.equal(after.error_message, "still broken");
    assert.ok(after.next_attempt_at > row.next_attempt_at, "backoff must move forward");
    assert.equal(rec.attempts, 1);
  });

  test("retry: a handler that no longer exists is exhausted, not retried forever", async () => {
    await record(db, {
      orgId: org, eventId: null, eventName: "booking.created",
      payload: {}, handler: "deletedHandler", error: new Error("x")
    });
    const [row] = await rowsFor("booking.created");
    const out = await retry(db, { ...row, org_id: org }, () => undefined);

    assert.equal(out.outcome, "unresolvable");
    const [after] = await rowsFor("booking.created");
    assert.equal(after.status, "exhausted");
    assert.equal(after.next_attempt_at, null);
    assert.match(after.error_message, /no longer registered/);
  });

  test("retryDue: the batch path only takes rows that are actually due", async () => {
    function ok1() {}
    const mk = (handler, minutesAgo) => record(db, {
      orgId: org, eventId: null, eventName: "survey.submitted",
      payload: {}, handler, error: new Error("e"),
      now: new Date(Date.now() - minutesAgo * 60_000)
    });
    await mk("dueA", 10);      // scheduled 9m ago → due
    await mk("dueB", 10);      // due
    await mk("notDue", 0);     // scheduled 1m out → not due

    const dueRows = await due(db, { orgId: org });
    assert.deepEqual(dueRows.map((r) => r.handler_name).sort(), ["dueA", "dueB"]);

    const out = await retryDue(db, () => ok1, { orgId: org });
    assert.equal(out.attempted, 2);
    assert.equal(out.resolved, 2);

    const rows = await rowsFor("survey.submitted");
    assert.equal(rows.find((r) => r.handler_name === "notDue").status, "pending");
    assert.equal(rows.filter((r) => r.status === "resolved").length, 2);
  });

  test("retryDue respects its limit so a backlog cannot become one huge batch", async () => {
    for (const h of ["a", "b", "c", "d", "e"]) {
      await record(db, {
        orgId: org, eventId: null, eventName: "call.completed",
        payload: {}, handler: h, error: new Error("e"),
        now: new Date(Date.now() - 600_000)
      });
    }
    const out = await retryDue(db, () => function noop() {}, { orgId: org, limit: 2 });
    assert.equal(out.attempted, 2);
  });

  // ── operator actions and the reopen rule ──

  test("a resolved row that fails again reopens as pending", async () => {
    const base = {
      orgId: org, eventId: null, eventName: "decision.rendered",
      payload: {}, handler: "onOff"
    };
    await record(db, { ...base, error: new Error("first") });
    const [row] = await rowsFor("decision.rendered");
    await markResolved(db, row.id, { note: "fixed by hand" });
    assert.equal((await rowsFor("decision.rendered"))[0].status, "resolved");

    await record(db, { ...base, error: new Error("regressed") });
    const [after] = await rowsFor("decision.rendered");
    assert.equal(after.status, "pending", "a regression must reopen the row");
    assert.equal(after.resolved_at, null, "and clear the resolution");
    assert.equal(after.attempts, 2);
  });

  test("markIgnored keeps the row and stops it being retried", async () => {
    await record(db, {
      orgId: org, eventId: null, eventName: "message.received",
      payload: {}, handler: "dontCare", error: new Error("noise"),
      now: new Date(Date.now() - 600_000)
    });
    const [row] = await rowsFor("message.received");
    await markIgnored(db, row.id, { note: "expected for test traffic" });

    const [after] = await rowsFor("message.received");
    assert.equal(after.status, "ignored");
    assert.ok(after.resolved_at);
    assert.equal((await due(db, { orgId: org })).length, 0, "an ignored row is not due");
  });

  test("rows cannot be deleted — evidence is not disposable", async () => {
    await record(db, {
      orgId: org, eventId: null, eventName: "entry.captured",
      payload: {}, handler: "keepMe", error: new Error("x")
    });
    const [row] = await rowsFor("entry.captured");
    await assert.rejects(
      () => db.query(`DELETE FROM failed_events WHERE id = $1`, [row.id]),
      /not deletable/
    );
  });

  test("a terminal status must carry resolved_at (checked by the database)", async () => {
    await record(db, {
      orgId: org, eventId: null, eventName: "sale.closed",
      payload: {}, handler: "ck", error: new Error("x")
    });
    const [row] = await rowsFor("sale.closed");
    await assert.rejects(
      () => db.query(`UPDATE failed_events SET status = 'resolved' WHERE id = $1`, [row.id]),
      /failed_events_resolved_at_ck/
    );
  });

  // ── the guarantee that this cannot take down what it monitors ──

  test("record never throws, even when the queue itself is broken", async () => {
    const brokenDb = { query: async () => { throw new Error("relation does not exist"); } };
    const res = await record(brokenDb, {
      orgId: org, eventName: "entry.captured", payload: {},
      handler: "h", error: new Error("original")
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /relation does not exist/);
  });

  test("a failing handler plus a broken queue still rejects out of emit", async () => {
    // Both failed: the caller must not be told this worked.
    const brokenDb = {
      query: async (sql) => {
        if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "00000000-0000-0000-0000-000000000001" }] };
        if (/FROM orgs/.test(sql)) return { rows: [{ id: org }] };
        throw new Error("failed_events is gone");
      }
    };
    on("entry.captured", function onlyHandler() { throw new Error("handler blew up"); });
    await assert.rejects(
      () => emit(brokenDb, "entry.captured", {}, { orgId: org }),
      /none could be dead-lettered/
    );
  });

  test("long errors and stacks are truncated, not stored unbounded", async () => {
    const big = new Error("x".repeat(5000));
    big.stack = "y".repeat(20000);
    await record(db, {
      orgId: org, eventId: null, eventName: "entry.captured",
      payload: {}, handler: "huge", error: big
    });
    const [row] = await rowsFor("entry.captured");
    assert.ok(row.error_message.length < 1100, `message was ${row.error_message.length}`);
    assert.ok(row.error_stack.length < 4100, `stack was ${row.error_stack.length}`);
    assert.match(row.error_message, /truncated/);
  });

  test("error code is captured when the driver supplies one", async () => {
    const e = Object.assign(new Error("dup"), { code: "23505" });
    await record(db, {
      orgId: org, eventId: null, eventName: "entry.captured",
      payload: {}, handler: "coded", error: e
    });
    const [row] = await rowsFor("entry.captured");
    assert.equal(row.error_code, "23505");
  });

  // ── the health screen's read ──

  test("summary groups by event and handler and never returns payloads", async () => {
    await record(db, { orgId: org, eventId: null, eventName: "entry.captured",
      payload: { secret: "ssn" }, handler: "h1", error: new Error("boom") });
    await record(db, { orgId: org, eventId: null, eventName: "entry.captured",
      payload: { secret: "ssn" }, handler: "h1", error: new Error("boom again") });
    await record(db, { orgId: org, eventId: null, eventName: "sale.closed",
      payload: {}, handler: "h2", error: new Error("other") });

    const s = await summary(db, { orgId: org });
    assert.equal(s.counts.pending, 2, JSON.stringify(s.counts));
    const g = s.groups.find((x) => x.event_name === "entry.captured");
    assert.equal(g.handler_name, "h1");
    assert.equal(g.rows, 1);
    assert.equal(g.total_attempts, 2);
    assert.equal(g.latest_error, "boom again");
    assert.equal(JSON.stringify(s.groups).includes("ssn"), false,
      "the summary must not carry payloads");
  });

  // ── handler identity ──

  test("handlerName uses the function name, and falls back for anonymous ones", () => {
    assert.equal(handlerName(function named() {}), "named");
    assert.equal(handlerName(() => {}, "slot-3"), "slot-3");
    assert.equal(handlerName(null, "slot-9"), "slot-9");
    assert.equal(MAX_ATTEMPTS, 7);
  });

  test("reschedule on a row that does not exist returns null, does not throw", async () => {
    assert.equal(await reschedule(db, "00000000-0000-0000-0000-000000000000"), null);
    assert.equal(await retryOne(db, "00000000-0000-0000-0000-000000000000", () => {}), null);
  });
});
