// revealSsn against real Postgres — the case that tells a transaction apart
// from autocommit.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHY THIS FILE EXISTS WHEN reveal-transaction.test.mjs ALREADY PASSES.
//
// The obvious test — "make the access-log INSERT fail and check no log row is
// left" — CANNOT tell the two apart. Under autocommit a failed INSERT also
// leaves no row. It fails identically either way, which is exactly the sort of
// test that looks like proof and is not.
//
// The case that distinguishes them is the opposite one: THE LOG WRITE SUCCEEDS
// AND SOMETHING AFTER IT FAILS.
//
//   with a real transaction : ROLLBACK — the log row goes away with it.
//   under autocommit        : the log row is already committed and STAYS.
//
// And that leftover row is not a tidiness problem. It is an audit trail asserting
// that a named employee viewed a client's social security number at a given
// moment — when no number was ever disclosed. A false entry in the one record
// that exists to answer "who saw this person's SSN" is worse than a missing one:
// somebody would defend it under oath.
//
// The failure is induced honestly, with no test-only branch in the module: the
// reveal is called with an environment that has no PII_ENC_KEY, so keyFor()
// throws inside decryptSsn() — AFTER the log insert has run. That is a real
// production failure mode (a rotated-away or unset key), not a contrivance.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { revealSsn, storeIdentity } from "./index.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const STAMP = "pii-reveal-tx-pg-test";
const EMAIL = "pii_reveal_tx_pg_test@example.com";
const SSN = "123456789";

/* Generated per run — a fixed base64 key in a test file is a key in the repo. */
const KEY = crypto.randomBytes(32).toString("base64");
const ENV_WITH_KEY = { PII_ENC_KEY: KEY };
const ENV_WITHOUT_KEY = {};          // the induced failure: no key to decrypt with

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM pii_access_log WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM pii_identity   WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM clients        WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [STAMP]);
}

async function seed() {
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP])).rows[0].id;
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email) VALUES ($1,$2) RETURNING id`, [orgId, EMAIL])).rows[0].id;
  await storeIdentity(db, { orgId, clientId, ssn: SSN, env: ENV_WITH_KEY });
}

const logCount = async () =>
  Number((await db.query(
    `SELECT count(*)::bigint AS n FROM pii_access_log WHERE client_id = $1`, [clientId])).rows[0].n);

before(async () => { if (!HAS_DB) return; await wipe(); await seed(); });
after(async () => { if (!HAS_DB) return; await wipe(); await close(); });

describe("revealSsn against real Postgres", () => {

  test("a successful reveal returns the SSN and leaves exactly one log row", { skip: !HAS_DB }, async () => {
    assert.equal(await logCount(), 0, "sanity: nothing logged yet");

    const out = await revealSsn(db, {
      clientId, accessedBy: "dana@example.test", reason: "pg test", env: ENV_WITH_KEY
    });

    assert.equal(out.ssn, SSN);
    assert.equal(await logCount(), 1, "a disclosure must leave exactly one audit row");

    const row = (await db.query(
      `SELECT accessed_by, field FROM pii_access_log WHERE client_id = $1`, [clientId])).rows[0];
    assert.equal(row.accessed_by, "dana@example.test");
    assert.match(row.field, /^ssn/, "the log must say which field was disclosed");
  });

  test("*** THE ONE THAT MATTERS: a failure AFTER the log write rolls the log row back ***",
    { skip: !HAS_DB }, async () => {
      await wipe(); await seed();
      assert.equal(await logCount(), 0);

      // The access-log INSERT succeeds. decryptSsn() then throws because there is
      // no key in this environment — a real failure mode, induced without a
      // test-only branch anywhere in the module.
      await assert.rejects(
        () => revealSsn(db, { clientId, accessedBy: "dana@example.test", env: ENV_WITHOUT_KEY }),
        (err) => {
          assert.ok(!String(err.message).includes(SSN), "the SSN leaked through the error path");
          return true;
        },
        "a reveal that cannot decrypt must fail"
      );

      assert.equal(await logCount(), 0,
        "THE ACCESS LOG KEPT A ROW FOR A DISCLOSURE THAT NEVER HAPPENED. Under " +
        "autocommit the INSERT commits itself and survives the later failure, " +
        "leaving the audit trail asserting that this employee viewed this client's " +
        "social security number when no number was ever returned. This is the " +
        "assertion the old code fails.");
    });

  test("the rollback is complete — a later successful reveal still logs exactly once",
    { skip: !HAS_DB }, async () => {
      // Guards against the opposite mistake: a rollback so aggressive, or a
      // connection left in a bad state, that the next real reveal silently fails
      // to log. The pool has to come back clean.
      await wipe(); await seed();

      await assert.rejects(() => revealSsn(db, { clientId, accessedBy: "dana", env: ENV_WITHOUT_KEY }));
      assert.equal(await logCount(), 0);

      const out = await revealSsn(db, { clientId, accessedBy: "dana", env: ENV_WITH_KEY });
      assert.equal(out.ssn, SSN);
      assert.equal(await logCount(), 1, "the connection must return to the pool usable");
    });

  test("a reveal for a client with no SSN logs nothing", { skip: !HAS_DB }, async () => {
    await wipe(); await seed();

    const other = (await db.query(
      `INSERT INTO clients (org_id, email) VALUES ($1,$2) RETURNING id`,
      [orgId, "no_ssn_" + EMAIL])).rows[0].id;
    await db.query(
      `INSERT INTO pii_identity (org_id, client_id, dob) VALUES ($1,$2,'1990-01-01')`, [orgId, other]);

    await assert.rejects(
      () => revealSsn(db, { clientId: other, accessedBy: "dana", env: ENV_WITH_KEY }),
      (e) => { assert.equal(e.status, 404); return true; }
    );

    const n = Number((await db.query(
      `SELECT count(*)::bigint AS n FROM pii_access_log WHERE client_id = $1`, [other])).rows[0].n);
    assert.equal(n, 0, "nothing was disclosed, so the log must not claim otherwise");
  });

  test("concurrent reveals each leave their own row", { skip: !HAS_DB }, async () => {
    // Per-reveal transactions must not serialise into one another or drop rows.
    await wipe(); await seed();

    await Promise.all([1, 2, 3, 4, 5].map((i) =>
      revealSsn(db, { clientId, accessedBy: `staff-${i}`, env: ENV_WITH_KEY })));

    assert.equal(await logCount(), 5, "every disclosure needs its own audit row");
  });
});
