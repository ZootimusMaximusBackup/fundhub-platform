// Real-Postgres integration test for soft-pull requests.
// SKIPS unless DATABASE_URL is set.
//
// What this proves that the unit tests cannot: the replay key really dedupes,
// and the four CHECK constraints in 077 hold against every writer — not just
// against this module. Half of these write raw SQL on purpose.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { recordPull, getLatestPull, listPulls, settlePull } from "./index.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "softpull_pg_test@example.com";

let orgId = null;
let clientId = null;
let crsId = null;

async function wipe() {
  await db.query(`DELETE FROM soft_pull_requests WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM crs_results WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

const reset = () => db.query(`DELETE FROM soft_pull_requests WHERE client_id = $1`, [clientId]);

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Soft','Pull') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  crsId = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,'{}'::jsonb) RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("a requested pull is outstanding and has no settled date", { skip: !HAS_DB }, async () => {
  await reset();
  const row = await recordPull(db, {
    orgId, clientId, reason: "Client paid the $32 diagnostic", scope: "consumer_only", sourceEventId: "evt-a"
  });
  assert.equal(row.status, "requested");
  assert.equal(row.settled_at, null);
  assert.equal(row.crs_result_id, null, "a requested pull has no answer yet");
  assert.equal(row.requested_by_staff_id, null, "NULL means automated, not unknown-person");
  assert.equal(row.reason, "Client paid the $32 diagnostic");
});

test("replaying the same event does not record a second pull of the same file", { skip: !HAS_DB }, async () => {
  await reset();
  const first = await recordPull(db, { orgId, clientId, reason: "Diagnostic paid", sourceEventId: "evt-b" });
  const replay = await recordPull(db, { orgId, clientId, reason: "Diagnostic paid", sourceEventId: "evt-b" });

  assert.equal(replay.id, first.id, "the replay returns the row the first delivery wrote");
  assert.deepEqual(replay.requested_at, first.requested_at,
    "and does not move the clock on how long the client has been waiting");
  assert.equal((await listPulls(db, { orgId, clientId })).length, 1);
});

test("two pulls with no source event are two pulls, because there is no key", { skip: !HAS_DB }, async () => {
  await reset();
  const staffId = (await db.query(`SELECT id FROM staff WHERE org_id=$1 LIMIT 1`, [orgId])).rows[0]?.id ?? null;
  if (!staffId) return;   // no seeded staff in this database; nothing to prove here
  await recordPull(db, { orgId, clientId, reason: "Manual review", source: "staff", requestedByStaffId: staffId });
  await recordPull(db, { orgId, clientId, reason: "Manual review", source: "staff", requestedByStaffId: staffId });
  assert.equal((await listPulls(db, { orgId, clientId })).length, 2);
});

test("the database refuses a pull with no stated reason, whatever writes it", { skip: !HAS_DB }, async () => {
  await reset();
  for (const bad of ["", "   "]) {
    await assert.rejects(
      () => db.query(`INSERT INTO soft_pull_requests (org_id, client_id, reason) VALUES ($1,$2,$3)`, [orgId, clientId, bad]),
      /soft_pull_requests_reason_check|violates check constraint/
    );
  }
  await assert.rejects(
    () => db.query(`INSERT INTO soft_pull_requests (org_id, client_id) VALUES ($1,$2)`, [orgId, clientId]),
    /null value in column "reason"/
  );
});

test("an outstanding row may not carry a settled date, and a settled one must", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, reason, status, settled_at)
       VALUES ($1,$2,'r','requested', now())`, [orgId, clientId]),
    /soft_pull_requests_settled_coherent/
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, reason, status) VALUES ($1,$2,'r','failed')`,
      [orgId, clientId]),
    /soft_pull_requests_settled_coherent/,
    "a settled pull with no settled date reads as still waiting, forever"
  );
});

test("only a completed pull may point at a result", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, reason, status, settled_at, crs_result_id)
       VALUES ($1,$2,'r','failed', now(), $3)`, [orgId, clientId, crsId]),
    /soft_pull_requests_result_coherent/
  );
});

test("a staff-sourced request must name the staff member", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(
      `INSERT INTO soft_pull_requests (org_id, client_id, reason, source) VALUES ($1,$2,'r','staff')`,
      [orgId, clientId]),
    /soft_pull_requests_actor_coherent/
  );
});

test("settling completes the request and links the answer to the question", { skip: !HAS_DB }, async () => {
  await reset();
  const req = await recordPull(db, { orgId, clientId, reason: "Diagnostic paid", sourceEventId: "evt-c" });
  const done = await settlePull(db, { orgId, id: req.id, status: "completed", crsResultId: crsId });
  assert.equal(done.status, "completed");
  assert.equal(done.crs_result_id, crsId);
  assert.ok(done.settled_at);

  const again = await settlePull(db, { orgId, id: req.id, status: "failed", failureReason: "late" });
  assert.equal(again, null, "the first settlement is the one that happened");

  const latest = await getLatestPull(db, { orgId, clientId });
  assert.equal(latest.id, req.id);
  assert.equal(latest.status, "completed");
});

test("a failed pull stays visible — it is not the same as never having asked", { skip: !HAS_DB }, async () => {
  await reset();
  const req = await recordPull(db, { orgId, clientId, reason: "Diagnostic paid", sourceEventId: "evt-d" });
  const failed = await settlePull(db, { orgId, id: req.id, status: "failed", failureReason: "engine returned nothing" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.crs_result_id, null);
  assert.equal(failed.failure_reason, "engine returned nothing");

  assert.equal((await getLatestPull(db, { orgId, clientId })).status, "failed",
    "before this table, a failed pull and a pull nobody ran were the same absence");
});
