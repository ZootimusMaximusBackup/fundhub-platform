// readProgressFacts against a real Postgres.
//
// The pure half of this module is covered in progress-facts.test.mjs. This is
// the half that has to be true of the actual schema: that the newest round wins,
// that only a step the CLIENT owns is nudged, and that an absence stays an
// absence rather than becoming a default.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { readProgressFacts } from "./progress-facts.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("progress facts", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, bare, full;
  const MARK = "progfacts";

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    const mk = async (n) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Prog',$2,$3) RETURNING id`,
      [org, n, `${MARK}.${n}@example.com`.toLowerCase()])).rows[0].id;
    bare = await mk("Bare");
    full = await mk("Full");
  });

  async function purge() {
    const cids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    if (cids.length) {
      await db.query(`DELETE FROM client_waypoints WHERE client_id = ANY($1)`, [cids]);
      await db.query(`DELETE FROM dispute_cases WHERE client_id = ANY($1)`, [cids]);
      await db.query(`DELETE FROM repair_programs WHERE client_id = ANY($1)`, [cids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [cids]);
    }
  }
  after(async () => { await purge(); await close(); });

  test("a client with nothing on file is UNKNOWN, not round 1 of 6", async () => {
    const f = await readProgressFacts(db, { orgId: org, clientId: bare });
    assert.equal(f.known, false);
    assert.equal(f.roundCurrent, null, "a client with no case was placed on a round");
    assert.equal(f.roundCap, null, "a client with no programme was given a cap");
    assert.equal(f.expectedResponseBy, null);
    assert.equal(f.nextStep, null);
  });

  test("the newest round wins over an older case still sitting open", async () => {
    // A client on R3 with a stale R1 row must not be reported as being on R1.
    await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status)
       VALUES ($1,$2,'EX','R1','open')`, [org, full]);
    await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status, response_due_at)
       VALUES ($1,$2,'EQ','R3','awaiting_response', now() + interval '20 days')`, [org, full]);
    await db.query(
      `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total)
       VALUES ($1,$2,'full',6,3000)`, [org, full]);

    const f = await readProgressFacts(db, { orgId: org, clientId: full });
    assert.equal(f.known, true);
    assert.equal(f.roundCurrent, 3, "an older open case won over the newest round");
    assert.equal(f.roundCap, 6);
    assert.match(f.stageWords, /waiting on their reply/);
    assert.match(f.expectedResponseBy, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("a closed case does not decide where the file is", async () => {
    const c = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Prog','Closed',$2) RETURNING id`,
      [org, `${MARK}.closed@example.com`])).rows[0].id;
    await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status)
       VALUES ($1,$2,'TU','R5','closed')`, [org, c]);
    const f = await readProgressFacts(db, { orgId: org, clientId: c });
    assert.equal(f.roundCurrent, null, "a closed case was reported as the current round");
  });

  test("only a step the CLIENT owns is offered as the next thing", async () => {
    await db.query(
      `INSERT INTO client_waypoints
         (org_id, client_id, key, title, position, owner_kind, state)
       VALUES ($1,$2,'we_mail_it','We post your letters',1,'fundhub','in_progress')`,
      [org, full]);
    await db.query(
      `INSERT INTO client_waypoints
         (org_id, client_id, key, title, position, owner_kind, state, due_at)
       VALUES ($1,$2,'proof_address','Proof of address',2,'client','not_started',
               now() - interval '3 days')`,
      [org, full]);

    const f = await readProgressFacts(db, { orgId: org, clientId: full });
    assert.ok(f.nextStep, "no next step came back");
    assert.equal(f.nextStep.title, "Proof of address",
      "a step Fundhub owes was offered to the client as their next move");
    assert.equal(f.nextStep.overdue, true, "a past due date did not read as overdue");
  });

  test("a completed step is not offered again", async () => {
    await db.query(
      `UPDATE client_waypoints SET state = 'done', completed_at = now()
        WHERE client_id = $1 AND key = 'proof_address'`, [full]);
    const f = await readProgressFacts(db, { orgId: org, clientId: full });
    assert.equal(f.nextStep, null, "a finished step was still being asked for");
  });

  test("a missing scope answers unknown rather than reading somebody else's file", async () => {
    assert.equal((await readProgressFacts(db, { orgId: org })).known, false);
    assert.equal((await readProgressFacts(db, { clientId: full })).known, false);
    assert.equal((await readProgressFacts(null, { orgId: org, clientId: full })).known, false);
  });
});
