// Real-Postgres test for the soft-pull audit record.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that store.test.mjs cannot: 077's constraints hold against
// the database, the newest-first ordering is real, and the nullable columns
// really do accept NULL — which matters, because "requested_by is nullable" is
// the whole reason the only pull path in this system can write an audit record
// at all.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { recordPull, completePull, getLatestPull, listPulls } from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "softpull_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM soft_pull_requests WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM crs_results WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Soft','Pull') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const newResult = async () => (await db.query(
  `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,'{}'::jsonb) RETURNING id`,
  [orgId, clientId]
)).rows[0].id;

test("a workflow-initiated pull writes an audit row with no actor and no consent", { skip: !HAS_DB }, async () => {
  const row = await recordPull(db, { orgId, clientId, scope: "consumer_plus_ex_business" });
  assert.equal(row.status, "requested");
  assert.equal(row.pull_type, "soft");
  assert.equal(row.scope, "consumer_plus_ex_business");
  assert.equal(row.requested_by, null,
    "the C-00 path has no staff member — a NOT NULL column here would make this table unwritable");
  assert.equal(row.consent_document_id, null);
  assert.equal(row.reason, null);
  assert.ok(row.requested_at, "when it was asked for is never unknown");
  assert.equal(row.completed_at, null);
});

test("the database refuses a completed pull that carries no result", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, status, completed_at) VALUES ($1,$2,'completed',NULL)`,
      [orgId, clientId]),
    (e) => e.code === "23514",
    "the row a dispute is answered from must not claim completion with nothing to show");
});

test("the database refuses an uncompleted pull that claims a result", { skip: !HAS_DB }, async () => {
  const resultId = await newResult();
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, status, result_id) VALUES ($1,$2,'requested',$3)`,
      [orgId, clientId, resultId]),
    (e) => e.code === "23514");
});

test("the database refuses a pull type it was not told about", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO soft_pull_requests (org_id, client_id, pull_type) VALUES ($1,$2,'medium')`,
      [orgId, clientId]),
    (e) => e.code === "23514");
});

test("completing a pull records the result and stamps the time", { skip: !HAS_DB }, async () => {
  const req = await recordPull(db, { orgId, clientId, reason: "Funding application review" });
  const resultId = await newResult();
  const done = await completePull(db, { id: req.id, resultId });

  assert.equal(done.status, "completed");
  assert.equal(done.result_id, resultId);
  assert.ok(done.completed_at, "a completed pull carries the time it completed");
  assert.equal(done.reason, "Funding application review", "the basis survives the update");
});

test("purging a bureau payload does not erase the evidence a pull was requested", { skip: !HAS_DB }, async () => {
  const req = await recordPull(db, { orgId, clientId });
  const resultId = await newResult();
  await completePull(db, { id: req.id, resultId });

  await db.query(`DELETE FROM crs_results WHERE id = $1`, [resultId]);

  const still = (await db.query(`SELECT * FROM soft_pull_requests WHERE id = $1`, [req.id])).rows[0];
  assert.ok(still, "the request is the audit record and must outlive the data it produced");
  assert.equal(still.result_id, null, "the link is cleared, the row is not");
  assert.equal(still.status, "completed");
});

test("replaying a provider webhook cannot record the same pull twice", { skip: !HAS_DB }, async () => {
  await recordPull(db, { orgId, clientId, providerRef: "crs_req_replay" });
  await assert.rejects(
    () => recordPull(db, { orgId, clientId, providerRef: "crs_req_replay" }),
    (e) => e.code === "23505",
    "a replayed webhook would otherwise make a client look like they were pulled repeatedly");
});

test("two requests with no provider id are both kept", { skip: !HAS_DB }, async () => {
  const before = (await listPulls(db, { clientId })).length;
  await recordPull(db, { orgId, clientId });
  await recordPull(db, { orgId, clientId });
  assert.equal((await listPulls(db, { clientId })).length, before + 2,
    "two requests nobody can prove are the same must both survive");
});

test("getLatestPull returns the newest and never the bureau payload", { skip: !HAS_DB }, async () => {
  await recordPull(db, { orgId, clientId, reason: "older" });
  const newest = await recordPull(db, { orgId, clientId, reason: "newest", pullType: "hard" });

  const latest = await getLatestPull(db, { clientId });
  assert.equal(latest.id, newest.id);
  assert.equal(latest.reason, "newest");
  assert.ok(!("result" in latest), "the most sensitive object in this database is not in a summary");
});

test("getLatestPull narrows to a pull type", { skip: !HAS_DB }, async () => {
  const soft = await recordPull(db, { orgId, clientId, reason: "soft one" });
  const latestSoft = await getLatestPull(db, { clientId, pullType: "soft" });
  assert.equal(latestSoft.id, soft.id);

  const latestHard = await getLatestPull(db, { clientId, pullType: "hard" });
  assert.equal(latestHard.pull_type, "hard");
});

test("getLatestPull is null for a client who has never been pulled", { skip: !HAS_DB }, async () => {
  const other = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'No','Pull') RETURNING id`,
    [orgId, "softpull_none_pg_test@example.com"]
  )).rows[0].id;
  try {
    assert.equal(await getLatestPull(db, { clientId: other }), null);
  } finally {
    await db.query(`DELETE FROM clients WHERE id=$1`, [other]);
  }
});
