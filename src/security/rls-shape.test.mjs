// rls-shape.test.mjs — no table may be locked shut against the application.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE BUG THIS EXISTS TO CATCH
//
// In Postgres, a table with Row Level Security switched ON and ZERO policies
// attached denies everything to every role except the table's owner. The app
// connects as fundhub_app, which is deliberately not an owner, so such a table
// is simply invisible to the product: reads return nothing and writes are
// refused.
//
// The cruel part is that a locked-out read does not raise an error. It returns
// zero rows, which is indistinguishable from an empty table. Nothing logs,
// nothing alerts, no screen shows a failure — the feature just quietly does
// nothing. Six credit-dispute tables sat like that on live from the day
// migration 160 shipped until 200 unlocked them, and the only reason anyone
// found out was a hand audit of the database.
//
// This has now happened three times: 109_no_bare_rls.sql, then
// 154_no_bare_rls_again.sql, then 160/161.
//
//
// WHY THE EXISTING GUARD COULD NOT SEE IT
//
// src/compliance/rls-bypass.pg.test.mjs asks the right question, but it asks
// it of whatever DATABASE_URL points at, and CI points at a throwaway database
// built from db/migrations. 160 and 161 do not contain the words ROW LEVEL
// SECURITY at all — the switch was thrown out of band, from the Supabase
// dashboard. So in CI those tables come up with the lock OFF, the assertion
// passes, and CI is structurally incapable of ever seeing the drift, because
// the drift does not live in the files CI reads.
//
// Two things fix that, and this file is the second of them:
//
//   1. 200_dispute_rls_policies.sql DECLARES the intended state in a migration
//      file, so a fresh CI database and the live database finally describe the
//      same schema. The check below can then mean something in CI.
//   2. This test asserts the invariant itself, against whatever database it is
//      pointed at. Pointed at CI it guards the migrations; pointed at live —
//      which is what `npm run guard:db` does at deploy time, after
//      db/migrate.mjs has run — it guards against the next dashboard edit.
//
// See the fix board: this file still needs adding to the `guard:db` script in
// package.json to close loop 2 on live. Until then it runs in CI only.
//
//
// ON SKIPPING
//
// src/security/superuser-guard.test.mjs argues in its own header that a guard
// which skips itself is not a guard. That is right, and the static half below
// honours it — it needs no database and always runs. The catalog half cannot;
// there is nothing to interrogate without a connection. So it skips, loudly
// and with a reason, rather than passing on no evidence.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const HAVE_DB = !!process.env.DATABASE_URL;

// The six tables migration 200 was written to unlock. Named here so that
// deleting them from 200 — or renaming the file out from under it — fails
// here rather than silently re-locking the credit-dispute feature.
const DISPUTE_TABLES = [
  "dispute_cases",
  "dispute_items",
  "dispute_letters",
  "dispute_responses",
  "furnisher_mail_addresses",
  "repair_decision_log"
];

describe("row locks: the declaration in db/ (no database needed)", () => {
  const dir = path.join(ROOT, "db", "migrations");

  test("migration 200 still names every dispute table it was written to unlock", () => {
    const file = path.join(dir, "200_dispute_rls_policies.sql");
    assert.ok(
      fs.existsSync(file),
      "db/migrations/200_dispute_rls_policies.sql is gone — the six credit-dispute tables " +
      "are locked shut again on any database built from db/. Supersede it with a new " +
      "numbered migration instead of deleting it (migrate.mjs keys by filename, so " +
      "editing an applied file is a silent no-op)."
    );
    const sql = fs.readFileSync(file, "utf8");
    const missing = DISPUTE_TABLES.filter((t) => !sql.includes(t));
    assert.deepEqual(
      missing, [],
      "200_dispute_rls_policies.sql no longer names these tables, so nothing unlocks them"
    );
    assert.match(
      sql, /ENABLE ROW LEVEL SECURITY/,
      "200 must DECLARE the lock state, not assume it — that is the whole point of the file. " +
      "Without it, CI builds these tables unlocked while live has them locked, and the guard " +
      "goes blind again."
    );
  });

  test("an unscoped bare-lock sweep still runs after every table-creating migration", () => {
    // 154 was the last unscoped sweep before 160/161 created their tables, which
    // is exactly why it could not cover them. 201 is the current last word.
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const sweeps = files.filter((f) => {
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      return /relrowsecurity\s*=\s*true/.test(sql) &&
             /NOT EXISTS\s*\(\s*SELECT 1 FROM pg_policies/i.test(sql) &&
             !/AND c\.relname\s*=\s*'/.test(sql); // scoped-to-one-table variants do not count
    });
    assert.ok(
      sweeps.length > 0,
      "no unscoped bare-lock sweep exists in db/migrations — a table whose lock is " +
      "switched on outside these files has nothing to repair it"
    );
  });
});

describe("row locks: the live catalog", { skip: HAVE_DB ? false : "no DATABASE_URL — cannot inspect a database that is not there" }, () => {
  let pool;
  const connect = async () => {
    if (!pool) {
      const pg = (await import("pg")).default;
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 20000 });
    }
    return pool;
  };

  test("no table is locked shut — row locks on with no policy attached", async (t) => {
    const p = await connect();
    t.after(async () => { await p.end(); pool = null; });

    const { rows } = await p.query(`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relrowsecurity = true
         AND NOT EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = c.relname
         )
       ORDER BY c.relname
    `);

    assert.deepEqual(
      rows.map((r) => r.table_name), [],
      "these tables have a row lock switched on and no key attached. The application " +
      "reads zero rows from them and cannot write to them at all, and neither failure " +
      "raises an error — it looks exactly like an empty table. Fix with a new migration " +
      "in the style of 200_dispute_rls_policies.sql; do not edit an applied one."
    );
  });

  test("every credit-dispute table is readable by the application again", async (t) => {
    const p = await connect();
    t.after(async () => { await p.end(); pool = null; });

    const { rows } = await p.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity  AS rls_on,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies pp
               WHERE pp.schemaname = 'public' AND pp.tablename = c.relname) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1)
       ORDER BY c.relname
    `, [DISPUTE_TABLES]);

    assert.equal(rows.length, DISPUTE_TABLES.length,
      "a credit-dispute table is missing from this database entirely");

    for (const r of rows) {
      assert.ok(r.policies > 0,
        `${r.table_name} has a row lock on and no key — the credit-dispute feature cannot use it`);
      // rls-bypass.pg.test.mjs requires enabled AND forced wherever a policy exists.
      // Keeping that true here means adding a policy never reds that test.
      assert.equal(r.rls_on, true, `${r.table_name}: row lock should be on`);
      assert.equal(r.forced, true, `${r.table_name}: row lock should be forced`);
    }
  });
});
