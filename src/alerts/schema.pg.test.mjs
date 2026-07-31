// Schema test for 078_alerts.sql and 079_upsell_triggers.sql.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// The evaluators (evaluate.mjs) are pure and will happily produce the same
// finding on every run — correct for a pure function, catastrophic for a table.
// The dedupe rules are what stop that, and they live in the database as partial
// unique indexes. A stub could not test them, so these are the tests that prove
// an alert queue does not grow a duplicate every time it is evaluated.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "alerts_schema_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM alerts WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM upsell_triggers WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Al','Ert') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const raise = (extra = {}) => {
  const cols = { org_id: orgId, client_id: clientId, kind: "utilization_high", message: "Utilization is 62%.", ...extra };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO alerts (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

const trigger = (extra = {}) => {
  const cols = { org_id: orgId, client_id: clientId, trigger_kind: "card_limit_increase", ...extra };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO upsell_triggers (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

/* -------------------------------- 078 ------------------------------------- */

test("an alert stores with its evidence and defaults to open/info", { skip: !HAS_DB }, async () => {
  const row = (await raise({ evidence: JSON.stringify({ utilization: 0.62, cardsCounted: 3 }) })).rows[0];
  assert.equal(row.status, "open");
  assert.equal(row.severity, "info");
  assert.equal(row.evidence.utilization, 0.62);
  assert.ok(row.raised_at);
});

test("evidence defaults to an object, never null", { skip: !HAS_DB }, async () => {
  const row = (await raise({ dedupe_key: "ev-default" })).rows[0];
  assert.deepEqual(row.evidence, {},
    "a reader must never have to tell 'no evidence key' from 'evidence was null'");
});

test("RE-EVALUATING AN UNCHANGED FACT CANNOT RAISE A SECOND LIVE ALERT", { skip: !HAS_DB }, async () => {
  await raise({ dedupe_key: "utilization:0.3" });
  await assert.rejects(
    () => raise({ dedupe_key: "utilization:0.3" }),
    (e) => e.code === "23505",
    "the evaluators are pure and re-run; without this the queue grows a copy every time");
});

test("a resolved alert does not block the same condition recurring", { skip: !HAS_DB }, async () => {
  await db.query(
    `UPDATE alerts SET status='resolved', resolved_at=now() WHERE client_id=$1 AND dedupe_key='utilization:0.3'`,
    [clientId]);
  const again = (await raise({ dedupe_key: "utilization:0.3" })).rows[0];
  assert.equal(again.status, "open", "a recurrence is a new event and should look like one");
});

test("an alert with no dedupe key never collides — every raise is its own event", { skip: !HAS_DB }, async () => {
  const before = (await db.query(`SELECT count(*)::int n FROM alerts WHERE client_id=$1 AND dedupe_key IS NULL`, [clientId])).rows[0].n;
  await raise({ kind: "one_off" });
  await raise({ kind: "one_off" });
  const after = (await db.query(`SELECT count(*)::int n FROM alerts WHERE client_id=$1 AND dedupe_key IS NULL`, [clientId])).rows[0].n;
  assert.equal(after, before + 2);
});

test("an acknowledged alert must say when, and a resolved one must say when", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => raise({ status: "acknowledged", dedupe_key: "ack-no-ts" }),
    (e) => e.code === "23514",
    "a queue nobody can age or audit is not a queue");
  await assert.rejects(
    () => raise({ status: "resolved", dedupe_key: "res-no-ts" }),
    (e) => e.code === "23514");
});

test("an alert resolved by nobody is legal — conditions go away on their own", { skip: !HAS_DB }, async () => {
  const row = (await raise({ status: "resolved", resolved_at: new Date().toISOString(), dedupe_key: "self-resolved" })).rows[0];
  assert.equal(row.acknowledged_by, null);
});

test("severity is a closed set — it drives ordering on every screen", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => raise({ severity: "extremely_bad" }), (e) => e.code === "23514");
});

test("status is a closed set, and resolved is not the same as dismissed", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => raise({ status: "sort_of_handled" }), (e) => e.code === "23514");
  const dismissed = (await raise({ status: "dismissed", dedupe_key: "dismissed-one" })).rows[0];
  assert.equal(dismissed.status, "dismissed",
    "one is the world changing, the other is a judgement — collapsing them loses the fact somebody made a call");
});

test("an alert kind the schema has never heard of is accepted", { skip: !HAS_DB }, async () => {
  const row = (await raise({ kind: "some_future_evaluator" })).rows[0];
  assert.equal(row.kind, "some_future_evaluator",
    "an evaluator blocked by a migration writes no alert at all, which is worse than an unfamiliar string");
});

test("an alert must carry a message", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO alerts (org_id, client_id, kind) VALUES ($1,$2,'x')`, [orgId, clientId]),
    (e) => e.code === "23502");
});

/* -------------------------------- 079 ------------------------------------- */

test("an upsell trigger stores with a confidence and no product", { skip: !HAS_DB }, async () => {
  const row = (await trigger({ confidence: 0.25, rationale: "Amex at 90% of a 1000 limit." })).rows[0];
  assert.equal(row.status, "new");
  assert.equal(Number(row.confidence), 0.25);
  assert.equal(row.product_id, null,
    "a candidate can be spotted before anybody decides which catalog product fits");
});

test("a confidence nobody expressed stays null, which is not zero", { skip: !HAS_DB }, async () => {
  const row = (await trigger({ dedupe_key: "no-confidence" })).rows[0];
  assert.equal(row.confidence, null,
    "null is 'not expressed'; 0 would read as 'certain this is a bad fit'");
});

test("confidence outside 0..1 is refused", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => trigger({ confidence: 1.5 }), (e) => e.code === "23514");
  await assert.rejects(() => trigger({ confidence: -0.1 }), (e) => e.code === "23514");
});

test("a trigger cannot claim it was presented without saying when", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => trigger({ status: "presented" }),
    (e) => e.code === "23514",
    "without this, 'we offered it' is unfalsifiable and the accept/decline counts mean nothing");
  await assert.rejects(() => trigger({ status: "accepted" }), (e) => e.code === "23514");
});

test("re-detecting the same live opportunity cannot duplicate it", { skip: !HAS_DB }, async () => {
  await trigger({ dedupe_key: "limit_increase:a1" });
  await assert.rejects(() => trigger({ dedupe_key: "limit_increase:a1" }), (e) => e.code === "23505");
});

test("a declined opportunity can be detected again later", { skip: !HAS_DB }, async () => {
  await db.query(
    `UPDATE upsell_triggers SET status='declined', presented_at=now(), resolved_at=now()
      WHERE client_id=$1 AND dedupe_key='limit_increase:a1'`, [clientId]);
  const again = (await trigger({ dedupe_key: "limit_increase:a1" })).rows[0];
  assert.equal(again.status, "new", "circumstances change and a second look is a real event");
});

test("upsell status is a closed set", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => trigger({ status: "warm" }), (e) => e.code === "23514");
});
