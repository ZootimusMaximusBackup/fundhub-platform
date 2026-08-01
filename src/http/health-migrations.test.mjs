// /api/health must compare what is applied against what SHOULD be applied.
//
// Counting rows in schema_migrations and answering "up" whenever the count
// query succeeds is not a health check: netlify.toml's build command is an echo,
// so a deploy never runs migrations, and nothing in CI runs them either. A
// production database sitting at 074 while the code expects 092 answers that
// count query perfectly happily — 200 {ok:true, state:"up"} — and the shell chip
// reads "LIVE — 51 migrations applied" while every screen that touches a table
// added after 074 fails on a relation that does not exist.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { healthState } from "./health.mjs";
import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

const AT = () => new Date("2026-07-30T00:00:00.000Z");
const rowsFor = (keys) => ({ query: async () => ({ rows: keys.map((key) => ({ key })) }) });

test("a database behind the code is NOT 'up' — the deploy applies no migrations", async () => {
  // Production at 074 with the code at 092: exactly the shape that shipped LIVE.
  const applied = EXPECTED_MIGRATIONS.slice(0, 51);
  const b = await healthState(rowsFor(applied), AT);

  assert.equal(b.state, "behind", "a database missing migrations reported as up");
  assert.equal(b.ok, false, "ok:true tells the shell to draw LIVE");
  assert.equal(b.db, "up", "the database itself answered — that part is true");
  assert.equal(b.migrations, 51);
  assert.equal(b.expected, EXPECTED_MIGRATIONS.length);
  assert.equal(b.pending, EXPECTED_MIGRATIONS.length - 51);
  assert.match(String(b.error), /51/);
  assert.match(String(b.error), new RegExp(String(EXPECTED_MIGRATIONS.length)));
});

test("a fully migrated database is 'up', with nothing pending", async () => {
  const b = await healthState(rowsFor(EXPECTED_MIGRATIONS), AT);
  assert.deepEqual(b, {
    ok: true,
    db: "up",
    state: "up",
    migrations: EXPECTED_MIGRATIONS.length,
    expected: EXPECTED_MIGRATIONS.length,
    pending: 0,
    error: null,
    checkedAt: "2026-07-30T00:00:00.000Z"
  });
});

test("the comparison is by key, not by count — 69 wrong rows are still behind", async () => {
  const junkKeys = EXPECTED_MIGRATIONS.map((_, i) => `migrations/9${i}_not_a_real_file.sql`);
  const b = await healthState(rowsFor(junkKeys), AT);
  assert.equal(b.state, "behind");
  assert.equal(b.pending, EXPECTED_MIGRATIONS.length);
});

test("a database with nothing applied is behind, not up", async () => {
  const b = await healthState(rowsFor([]), AT);
  assert.equal(b.state, "behind");
  assert.equal(b.ok, false);
  assert.equal(b.migrations, 0);
});

test("the pending count never names a file — /api/health is unauthenticated", async () => {
  const b = await healthState(rowsFor(EXPECTED_MIGRATIONS.slice(0, 10)), AT);
  assert.doesNotMatch(JSON.stringify(b), /\.sql/);
});

test("the expected list is exactly what db/ holds — it cannot drift silently", () => {
  // migrate.mjs walks schema, then migrations, then seed, in filename order, and
  // keys each file `<dir>/<file>`. The list health.mjs compares against has to be
  // that same list or the check is theatre.
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const DB = path.join(HERE, "..", "..", "db");
  const onDisk = [];
  for (const d of ["schema", "migrations", "seed"]) {
    const dir = path.join(DB, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      onDisk.push(`${d}/${f}`);
    }
  }
  assert.deepEqual(
    EXPECTED_MIGRATIONS,
    onDisk,
    "db/expected-migrations.mjs is stale — regenerate it with `npm run migrations:manifest`"
  );
});
