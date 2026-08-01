import { test } from "node:test";
import assert from "node:assert";
import { healthState, classify, safeError, httpStatus, wantsStrict } from "./health.mjs";
import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

const AT = () => new Date("2026-07-30T00:00:00.000Z");
const throwing = (err) => ({ query: async () => { throw err; } });
const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});

// A db that reports exactly these migration keys as applied.
const rowsFor = (keys) => ({ query: async () => ({ rows: keys.map((key) => ({ key })) }) });
const MIGRATED = rowsFor(EXPECTED_MIGRATIONS);
// The shape M18 is about: production stopped at 074 while the code is at 092.
const BEHIND = rowsFor(EXPECTED_MIGRATIONS.slice(0, 51));

test("a reachable, fully migrated database reports up, with the migration count", async () => {
  // "Reachable" alone is not up any more — the applied keys have to cover what
  // this build expects. See health-migrations.test.mjs for the behind case.
  const db = { query: async () => ({ rows: EXPECTED_MIGRATIONS.map((key) => ({ key })) }) };
  const b = await healthState(db, AT);
  assert.deepEqual(b, {
    ok: true, db: "up", state: "up",
    migrations: EXPECTED_MIGRATIONS.length,
    expected: EXPECTED_MIGRATIONS.length,
    pending: 0,
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

test("the reported error never carries the database host or address", async () => {
  // /api/health is UNAUTHENTICATED, so this body is world-readable. A DSN-only
  // scrub is not enough: getaddrinfo and connect report the endpoint directly,
  // without a URL around it.
  const cases = [
    ["getaddrinfo ENOTFOUND ep-cool-db-123.us-east-2.aws.neon.tech",
     /aws\.neon\.tech|ep-cool-db-123/],
    ["connect ECONNREFUSED 10.0.3.14:5432", /10\.0\.3\.14/],
    ["connect ETIMEDOUT 172.16.9.2:5432", /172\.16\.9\.2/],
    ["could not connect to db.internal.example.com:5432", /db\.internal\.example\.com/]
  ];
  for (const [raw, mustNotAppear] of cases) {
    const out = safeError(err(raw, "ECONNREFUSED"));
    assert.doesNotMatch(out, mustNotAppear, `leaked from: ${raw}`);
    assert.match(out, /\[redacted\]/, `nothing redacted in: ${raw}`);
  }

  // …while the failure CLASS still survives, which is the whole point of a body.
  assert.match(safeError(err("getaddrinfo ENOTFOUND some.host.example")), /ENOTFOUND/);
  assert.match(safeError(err("connect ECONNREFUSED 10.0.0.1:5432")), /ECONNREFUSED/);

  // And a schema/permission error stays fully readable — no host in it to scrub.
  assert.equal(
    safeError(err('relation "schema_migrations" does not exist')),
    'relation "schema_migrations" does not exist'
  );
  assert.equal(
    safeError(err("permission denied for table schema_migrations")),
    "permission denied for table schema_migrations"
  );
});

test("an unreachable host produces no host in the body, end to end", async () => {
  const leaky = err("getaddrinfo ENOTFOUND ep-secret.us-east-2.aws.neon.tech", "ENOTFOUND");
  const b = await healthState(throwing(leaky), AT);
  assert.equal(b.state, "unreachable");
  assert.doesNotMatch(JSON.stringify(b), /neon\.tech|ep-secret/);
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
  assert.equal(b.migrations, 0);      // never NaN, never undefined
  assert.equal(b.state, "behind");    // no keys read back is not a healthy database
  assert.equal(b.ok, false);

  const unusableRows = { query: async () => ({ rows: [{ n: "many" }] }) };
  assert.equal((await healthState(unusableRows, AT)).migrations, 0);
});

test("classify defaults to 'error' for anything unrecognised", () => {
  assert.equal(classify(null), "error");
  assert.equal(classify(err("something odd")), "error");
  assert.equal(classify(err("nope", "EACCES")), "error");
});

/* ===========================================================================
   M19a — the strict channel. Without it, no machine can see an outage here.
   ===========================================================================
   /api/health is the ONLY observability surface in this repo: package.json has
   two dependencies (pg, inngest), there is no error reporting, no metrics and no
   .github/ directory. And it answered 200 unconditionally, on purpose, so an
   uptime monitor pointed at it stayed green through a total database outage. The
   default has to stay 200 — public/app/shell.js:283 and public/crm.html:338 read
   any non-200 as "NO API — /api/* is not deployed" — so honesty is opt-in.

   These cases are the contract: nothing a monitor asks for may change what the
   two browser callers already receive. */

test("without ?strict the status is 200 for every state — the shell is untouched", async () => {
  const states = [
    ["up", MIGRATED],
    ["behind", BEHIND],
    ["unconfigured", throwing(err("DATABASE_URL not set"))],
    ["unreachable", throwing(err("connect failed", "ECONNREFUSED"))],
    ["error", throwing(err('relation "schema_migrations" does not exist', "42P01"))]
  ];
  for (const [expectedState, db] of states) {
    const b = await healthState(db, AT);
    assert.equal(b.state, expectedState, "test fixture drifted");
    // No query string at all, an empty query object, and an explicit opt-out all
    // mean the same thing to the two callers that pass no flag.
    for (const q of [undefined, null, {}, { strict: "0" }, { strict: "false" }, { other: "1" }]) {
      assert.equal(httpStatus(b, q), 200, `${expectedState} answered non-200 for ${JSON.stringify(q)}`);
    }
  }
});

test("?strict=1 answers 503 for behind, down, unconfigured and error — and 200 for up", async () => {
  const q = { strict: "1" };

  // UP — the only state a monitor should read as healthy.
  assert.equal(httpStatus(await healthState(MIGRATED, AT), q), 200);

  // BEHIND — this is the M18 shape, and it is the one most likely to be missed:
  // the database is answering perfectly, so every network-level check passes,
  // while the schema the code needs is not there.
  const behind = await healthState(BEHIND, AT);
  assert.equal(behind.state, "behind");
  assert.equal(httpStatus(behind, q), 503, "a behind database read as healthy to a monitor");

  // DOWN — the 2am case. Before this, the check stayed green.
  const down = await healthState(throwing(err("connect failed", "ECONNREFUSED")), AT);
  assert.equal(down.state, "unreachable");
  assert.equal(httpStatus(down, q), 503, "a database refusing connections read as healthy");

  // UNCONFIGURED — the function deployed without DATABASE_URL.
  const unconfigured = await healthState(throwing(err("DATABASE_URL not set")), AT);
  assert.equal(unconfigured.state, "unconfigured");
  assert.equal(httpStatus(unconfigured, q), 503);

  // ERROR — connected, but schema_migrations itself is missing or unreadable.
  const bad = await healthState(
    throwing(err('relation "schema_migrations" does not exist', "42P01")), AT);
  assert.equal(bad.state, "error");
  assert.equal(httpStatus(bad, q), 503);
});

test("wantsStrict reads the values a monitor would actually be configured with", () => {
  // `?strict` with no value arrives from URLSearchParams as the empty string.
  for (const v of ["", "1", "true", "TRUE", "yes", "on", " 1 ", true]) {
    assert.equal(wantsStrict({ strict: v }), true, `not honoured: ${JSON.stringify(v)}`);
  }
  for (const v of ["0", "false", "no", "off", "maybe", null, undefined, false]) {
    assert.equal(wantsStrict({ strict: v }), false, `wrongly honoured: ${JSON.stringify(v)}`);
  }
  assert.equal(wantsStrict({}), false);
  assert.equal(wantsStrict(undefined), false);
  assert.equal(wantsStrict("strict=1"), false, "a raw string is not a parsed query");

  // Own properties only. netlify/functions/api.mjs:210 builds req.query with a
  // null prototype for exactly this reason, and an inherited "strict" must not
  // count on any other host that hands over a plain object.
  const nullProto = Object.create(null);
  nullProto.strict = "1";
  assert.equal(wantsStrict(nullProto), true, "a null-prototype query must still work");
  assert.equal(wantsStrict(Object.create({ strict: "1" })), false, "inherited strict was honoured");
});

/* ===========================================================================
   M18, completed — "behind by 18" sends somebody hunting. A list does not.
   ===========================================================================
   The counts landed with the M18 fix. What was still missing is WHICH files, and
   that is what an operator needs at the moment they are reading docs/RUNBOOK.md.
   It rides the same opt-in as the status code, because the default body is
   world-readable and health-migrations.test.mjs:65 pins that it names no .sql
   file — a filename list also describes which features and vendors exist. */

test("the missing migrations come back BY NAME when the caller asks", async () => {
  const applied = EXPECTED_MIGRATIONS.slice(0, 51);
  const expectedMissing = EXPECTED_MIGRATIONS.slice(51);

  const b = await healthState(BEHIND, AT, EXPECTED_MIGRATIONS, true);
  assert.equal(b.state, "behind");
  assert.equal(b.pending, expectedMissing.length);
  assert.ok(Array.isArray(b.missingMigrations), "missingMigrations was not a list");
  assert.ok(b.missingMigrations.length > 0, "the list was empty on a behind database");
  assert.equal(b.missingMigrations.length, b.pending, "the list must match the count it explains");

  // The exact files, in the order db/migrate.mjs would apply them — so the list
  // can be read top to bottom rather than sorted by hand.
  assert.deepEqual(b.missingMigrations, expectedMissing);
  assert.ok(b.missingMigrations.every((k) => k.endsWith(".sql")), "not real migration keys");
  assert.equal(applied.some((k) => b.missingMigrations.includes(k)), false,
    "an already-applied migration was reported missing");
});

test("a fully migrated database asked for detail gets an empty list, not a lie", async () => {
  const b = await healthState(MIGRATED, AT, EXPECTED_MIGRATIONS, true);
  assert.equal(b.state, "up");
  assert.deepEqual(b.missingMigrations, []);
});

test("a database that never answered reports no list rather than a guessed one", async () => {
  // Nothing was read, so nothing is KNOWN to be missing. Listing all 69 here
  // would read as "the database is empty", which is a different problem with a
  // different fix — and it is not what happened.
  for (const db of [
    throwing(err("connect failed", "ECONNREFUSED")),
    throwing(err("DATABASE_URL not set")),
    throwing(err('relation "schema_migrations" does not exist', "42P01"))
  ]) {
    const b = await healthState(db, AT, EXPECTED_MIGRATIONS, true);
    assert.deepEqual(b.missingMigrations, [], `${b.state} guessed at a missing list`);
  }
});

test("the DEFAULT body still names no file, and gains no field", async () => {
  // The two browser callers parse this body. Detail is additive and opt-in; if
  // it ever leaks into the default, this fails before it ships.
  for (const db of [MIGRATED, BEHIND, throwing(err("connect failed", "ECONNREFUSED"))]) {
    const b = await healthState(db, AT);
    assert.equal("missingMigrations" in b, false, "detail leaked into the default body");
    assert.doesNotMatch(JSON.stringify(b), /\.sql/, "a filename reached the default body");
  }
  // …and the human-readable message never carries a filename in EITHER mode, so
  // a log line or a screenshot of the chip cannot leak one by accident.
  const detailed = await healthState(BEHIND, AT, EXPECTED_MIGRATIONS, true);
  assert.doesNotMatch(String(detailed.error), /\.sql/);
});

/* ===========================================================================
   The endpoint itself. src/http/ is where endpoint tests live, because npm
   test's glob is src/** and scripts/** only — a test under api/ never runs.
   ===========================================================================
   These assert the WIRING, not the classification: that the handler reads the
   flag at all, and that the default path is byte-for-byte what it was. They hold
   whether or not DATABASE_URL is set, so they run in every pass. */

test("the /api/health handler always answers 200 when no flag is passed", async () => {
  const { default: handler } = await import("../../api/health.mjs");
  const res = fakeRes();
  await handler({ method: "GET", url: "/api/health", query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(typeof res.body.state, "string");
  assert.equal("missingMigrations" in res.body, false);
});

test("the /api/health handler honours ?strict — code follows ok, list follows too", async () => {
  const { default: handler } = await import("../../api/health.mjs");

  // Environment-independent on purpose: with DATABASE_URL unset this is
  // "unconfigured", and against a live Postgres it is "up" or "behind". The
  // invariant that must hold in every one of those cases is the same — strict
  // means the code tells the truth the body is already telling.
  const res = fakeRes();
  await handler({ method: "GET", url: "/api/health?strict=1", query: { strict: "1" } }, res);
  assert.equal(res.statusCode, res.body.ok ? 200 : 503,
    `strict returned ${res.statusCode} for ok:${res.body.ok}`);
  assert.ok(Array.isArray(res.body.missingMigrations), "strict did not ask for the detail list");

  // The flag is read from the URL when the host did not parse a query object —
  // an operator curling this through some other harness still gets the truth.
  const raw = fakeRes();
  await handler({ method: "GET", url: "/api/health?strict=1" }, raw);
  assert.equal(raw.statusCode, raw.body.ok ? 200 : 503);
});

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}
