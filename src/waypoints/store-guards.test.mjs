// The refusals the store makes before it ever reaches Postgres.
//
// These are guards, not controls — the real controls are the CHECK constraints
// in db/migrations/330 and 360, and src/waypoints/store.pg.test.mjs proves
// those against a real database. What is asserted here is that the module fails
// LOUDLY and EARLY on a shape that would otherwise reach the database as a
// confusing error, and that the one function which could write a half-finished
// completion refuses to.

import { test, describe } from "node:test";
import assert from "node:assert";
import { upsertWaypoint, markWaypointState, WaypointError } from "./store.mjs";

// A db that records the SQL it was asked to run and answers with one row, so a
// test can prove a call never reached it.
function spyDb() {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: "row" }] };
    }
  };
}

const BASE = Object.freeze({
  orgId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  key: "get_ein",
  title: "Get your EIN from the IRS",
  ownerKind: "client"
});

describe("upsertWaypoint — verify_kind and params", () => {
  test("a verify kind that is not a lower_snake name is refused before any SQL runs", async () => {
    const db = spyDb();
    await assert.rejects(
      () => upsertWaypoint(db, { ...BASE, verifyKind: "Pay Down!" }),
      (err) => err instanceof WaypointError && err.code === "verify_kind"
    );
    assert.equal(db.calls.length, 0);
  });

  test("params must be an object — an array or a bare number is refused", async () => {
    const db = spyDb();
    for (const bad of [[1, 2], 7, "paydown"]) {
      await assert.rejects(
        () => upsertWaypoint(db, { ...BASE, params: bad }),
        (err) => err instanceof WaypointError && err.code === "params_shape"
      );
    }
    assert.equal(db.calls.length, 0);
  });

  test("NULL verify_kind and NULL params are the default and reach the database as NULL", async () => {
    const db = spyDb();
    await upsertWaypoint(db, { ...BASE });
    const { values } = db.calls[0];
    assert.equal(values[13], null, "verify_kind");
    assert.equal(values[14], null, "params — not '{}', which would read as a written answer");
  });

  test("params are serialised as json, with money left as the integer it arrived as", async () => {
    const db = spyDb();
    await upsertWaypoint(db, {
      ...BASE, verifyKind: "paydown", params: { target_cents: 30000, creditor_key: "chase" }
    });
    const { values } = db.calls[0];
    assert.equal(values[13], "paydown");
    assert.deepEqual(JSON.parse(values[14]), { target_cents: 30000, creditor_key: "chase" });
  });

  test("the upsert never overwrites state or completed_at", async () => {
    const db = spyDb();
    await upsertWaypoint(db, { ...BASE });
    const sql = db.calls[0].text;
    const doUpdate = sql.slice(sql.indexOf("DO UPDATE"));
    assert.ok(!/\bstate\s*=/.test(doUpdate), "a re-seed must not re-open a finished task");
    assert.ok(!/completed_at\s*=/.test(doUpdate));
  });
});

describe("markWaypointState", () => {
  test("IT REFUSES TO MARK ANYTHING DONE — completeWaypoint is the only way", async () => {
    const db = spyDb();
    await assert.rejects(
      () => markWaypointState(db, { ...BASE, state: "done" }),
      (err) => err instanceof WaypointError && err.code === "state"
    );
    assert.equal(db.calls.length, 0, "no half-written completion ever reaches the database");
  });

  test("an unknown state is refused too", async () => {
    const db = spyDb();
    await assert.rejects(
      () => markWaypointState(db, { ...BASE, state: "nearly" }),
      (err) => err instanceof WaypointError && err.code === "state"
    );
    assert.equal(db.calls.length, 0);
  });

  test("blocking a waypoint clears completed_at, because the database refuses the pair apart", async () => {
    const db = spyDb();
    await markWaypointState(db, { ...BASE, state: "blocked", reason: "New credit opened." });
    assert.match(db.calls[0].text, /completed_at\s*=\s*NULL/);
    assert.equal(db.calls[0].values[3], "blocked");
    assert.equal(db.calls[0].values[4], "New credit opened.");
  });
});
