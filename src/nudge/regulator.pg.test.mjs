// Rounds 4 and 5 — the regulator ping.
//
// ONE CLAIM, and everything here exists to prove it: nothing can render a CFPB
// or state attorney general complaint as FILED except the client saying they
// filed it. Not staff, not a workflow, not raw SQL.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  prepareComplaint, markComplaintSent, recordClientAnswer, complaintsFor, FILED_SOURCE
} from "./regulator.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "regulator-ping-pg-test";

let orgId = null;
let clientId = null;

async function wipe() {
  if (!orgId) return;
  await db.query(`DELETE FROM regulator_complaints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM client_waypoints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Regulator Ping Pg Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
  )).rows[0].id;
  await wipe();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await wipe();
  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Reg','Ping','reg@regulator-ping-pg-test.example.com') RETURNING id`,
    [orgId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  await close();
});

const makeWaypoint = async () => (await db.query(
  `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, due_at)
   VALUES ($1,$2,'file_cfpb','File the CFPB complaint','client','not_started', now() - interval '1 day')
   RETURNING id`,
  [orgId, clientId]
)).rows[0].id;

test("a prepared complaint is prepared and nothing more", { skip: !HAS_DB }, async () => {
  const row = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  assert.equal(row.state, "prepared");
  const [c] = await complaintsFor(db, clientId);
  assert.equal(c.sent_at, null);
  assert.equal(c.filed_at, null);
  assert.equal(c.filed_source, null);
  assert.equal(c.case_number, null);
});

test("preparing twice is one row, not two", { skip: !HAS_DB }, async () => {
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  assert.equal((await complaintsFor(db, clientId)).length, 1);
});

test("sending stamps the date it really went, and re-sending does not restamp it",
  { skip: !HAS_DB }, async () => {
    await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
    const first = await markComplaintSent(db, { clientId, kind: "cfpb", at: new Date("2026-09-01T12:00:00Z") });
    assert.equal(first.changed, true);
    const again = await markComplaintSent(db, { clientId, kind: "cfpb", at: new Date("2026-09-05T12:00:00Z") });
    assert.equal(again.changed, false);
    const [c] = await complaintsFor(db, clientId);
    assert.equal(new Date(c.sent_at).toISOString(), "2026-09-01T12:00:00.000Z");
  });

test("ONLY the client answering yes moves it to filed", { skip: !HAS_DB }, async () => {
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await markComplaintSent(db, { clientId, kind: "cfpb" });

  const res = await recordClientAnswer(db, {
    clientId, kind: "cfpb", filed: true, caseNumber: "250901-1234567"
  });
  assert.equal(res.changed, true);
  assert.equal(res.state, "filed");
  assert.equal(res.filed_source, FILED_SOURCE);
  assert.equal(res.case_number, "250901-1234567");
});

test("the client saying NO leaves it at sent, and the waypoint open", { skip: !HAS_DB }, async () => {
  const waypointId = await makeWaypoint();
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb", waypointId });
  await markComplaintSent(db, { clientId, kind: "cfpb" });

  const res = await recordClientAnswer(db, { clientId, kind: "cfpb", filed: false });
  assert.equal(res.changed, false);
  assert.equal(res.state, "sent");
  const wp = (await db.query(`SELECT state FROM client_waypoints WHERE id = $1`, [waypointId])).rows[0];
  assert.equal(wp.state, "not_started", "the waypoint stays open");
});

test("SILENCE IS NOT A YES — no answer changes nothing", { skip: !HAS_DB }, async () => {
  await prepareComplaint(db, { orgId, clientId, kind: "state_ag" });
  await markComplaintSent(db, { clientId, kind: "state_ag" });
  const res = await recordClientAnswer(db, { clientId, kind: "state_ag" });
  assert.equal(res.changed, false);
  assert.equal(res.state, "sent");
});

test("a yes closes the client's checklist row too, so the ping stops", { skip: !HAS_DB }, async () => {
  const waypointId = await makeWaypoint();
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb", waypointId });
  await markComplaintSent(db, { clientId, kind: "cfpb" });
  await recordClientAnswer(db, { clientId, kind: "cfpb", filed: true, at: new Date("2026-09-04T10:00:00Z") });

  const wp = (await db.query(
    `SELECT state, completed_at FROM client_waypoints WHERE id = $1`, [waypointId]
  )).rows[0];
  assert.equal(wp.state, "done");
  assert.equal(new Date(wp.completed_at).toISOString(), "2026-09-04T10:00:00.000Z");
});

test("a complaint that never left us cannot have been filed", { skip: !HAS_DB }, async () => {
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  const res = await recordClientAnswer(db, { clientId, kind: "cfpb", filed: true });
  assert.equal(res.changed, false);
  assert.equal(res.reason, "not_sent_yet");
  assert.equal((await complaintsFor(db, clientId))[0].state, "prepared");
});

test("RAW SQL cannot write filed without the client having said so", { skip: !HAS_DB }, async () => {
  const { id } = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await markComplaintSent(db, { clientId, kind: "cfpb" });

  // No filed_source: the CHECK refuses it.
  await assert.rejects(
    db.query(`UPDATE regulator_complaints SET state='filed', filed_at=now() WHERE id=$1`, [id]),
    /regulator_complaints_filed_ck/
  );
  // A made-up source: the CHECK refuses that too.
  await assert.rejects(
    db.query(
      `UPDATE regulator_complaints SET state='filed', filed_at=now(), filed_source='staff_assumed' WHERE id=$1`,
      [id]
    ),
    // Either constraint is a legitimate refusal — both are violated, and
    // Postgres reports whichever it evaluates first.
    /regulator_complaints_(filed_source_ck|filed_ck)/
  );
  assert.equal((await complaintsFor(db, clientId))[0].state, "sent");
});

test("the state machine only goes forward, and never skips the middle", { skip: !HAS_DB }, async () => {
  const { id } = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await assert.rejects(
    db.query(
      `UPDATE regulator_complaints SET state='filed', filed_at=now(), filed_source=$2 WHERE id=$1`,
      [id, FILED_SOURCE]
    ),
    /cannot skip to filed/
  );
  await markComplaintSent(db, { clientId, kind: "cfpb" });
  await recordClientAnswer(db, { clientId, kind: "cfpb", filed: true });
  await assert.rejects(
    db.query(`UPDATE regulator_complaints SET state='sent' WHERE id=$1`, [id]),
    /cannot move back to sent/
  );
});

test("a case number cannot exist without a filing", { skip: !HAS_DB }, async () => {
  const { id } = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await assert.rejects(
    db.query(`UPDATE regulator_complaints SET case_number='250901-1' WHERE id=$1`, [id]),
    /regulator_complaints_case_state_ck/
  );
});

test("a blank case number is dropped rather than stored as proof", { skip: !HAS_DB }, async () => {
  await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
  await markComplaintSent(db, { clientId, kind: "cfpb" });
  const res = await recordClientAnswer(db, { clientId, kind: "cfpb", filed: true, caseNumber: "   " });
  assert.equal(res.case_number, null, "NULL means we do not know, not an empty string");
});

test("answering about a complaint that does not exist changes nothing", { skip: !HAS_DB }, async () => {
  const res = await recordClientAnswer(db, { clientId, kind: "cfpb", filed: true });
  assert.equal(res.changed, false);
  assert.equal(res.reason, "no_complaint");
});
