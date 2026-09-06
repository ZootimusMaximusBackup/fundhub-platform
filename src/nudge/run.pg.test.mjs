// The eight proofs. Every one of these is a thing that has to be WATCHED
// happening against a real Postgres, because seven of the eight are enforced by
// a unique index or a CHECK and a mock database would assert nothing at all.
//
// The bar these are written to: on 2026-09-03 a chase loop in this product sent
// 51 identical texts to one phone in two hours. A loop that sends nothing is a
// success. A loop that sends twice is a failure.
//
// THIS SUITE OWNS ITS OWN ORG and every client in it, so a concurrent suite's
// rows cannot inflate a count and nothing here touches the default org.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { planNudges, deliverNudge, runNudges, idempotencyKeyFor, STAFF_TASK_ROLE } from "./run.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "waypoint-nudge-pg-test";
const EMAIL_TAG = "@waypoint-nudge-pg-test.example.com";

/* 18:00 UTC is 11:00 in Phoenix — the middle of the open window, so nothing
   here is accidentally a quiet-hours test. Fixed, so a suite run at 2am does
   not quietly change what is being asserted. */
const NOON = new Date("2026-09-10T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const overdueBy = (days) => new Date(NOON.getTime() - days * DAY);

let orgId = null;

/* The three template keys the ladder can use, inserted for THIS org. The seed
   (db/seed/025) writes them for every org that existed when it ran; this org is
   created afterwards, so it needs its own copies. */
const TEMPLATES = [
  ["SMS-WAYPOINT-DUE", "sms", null, "Due today: {{waypoint.title}}. Reply STOP to opt out."],
  ["EMAIL-WAYPOINT-NUDGE-1", "email", "Still open", "Still open: {{waypoint.title}}."],
  ["SMS-WAYPOINT-NUDGE-2", "sms", null, "Still open: {{waypoint.title}}. Reply STOP to opt out."]
];

async function wipe() {
  if (!orgId) return;
  const ids = `(SELECT id FROM clients WHERE org_id = '${orgId}')`;
  await db.query(`DELETE FROM waypoint_nudges WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM regulator_complaints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM paid_service_requests WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM client_waypoints WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM repair_programs WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM tasks WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM messages WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM conversations WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM opt_outs WHERE client_id IN ${ids}`);
  await db.query(`DELETE FROM accounts WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM events WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Waypoint Nudge Pg Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ORG_SLUG]
  )).rows[0].id;
  await wipe();
  for (const [key, channel, subject, body] of TEMPLATES) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (org_id, template_key) DO UPDATE
         SET body = EXCLUDED.body, compliance_passed = true`,
      [orgId, key, channel, subject, body]
    );
  }
});

beforeEach(async () => { if (HAS_DB) await wipe(); });

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  await close();
});

/* ── fixtures ─────────────────────────────────────────────────────────────── */

let seq = 0;
async function makeClient({ phone = "+15555550123", email = null, tz = "America/Phoenix" } = {}) {
  seq += 1;
  const addr = email === null ? `nudge${seq}${EMAIL_TAG}` : email;
  return (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone, custom_fields)
     VALUES ($1,'Nudge','Test',$2,$3,$4) RETURNING id`,
    [orgId, addr, phone, JSON.stringify(tz ? { timezone: tz } : {})]
  )).rows[0].id;
}

async function makeWaypoint(clientId, {
  key = null, title = "Upload your ID", ownerKind = "client",
  state = "not_started", dueDaysAgo = 0
} = {}) {
  seq += 1;
  return (await db.query(
    `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orgId, clientId, key || `step_${seq}`, title, ownerKind, state, overdueBy(dueDaysAgo).toISOString()]
  )).rows[0].id;
}

/* paid_service_requests_requester_ck (331) wants a real account behind a
   client-made request: "exactly one requester, and it must be the kind the row
   claims". So the fixture makes one rather than weakening the constraint. */
async function makeClientAccount(clientId) {
  seq += 1;
  return (await db.query(
    `INSERT INTO accounts (org_id, kind, email, name, client_id, status)
     VALUES ($1,'client',$2,'Nudge Test',$3,'invited')
     ON CONFLICT (client_id) WHERE client_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgId, `acct${seq}${EMAIL_TAG}`, clientId]
  )).rows[0].id;
}

const countMessages = async (clientId) =>
  Number((await db.query(
    `SELECT count(*)::int AS n FROM messages WHERE client_id = $1 AND direction = 'outbound'`,
    [clientId]
  )).rows[0].n);

const nudgeRows = async (waypointId) =>
  (await db.query(
    `SELECT step, kind, channel, outcome, client_local_date, message_id, task_id, detail
       FROM waypoint_nudges WHERE waypoint_id = $1 ORDER BY step`,
    [waypointId]
  )).rows;

/* ── PROOF 1 ──────────────────────────────────────────────────────────────── */

test("a waypoint completed between scheduling and sending: NOTHING SENDS",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);

    // Phase 1: the plan is made while the waypoint is genuinely overdue.
    const plan = await planNudges(db, { orgId, now: NOON });
    assert.equal(plan.length, 1, "the overdue waypoint is a candidate");
    assert.equal(plan[0].step, 1);

    // The client finishes it in the gap.
    await db.query(
      `UPDATE client_waypoints SET state = 'done', completed_at = now() WHERE id = $1`,
      [waypointId]
    );

    // Phase 2 re-decides against the live row.
    const res = await deliverNudge(db, plan[0], { now: NOON });
    assert.equal(res.action, "skipped");
    assert.ok(res.reasons.includes("waypoint_complete"), JSON.stringify(res.reasons));
    assert.equal(await countMessages(clientId), 0, "no message row was written");
    assert.deepEqual(await nudgeRows(waypointId), [], "no rung was spent");
  });

/* ── PROOF 2 ──────────────────────────────────────────────────────────────── */

test("sixteen duplicate triggers for one step: ONE message row",
  { skip: !HAS_DB }, async () => {
    // Sixteen is not an arbitrary number. The provider fired roughly sixteen
    // duplicate webhooks per survey on 2026-09-03, and each one started its own
    // run.
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const [candidate] = await planNudges(db, { orgId, now: NOON });

    const results = [];
    for (let i = 0; i < 16; i += 1) {
      results.push(await deliverNudge(db, candidate, { now: NOON }));
    }

    assert.equal(await countMessages(clientId), 1, "exactly one message row");
    const rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "exactly one ladder row");
    assert.equal(rows[0].outcome, "queued");
    assert.equal(results.filter((r) => r.action === "queued").length, 1);
    assert.equal(results.filter((r) => r.action === "skipped").length, 15);

    // The event log carries the same one key, once.
    const events = (await db.query(
      `SELECT count(*)::int AS n FROM events WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, idempotencyKeyFor(waypointId, 1)]
    )).rows[0].n;
    assert.equal(Number(events), 1, "one event, not sixteen");
  });

test("sixteen triggers fired CONCURRENTLY still produce one message row",
  { skip: !HAS_DB }, async () => {
    // The sequential version above would pass even with a check-then-write
    // guard. This one would not: it is the shape that proves the database is
    // the thing deciding, not the code.
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const [candidate] = await planNudges(db, { orgId, now: NOON });

    const settled = await Promise.allSettled(
      Array.from({ length: 16 }, () => deliverNudge(db, candidate, { now: NOON }))
    );
    const queued = settled.filter((s) => s.status === "fulfilled" && s.value.action === "queued");

    assert.equal(await countMessages(clientId), 1, "exactly one message row");
    assert.equal((await nudgeRows(waypointId)).length, 1, "exactly one ladder row");
    assert.equal(queued.length, 1, "exactly one caller believes it queued");
  });

/* ── PROOF 3 ──────────────────────────────────────────────────────────────── */

test("three overdue waypoints, one client, one day: ONE message",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const a = await makeWaypoint(clientId, { key: "upload_id", title: "Upload your ID" });
    const b = await makeWaypoint(clientId, { key: "sign_agreement", title: "Sign the agreement" });
    const c = await makeWaypoint(clientId, { key: "link_bank", title: "Link your bank" });

    const tally = await runNudges(db, { orgId, now: NOON });

    assert.equal(tally.considered, 3, "all three were candidates");
    assert.equal(tally.queued, 1, "one message, not three");
    assert.equal(await countMessages(clientId), 1);

    const spent = [a, b, c].map(async (id) => (await nudgeRows(id)).length);
    assert.equal((await Promise.all(spent)).reduce((x, y) => x + y, 0), 1,
      "the other two rungs are NOT spent — they are chased on a later day");

    const capped = tally.results.filter((r) => (r.reasons || []).includes("daily_cap"));
    assert.equal(capped.length, 2, "the other two say why");
  });

test("the daily cap is the client's own calendar day, and it releases the next day",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { key: "upload_id" });
    await makeWaypoint(clientId, { key: "sign_agreement" });

    const day1 = await runNudges(db, { orgId, now: NOON });
    assert.equal(day1.queued, 1);
    const day2 = await runNudges(db, { orgId, now: new Date(NOON.getTime() + DAY) });
    assert.equal(day2.queued, 1, "the second waypoint is chased the next day");
    assert.equal(await countMessages(clientId), 2);
  });

/* ── PROOF 4 ──────────────────────────────────────────────────────────────── */

test("the paid alternative bought: the chase stops",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const accountId = await makeClientAccount(clientId);
    await db.query(
      `INSERT INTO paid_service_requests
         (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
          requested_by_account_id, status,
          price_components, price_total_cents, amount_paid_cents, paid_at)
       VALUES ($1,$2,$3,'dispute_round','client',$4,'paid',
               '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
               10000, 10000, now())`,
      [orgId, clientId, waypointId, accountId]
    );

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0,
      "never chase somebody to do the thing they just paid us to do");
    const reasons = tally.results.flatMap((r) => r.reasons || []);
    assert.ok(reasons.includes("paid_alternative_bought"), JSON.stringify(reasons));
  });

test("a quote nobody paid does NOT silence the ladder forever",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    const accountId = await makeClientAccount(clientId);
    await db.query(
      `INSERT INTO paid_service_requests
         (org_id, client_id, waypoint_id, service_kind, requested_by_kind,
          requested_by_account_id, status,
          price_components, price_total_cents)
       VALUES ($1,$2,$3,'dispute_round','client',$4,'quoted',
               '[{"code":"round_base","label":"Dispute round","quantity":1,"unit_cents":10000,"amount_cents":10000}]'::jsonb,
               10000)`,
      [orgId, clientId, waypointId, accountId]
    );
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 1, "a quote is not a purchase");
  });

/* ── PROOF 5 ──────────────────────────────────────────────────────────────── */

test("STOP received: the chase stops and STAYS stopped",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);

    // The existing suppression path — the same table src/handlers/comms.mjs
    // writes on a STOP keyword, through the same helper. No second store.
    await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");

    for (const days of [0, 2, 5, 9, 30]) {
      const at = new Date(NOON.getTime() + days * DAY);
      const tally = await runNudges(db, { orgId, now: at });
      assert.equal(tally.queued, 0, `nothing queued on day ${days}`);
      assert.equal(tally.staff_tasks, 0, `no task either on day ${days}`);
    }
    assert.equal(await countMessages(clientId), 0);
    assert.deepEqual(await nudgeRows(waypointId), []);
  });

test("STOP on SMS also stops the email rung — the word means stop, not stop-by-text",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { dueDaysAgo: 3 }); // rung 2 is email
    await recordOptOut(db, clientId, orgId, "sms", "inbound_keyword");
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0);
  });

/* ── PROOF 6 ──────────────────────────────────────────────────────────────── */

test("step 4 reached: a staff task, and no fifth client message EVER",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId, { dueDaysAgo: 9, title: "Upload your ID" });

    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.staff_tasks, 1);
    assert.equal(tally.queued, 0);
    assert.equal(await countMessages(clientId), 0, "step 4 sends the client nothing");

    const task = (await db.query(
      `SELECT title, assignee_role, source_workflow FROM tasks WHERE client_id = $1`,
      [clientId]
    )).rows;
    assert.equal(task.length, 1);
    assert.match(task[0].title, /Upload your ID/);
    assert.equal(task[0].assignee_role, STAFF_TASK_ROLE);

    // Now keep running, for a month. Nothing more may ever happen.
    for (const days of [0, 1, 5, 12, 30]) {
      await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
    }
    assert.equal(await countMessages(clientId), 0, "still no client message");
    const rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "one rung spent, and it is the last one");
    assert.equal(rows[0].step, 4);
    assert.equal(rows[0].kind, "staff_task");
    assert.equal(
      Number((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE client_id = $1`, [clientId])).rows[0].n),
      1, "one task, not one per pass"
    );
  });

test("the database itself refuses a fifth rung", { skip: !HAS_DB }, async () => {
  // The cap is stored, not remembered. Even raw SQL cannot write step 5.
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
       VALUES ($1,$2,$3,5,'client_message','sms','forced')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_(step|shape)_ck/
  );
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, idempotency_key)
       VALUES ($1,$2,$3,5,'staff_task','forced-2')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_(step|shape)_ck/
  );
  // And a second row on a rung that is already spent cannot exist either.
  await db.query(
    `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
     VALUES ($1,$2,$3,1,'client_message','sms','first')`,
    [orgId, clientId, waypointId]
  );
  await assert.rejects(
    db.query(
      `INSERT INTO waypoint_nudges (org_id, client_id, waypoint_id, step, kind, channel, idempotency_key)
       VALUES ($1,$2,$3,1,'client_message','sms','second')`,
      [orgId, clientId, waypointId]
    ),
    /waypoint_nudges_waypoint_step_uq/
  );
});

test("a whole ladder walked end to end is four rows and three messages",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const waypointId = await makeWaypoint(clientId);
    // One pass per rung day. The one-per-day cap means one message per pass.
    for (const days of [0, 2, 5, 9, 11, 20]) {
      await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
    }
    const rows = await nudgeRows(waypointId);
    assert.deepEqual(rows.map((r) => r.step), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((r) => r.kind),
      ["client_message", "client_message", "client_message", "staff_task"]);
    assert.deepEqual(rows.map((r) => r.channel), ["sms", "email", "sms", null]);
    assert.equal(await countMessages(clientId), 3, "three client messages, ever");
  });

/* ── PROOF 7 ──────────────────────────────────────────────────────────────── */

test("a client with no phone: the SMS step is SKIPPED, not retried forever",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient({ phone: null });
    const waypointId = await makeWaypoint(clientId);

    const first = await runNudges(db, { orgId, now: NOON });
    assert.equal(first.no_contact, 1);
    assert.equal(await countMessages(clientId), 0);

    let rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "no_contact");
    assert.equal(rows[0].client_local_date, null,
      "a skipped rung costs the client nothing from their one message a day");

    // Ten more passes on the same day: the rung stays spent, nothing retries.
    for (let i = 0; i < 10; i += 1) await runNudges(db, { orgId, now: NOON });
    rows = await nudgeRows(waypointId);
    assert.equal(rows.length, 1, "still one row after ten more passes");

    // And the ladder ADVANCES — the email rung is reachable two days later.
    await runNudges(db, { orgId, now: new Date(NOON.getTime() + 2 * DAY) });
    rows = await nudgeRows(waypointId);
    assert.deepEqual(rows.map((r) => r.step), [1, 2]);
    assert.equal(rows[1].outcome, "queued");
    assert.equal(await countMessages(clientId), 1, "the email went, the text could not");
  });

/* ── PROOF 8 ──────────────────────────────────────────────────────────────── */

test("a message due outside the client's daytime is NOT QUEUED",
  { skip: !HAS_DB }, async () => {
    // Same instant, two clients. 15:00 UTC is 08:00 in Phoenix and 05:00 in
    // Honolulu, so one is inside the window and the other is asleep.
    const morning = new Date("2026-09-10T15:00:00.000Z");
    const phoenix = await makeClient({ tz: "America/Phoenix" });
    const honolulu = await makeClient({ tz: "Pacific/Honolulu" });
    // Overdue by a day, so `morning` is genuinely past due_at for both.
    const wpPhoenix = await makeWaypoint(phoenix, { dueDaysAgo: 1 });
    const wpHonolulu = await makeWaypoint(honolulu, { dueDaysAgo: 1 });

    const tally = await runNudges(db, { orgId, now: morning });

    assert.equal(await countMessages(phoenix), 1, "08:00 where they are: queued");
    assert.equal(await countMessages(honolulu), 0, "05:00 where they are: not queued");
    assert.deepEqual(await nudgeRows(wpHonolulu), [],
      "and the rung is NOT spent — it is chased when their morning comes");
    assert.equal((await nudgeRows(wpPhoenix)).length, 1);
    assert.ok(
      tally.results.some((r) => (r.reasons || []).includes("quiet_hours")),
      JSON.stringify(tally.results.map((r) => r.reasons))
    );

    // Their morning comes.
    const later = new Date("2026-09-10T20:00:00.000Z"); // 10:00 Honolulu
    await runNudges(db, { orgId, now: later });
    assert.equal(await countMessages(honolulu), 1, "queued once their day started");
  });

/* ── the exits that are not on the eight-proof list but are still blockers ── */

test("a waypoint FundHub owes is never chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { ownerKind: "fundhub", dueDaysAgo: 30 });
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0, "it is not even a candidate");
  assert.equal(await countMessages(clientId), 0);
});

test("a waypoint with no due date is never chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await db.query(
    `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, due_at)
     VALUES ($1,$2,'no_deadline','Someday','client','not_started',NULL)`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0);
  assert.equal(await countMessages(clientId), 0);
});

test("the owner changing to us mid-ladder stops it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  const [candidate] = await planNudges(db, { orgId, now: NOON });
  await db.query(`UPDATE client_waypoints SET owner_kind = 'fundhub' WHERE id = $1`, [waypointId]);
  const res = await deliverNudge(db, candidate, { now: NOON });
  assert.equal(res.action, "skipped");
  assert.ok(res.reasons.includes("owner_is_fundhub"));
  assert.equal(await countMessages(clientId), 0);
});

test("a deleted waypoint stops it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  const [candidate] = await planNudges(db, { orgId, now: NOON });
  await db.query(`DELETE FROM client_waypoints WHERE id = $1`, [waypointId]);
  const res = await deliverNudge(db, candidate, { now: NOON });
  assert.equal(res.action, "skipped");
  assert.deepEqual(res.reasons, ["waypoint_missing"]);
  assert.equal(await countMessages(clientId), 0);
});

test("the client replying stops the ladder — a human takes it", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  const waypointId = await makeWaypoint(clientId);
  await runNudges(db, { orgId, now: NOON });
  assert.equal(await countMessages(clientId), 1);

  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,'inbound','sms','doing it now',
             'received')`,
    [orgId, clientId]
  );

  for (const days of [2, 5, 9, 20]) {
    await runNudges(db, { orgId, now: new Date(NOON.getTime() + days * DAY) });
  }
  assert.equal(await countMessages(clientId), 1, "no rung after the reply");
  assert.equal((await nudgeRows(waypointId)).length, 1);
});

test("a lawyer stops every ladder that client has", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { key: "upload_id" });
  await makeWaypoint(clientId, { key: "sign_agreement" });
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,'inbound','sms','my attorney will be in touch','received')`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.queued, 0);
  assert.equal(await countMessages(clientId), 0);
  assert.ok(tally.results.flatMap((r) => r.reasons || []).includes("escalation"));
});

test("a cancelled program stops the ladder", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId);
  await db.query(
    `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total, status)
     VALUES ($1,$2,'full',6,1997.00,'cancelled')`,
    [orgId, clientId]
  );
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.queued, 0);
  assert.equal(await countMessages(clientId), 0);
  assert.ok(tally.results.flatMap((r) => r.reasons || []).includes("program_cancelled"));
});

test("a blocked waypoint is not chased", { skip: !HAS_DB }, async () => {
  const clientId = await makeClient();
  await makeWaypoint(clientId, { state: "blocked" });
  const tally = await runNudges(db, { orgId, now: NOON });
  assert.equal(tally.considered, 0);
  assert.equal(await countMessages(clientId), 0);
});

test("a missing template spends the rung but gives the client's day back",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    const other = await makeWaypoint(clientId, { key: "sign_agreement" });
    const waypointId = await makeWaypoint(clientId, { key: "upload_id" });
    await db.query(
      `DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-WAYPOINT-DUE'`,
      [orgId]
    );
    try {
      const tally = await runNudges(db, { orgId, now: NOON });
      assert.equal(tally.queued, 0);
      assert.equal(tally.template_pending, 2, "both rungs are spent");
      for (const id of [waypointId, other]) {
        const rows = await nudgeRows(id);
        assert.equal(rows[0].outcome, "template_pending");
        assert.equal(rows[0].client_local_date, null,
          "a message that never went out must not eat the client's one slot");
      }
      assert.equal(await countMessages(clientId), 0);
    } finally {
      await db.query(
        `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
         VALUES ($1,'SMS-WAYPOINT-DUE','sms',NULL,'Due today: {{waypoint.title}}. Reply STOP to opt out.',true)
         ON CONFLICT (org_id, template_key) DO UPDATE SET body = EXCLUDED.body`,
        [orgId]
      );
    }
  });

test("the queued message names the actual waypoint, not a generic reminder",
  { skip: !HAS_DB }, async () => {
    const clientId = await makeClient();
    await makeWaypoint(clientId, { title: "Link your business bank account" });
    await runNudges(db, { orgId, now: NOON });
    const body = (await db.query(
      `SELECT rendered_body, status, channel FROM messages WHERE client_id = $1`,
      [clientId]
    )).rows[0];
    assert.match(body.rendered_body, /Link your business bank account/);
    assert.equal(body.status, "queued", "queued — this lane never sends");
    assert.equal(body.channel, "sms");
  });

test("a pass over an empty org does nothing and does not throw",
  { skip: !HAS_DB }, async () => {
    const tally = await runNudges(db, { orgId, now: NOON });
    assert.equal(tally.considered, 0);
    assert.equal(tally.queued, 0);
    assert.equal(tally.failed, 0);
  });
