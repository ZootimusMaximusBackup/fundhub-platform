// The hiring bench sweeper against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// The unit tests script the database, so they prove the pass's shape. What only a
// real engine proves is the thing this job would be worthless without: RUNNING IT
// TWICE IN ONE DAY WRITES ONE TASK. That guarantee is not in this file's code at
// all — it is checkBench's date-scoped dedupe key landing on 006's unique index —
// which is exactly why it has to be measured rather than reasoned about.
//
// It also pins the two silences: a req that is not active is never swept, and a
// bench that is full opens nothing.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { sweep, orgsWithHiringRoles } from "./hiring-bench-sweeper.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "benchsweep";

/* A day of its own. src/hiring/owner.pg.test.mjs cleans up '2026-09-05' tasks by
   date, so sharing that date would let either file delete the other's fixtures
   mid-run. */
const DAY = "2026-09-06";
const NOW = `${DAY}T13:30:00Z`;

describe("hiring bench sweeper", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  const SHORT = `${TAG}_short`;      // active, empty bench, routes to the owner
  const SALES = `${TAG}_sales`;      // active, empty bench, routes to the sales manager
  const CLOSED = `${TAG}_closed`;    // NOT active — must never be swept
  const FULL = `${TAG}_full`;        // active, target 0 — nothing to be short of

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role, active)
       VALUES ($1,$2,'Sweeper fixture — no rule',2,'owner',true)`, [org, SHORT]);
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role, active)
       VALUES ($1,$2,'Sweeper fixture — sales seat',3,'sales_manager',true)`, [org, SALES]);
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role, active)
       VALUES ($1,$2,'Sweeper fixture — closed req',4,'owner',false)`, [org, CLOSED]);
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role, active)
       VALUES ($1,$2,'Sweeper fixture — nothing wanted',0,'owner',true)`, [org, FULL]);
  });

  after(async () => { await cleanup(); await close(); });

  test("a pass opens a task for a short req, routed by the rule", async () => {
    const out = await sweep(db, { orgId: org, now: NOW });

    assert.equal(out.ok, true);
    assert.equal(out.orgs, 1);
    assert.equal(out.failed, 0);
    assert.ok(out.short >= 2, "both fixture reqs start with an empty bench");

    const { rows } = await db.query(
      `SELECT t.assignee_role, t.title, r.key, r.owner_role
         FROM tasks t
         JOIN hiring_roles r ON t.body = 'hiring:bench:' || r.key || ':' || $2
        WHERE t.source_workflow = 'hiring-bench-monitor'
          AND r.org_id = $1 AND r.key IN ($3, $4)
        ORDER BY r.key`, [org, DAY, SHORT, SALES]);

    assert.equal(rows.length, 2, "one task per short req");
    for (const row of rows) {
      assert.equal(row.assignee_role, row.owner_role,
        `${row.key} routed to ${row.assignee_role} but its rule says ${row.owner_role}`);
    }
    assert.equal(rows.find((r) => r.key === SALES).assignee_role, "sales_manager");
    assert.equal(rows.find((r) => r.key === SHORT).assignee_role, "owner");
  });

  test("running it again the same day writes nothing", async () => {
    const countFor = async (key) => Number((await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE source_workflow = 'hiring-bench-monitor' AND body = $1`,
      [`hiring:bench:${key}:${DAY}`])).rows[0].n);

    assert.equal(await countFor(SALES), 1, "the first pass wrote one");

    const second = await sweep(db, { orgId: org, now: NOW });
    const third = await sweep(db, { orgId: org, now: NOW });

    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
    assert.equal(second.tasks_created, 0, "a re-run creates nothing");
    assert.equal(third.tasks_created, 0);
    assert.ok(second.short >= 2, "but the shortfall is still reported");

    assert.equal(await countFor(SALES), 1, "still exactly one task after three passes");
    assert.equal(await countFor(SHORT), 1);
  });

  test("tomorrow's pass raises it again", async () => {
    const NEXT = "2026-09-07";
    try {
      const out = await sweep(db, { orgId: org, now: `${NEXT}T13:30:00Z` });
      assert.ok(out.tasks_created >= 2, "a bench still short tomorrow is still worth saying");
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM tasks
          WHERE source_workflow = 'hiring-bench-monitor' AND body = $1`,
        [`hiring:bench:${SALES}:${NEXT}`]);
      assert.equal(Number(rows[0].n), 1);
    } finally {
      await db.query(
        `DELETE FROM tasks WHERE source_workflow = 'hiring-bench-monitor'
          AND body LIKE $1`, [`%:${NEXT}`]);
    }
  });

  test("a req that is not active is never swept", async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE source_workflow = 'hiring-bench-monitor' AND body LIKE $1`,
      [`hiring:bench:${CLOSED}:%`]);
    assert.equal(Number(rows[0].n), 0, "a closed req must not generate work");
  });

  test("a req that wants nobody on the bench opens nothing", async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE source_workflow = 'hiring-bench-monitor' AND body LIKE $1`,
      [`hiring:bench:${FULL}:%`]);
    assert.equal(Number(rows[0].n), 0);
  });

  test("no candidate row is touched by a pass", async () => {
    // The hard rule: no candidate is ever rejected, advanced or scored by
    // software. The strongest available proof is that the pass does not write to
    // the candidate tables at all.
    const snapshot = async () => (await db.query(
      `SELECT (SELECT count(*) FROM candidates) AS c,
              (SELECT count(*) FROM candidate_applications) AS a,
              (SELECT count(*) FROM hiring_decisions) AS d`)).rows[0];

    const before_ = await snapshot();
    await sweep(db, { orgId: org, now: NOW });
    const after_ = await snapshot();
    assert.deepEqual(after_, before_);
  });

  test("the enumeration finds the company and lists it once", async () => {
    const orgs = await orgsWithHiringRoles(db);
    assert.ok(orgs.includes(org), "the default company has live reqs");
    assert.equal(new Set(orgs).size, orgs.length, "one row per company, not per req");
  });

  async function cleanup() {
    await db.query(
      `DELETE FROM tasks WHERE source_workflow = 'hiring-bench-monitor'
        AND body LIKE $1`, [`%:${DAY}`]);
    await db.query(
      `DELETE FROM tasks WHERE source_workflow = 'hiring-bench-monitor'
        AND body LIKE $1`, [`hiring:bench:${TAG}_%`]);
    await db.query(
      `DELETE FROM hiring_roles WHERE org_id = $1 AND key LIKE $2`, [org, `${TAG}_%`]);
  }
});
