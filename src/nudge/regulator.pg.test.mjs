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

/* ── the INSERT hole, and the honest edge of what is enforced ─────────────── */

test("a complaint CANNOT be born already filed", { skip: !HAS_DB }, async () => {
  /* THE HOLE THIS CLOSES. 366's forward-only trigger was BEFORE UPDATE OF state,
     so an INSERT never fired it. A single statement landing straight on 'filed'
     satisfied every CHECK and skipped both rungs. Measured on a scratch database
     on 2026-09-06 before db/migrations/367: ACCEPTED. */
  await assert.rejects(
    db.query(
      `INSERT INTO regulator_complaints (org_id, client_id, kind, state, sent_at, filed_at, filed_source)
       VALUES ($1,$2,'cfpb','filed',now(),now(),$3)`,
      [orgId, clientId, FILED_SOURCE]
    ),
    /cannot be created already filed/
  );
  assert.deepEqual(await complaintsFor(db, clientId), [],
    "and no row was left behind");
});

test("a complaint may still be born prepared, or born sent", { skip: !HAS_DB }, async () => {
  /* The guard refuses ONE starting state. Closing the other two would break
     prepareComplaint and any path that records a pack going out in one
     statement, and neither of those is a claim about a regulator. */
  await db.query(
    `INSERT INTO regulator_complaints (org_id, client_id, kind, state)
     VALUES ($1,$2,'cfpb','prepared')`, [orgId, clientId]);
  await db.query(
    `INSERT INTO regulator_complaints (org_id, client_id, kind, state, sent_at)
     VALUES ($1,$2,'state_ag','sent',now())`, [orgId, clientId]);
  const states = (await complaintsFor(db, clientId)).map((c) => c.state).sort();
  assert.deepEqual(states, ["prepared", "sent"]);
});

test("KNOWN LIMIT: raw SQL claiming the client said so is accepted, and cannot be refused here",
  { skip: !HAS_DB }, async () => {
    /* THIS TEST PINS A GAP, NOT A GUARANTEE, and it exists because the journey
       page used to claim the opposite — "no staff member, no workflow and no
       hand-written SQL can put a complaint in that state".

       filed_source='client_reported' IS the assertion "the client told us". A
       database can refuse a row that does not carry the assertion; it cannot
       tell a true assertion from a false one. So a hand-written UPDATE on a row
       already at 'sent', carrying the source, is accepted — and if this test
       ever starts failing because somebody closed it, that is good news and the
       journey page should be widened again to match.

       What IS enforced is proved by the three tests above and this one's own
       second half: no filed row without filed_at AND filed_source, no
       prepared→filed, no INSERT at filed, no move backwards. */
    const { id } = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
    await markComplaintSent(db, { clientId, kind: "cfpb" });
    await db.query(
      `UPDATE regulator_complaints SET state='filed', filed_at=now(), filed_source=$2 WHERE id=$1`,
      [id, FILED_SOURCE]
    );
    const [row] = await complaintsFor(db, clientId);
    assert.equal(row.state, "filed");
    assert.equal(row.filed_source, FILED_SOURCE,
      "so a page rendering it must print WHO said so, because that is all we have");

    // The half that IS enforced: it cannot be filed without saying who said so.
    await db.query(`DELETE FROM regulator_complaints WHERE id = $1`, [id]);
    const second = await prepareComplaint(db, { orgId, clientId, kind: "cfpb" });
    await markComplaintSent(db, { clientId, kind: "cfpb" });
    await assert.rejects(
      db.query(
        `UPDATE regulator_complaints SET state='filed', filed_at=now() WHERE id=$1`,
        [second.id]
      ),
      /regulator_complaints_filed_ck/
    );
  });

test("the client-facing letter still refuses to say a complaint was filed",
  { skip: !HAS_DB }, async () => {
    /* The product rule is unchanged and owner-set: nothing in this system knows
       whether a CFPB or state AG complaint was actually submitted, so a client
       must never see rounds 4 or 5 rendered as filed on our say-so.

       src/metro2/ belongs to another lane and is NOT edited here — this reads
       it, to prove that recording a filing has not quietly switched the letter
       copy on. Round 6 reuses the Round 3 final notice and its own label says
       why it does not stand on the complaints. */
    const { roundLadderEntry, LADDER_ROUNDS } = await import("../metro2/letters/catalog.mjs");
    const rungs = LADDER_ROUNDS.map((r) => roundLadderEntry(r));

    /* Exactly one rung's copy is allowed to contain the word "filed", and only
       because it is the sentence saying we do NOT claim it. Written this way
       rather than as a keyword ban, because a keyword ban would fail on the
       disclaimer itself and would then be deleted by the next person. */
    const mentions = rungs.filter((x) => /\bfiled\b/i.test(`${x.title} ${x.sendWhen}`));
    assert.deepEqual(mentions.map((x) => x.round), ["R6"],
      `only R6 may mention a filing, and only to disclaim it: ${JSON.stringify(mentions)}`);
    assert.match(mentions[0].sendWhen, /does not claim either complaint was filed/,
      "R6 says out loud that it makes no claim about a filing");

    /* And rounds 4 and 5 — the two complaints themselves — say only when they
       go out, never that they arrived anywhere. */
    for (const round of ["R4", "R5"]) {
      const rung = rungs.find((x) => x.round === round);
      assert.equal(/\bfiled\b/i.test(`${rung.title} ${rung.sendWhen}`), false,
        `${round} must not claim a filing: ${JSON.stringify(rung)}`);
    }
  });
