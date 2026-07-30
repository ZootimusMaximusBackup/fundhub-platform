import { test } from "node:test";
import assert from "node:assert";
import { healthState, classify, safeError } from "./health.mjs";

const AT = () => new Date("2026-07-30T00:00:00.000Z");
const throwing = (err) => ({ query: async () => { throw err; } });
const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});

test("a reachable database reports up, with the migration count", async () => {
  const db = { query: async () => ({ rows: [{ n: 25 }] }) };
  const b = await healthState(db, AT);
  assert.deepEqual(b, {
    ok: true, db: "up", state: "up", migrations: 25,
    error: null, checkedAt: "2026-07-30T00:00:00.000Z"
  });
});

test("a missing DATABASE_URL is 'unconfigured', not a generic error", async () => {
  const b = await healthState(throwing(err("DATABASE_URL not set")), AT);
  assert.equal(b.state, "unconfigured");
  assert.equal(b.ok, false);
  assert.equal(b.db, "down");
  assert.equal(b.error, "DATABASE_URL is not set");
});

test("a refused or unresolvable host is 'unreachable', by driver code", async () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "57P03"]) {
    const b = await healthState(throwing(err("connect failed", code)), AT);
    assert.equal(b.state, "unreachable", code);
    assert.equal(b.ok, false);
  }
});

test("a connected-but-failing query is 'error' — schema missing, bad perms", async () => {
  const b = await healthState(
    throwing(err('relation "schema_migrations" does not exist', "42P01")), AT);
  assert.equal(b.state, "error");
  assert.match(b.error, /schema_migrations/);
});

test("the reported error never carries the DSN or a password", async () => {
  const leaky = err(
    'could not connect to postgres://fundhub:sup3rs3cret@db.example.com:5432/fundhub',
    "ECONNREFUSED");
  const b = await healthState(throwing(leaky), AT);
  assert.equal(b.state, "unreachable");
  assert.doesNotMatch(b.error, /sup3rs3cret/);
  assert.doesNotMatch(b.error, /db\.example\.com/);
  assert.match(b.error, /\[redacted\]/);

  assert.doesNotMatch(safeError(err("fail password=hunter2 more")), /hunter2/);
});

test("healthState never rejects — a health check that can fail is not one", async () => {
  // A db whose query() throws synchronously, and one that returns junk.
  const sync = { query: () => { throw err("boom"); } };
  assert.equal((await healthState(sync, AT)).state, "error");

  const junk = { query: async () => ({}) };
  const b = await healthState(junk, AT);
  assert.equal(b.ok, true);
  assert.equal(b.migrations, 0);      // never NaN, never undefined

  const nonNumeric = { query: async () => ({ rows: [{ n: "many" }] }) };
  assert.equal((await healthState(nonNumeric, AT)).migrations, 0);
});

test("classify defaults to 'error' for anything unrecognised", () => {
  assert.equal(classify(null), "error");
  assert.equal(classify(err("something odd")), "error");
  assert.equal(classify(err("nope", "EACCES")), "error");
});
