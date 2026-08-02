// An idle pg.Pool client that errors out (a pooler resetting or reaping a
// backend connection — exactly what Supavisor does) emits 'error' on the
// Pool. pg.Pool is a plain node EventEmitter, and an EventEmitter with no
// 'error' listener THROWS synchronously on emit instead of swallowing it —
// crashing the whole process and abandoning every client any in-flight
// request had checked out, mid-request, before it could reach its own
// try/finally's release(). That is how a handful of connections end up
// orphaned at the pooler instead of cleanly returned.
//
// No real Postgres needed: this doesn't open a connection, it only asks
// whether pool() attached a listener that survives an emitted error.

import { test } from "node:test";
import assert from "node:assert";

import { pool, close } from "./db.mjs";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://nobody:nothing@127.0.0.1:1/unreachable";

test("pool() survives an emitted idle-client error instead of crashing", async () => {
  const p = pool();
  assert.equal(p.listenerCount("error"), 1, "pool must have exactly one error listener attached");

  // If no listener were attached, this emit would throw synchronously here
  // and fail the test the same way it would crash the real process.
  assert.doesNotThrow(() => p.emit("error", new Error("simulated pooler reset")));
});

test("pool() is a singleton — one Pool, one listener, not one per call", async () => {
  const a = pool();
  const b = pool();
  assert.equal(a, b);
  assert.equal(a.listenerCount("error"), 1);
});

test.after(async () => { await close(); });
