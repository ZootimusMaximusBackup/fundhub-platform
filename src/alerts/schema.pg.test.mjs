// The 078/079 constraints, against real Postgres. SKIPS unless DATABASE_URL is set.
//
// src/alerts/index.mjs is pure and has no database half, so this file tests the
// SCHEMA rather than a module: the dedupe indexes that stop a nightly
// re-evaluation stacking copies, and the coherence CHECKs that stop a row
// reading wrong. Every statement here is raw SQL on purpose — what has to be
// true is that the database refuses these, for every writer that ever exists.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "alerts_pg_test@example.com";

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

const reset = () => Promise.all([
  db.query(`DELETE FROM alerts WHERE client_id=$1`, [clientId]),
  db.query(`DELETE FROM upsell_triggers WHERE client_id=$1`, [clientId])
]);

const raise = (over = {}) => db.query(
  `INSERT INTO alerts (org_id, client_id, kind, status, observed_value, threshold_value, dedupe_key, resolved_at)
   VALUES ($1,$2,$3,COALESCE($4,'open'),$5,$6,$7,$8) RETURNING *`,
  [orgId, clientId, over.kind ?? "utilization", over.status ?? null, over.observed ?? 0.94,
    over.threshold ?? 0.8, over.dedupe_key ?? "utilization:line:t1", over.resolved_at ?? null]
);

test("a second evaluation cannot stack a duplicate of an open alert", { skip: !HAS_DB }, async () => {
  await reset();
  await raise();
  await assert.rejects(() => raise(), /alerts_open_dedupe_uq/,
    "an inbox that cries wolf is one nobody reads");
});

test("the same line crossed again AFTER a resolution is a new alert, not a blocked one", { skip: !HAS_DB }, async () => {
  await reset();
  await raise({ status: "resolved", resolved_at: new Date().toISOString() });
  const again = await raise();
  assert.equal(again.rows[0].status, "open", "circumstances change; a resolved alert must not silence the next one");
});

test("an alert stores the line it crossed, so it explains itself after policy moves", { skip: !HAS_DB }, async () => {
  await reset();
  const row = (await raise({ observed: 0.94, threshold: 0.8 })).rows[0];
  assert.equal(Number(row.observed_value), 0.94);
  assert.equal(Number(row.threshold_value), 0.8);
  assert.deepEqual(row.detail, {}, "detail defaults to an empty object, never null");
});

test("resolved means dated, in both directions", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => raise({ status: "resolved" }),
    /alerts_resolved_coherent/,
    "a resolved alert with no date"
  );
  await assert.rejects(
    () => raise({ status: "open", resolved_at: new Date().toISOString() }),
    /alerts_resolved_coherent/,
    "a resolution date on a row that still reads open is the row that sits in a queue forever"
  );
});

test("an alert kind with no evaluator behind it is refused", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(() => raise({ kind: "vibes" }), /alerts_kind_check|violates check constraint/);
});

test("an alert cannot be raised with an empty dedupe key", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(() => raise({ dedupe_key: "  " }), /violates check constraint/);
});

test("there is no column on alerts that could become client-facing copy", { skip: !HAS_DB }, async () => {
  const names = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='alerts' ORDER BY column_name`
  )).rows.map((r) => r.column_name);
  for (const forbidden of ["message", "headline", "body", "copy", "client_message", "notify_at"]) {
    assert.equal(names.includes(forbidden), false,
      `${forbidden} would become the words a consumer reads about their own credit, written by whoever added it`);
  }
});

// ---------------------------------------------------------------------------
// upsell_triggers
// ---------------------------------------------------------------------------

const suggest = (over = {}) => db.query(
  `INSERT INTO upsell_triggers (org_id, client_id, kind, status, rationale, evidence, dedupe_key, decided_at)
   VALUES ($1,$2,'card_upgrade',COALESCE($3,'suggested'),$4,$5,$6,$7) RETURNING *`,
  [orgId, clientId, over.status ?? null, over.rationale ?? "2 lines, 10% drawn",
    JSON.stringify(over.evidence ?? { source: "tradelines" }), over.dedupe_key ?? "card_upgrade",
    over.decided_at ?? null]
);

test("one live suggestion per subject, so a nightly re-run does not stack them", { skip: !HAS_DB }, async () => {
  await reset();
  await suggest();
  await assert.rejects(() => suggest(), /upsell_triggers_open_dedupe_uq/);
});

test("a dismissal is kept and does not block asking again later", { skip: !HAS_DB }, async () => {
  await reset();
  await suggest({ status: "dismissed", decided_at: new Date().toISOString() });
  const again = await suggest();
  assert.equal(again.rows[0].status, "suggested");
  const all = await db.query(`SELECT status FROM upsell_triggers WHERE client_id=$1 ORDER BY suggested_at`, [clientId]);
  assert.deepEqual(all.rows.map((r) => r.status), ["dismissed", "suggested"],
    "'we already asked and they said no' is the most useful thing to know before asking again");
});

test("a suggestion nobody can explain is refused", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(() => suggest({ rationale: "   " }), /violates check constraint/);
});

test("decided means dated, in both directions", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(() => suggest({ status: "accepted" }), /upsell_triggers_decided_coherent/);
  await assert.rejects(
    () => suggest({ status: "suggested", decided_at: new Date().toISOString() }),
    /upsell_triggers_decided_coherent/
  );
});

test("there is no column on upsell_triggers that could become an offer", { skip: !HAS_DB }, async () => {
  const names = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='upsell_triggers' ORDER BY column_name`
  )).rows.map((r) => r.column_name);
  for (const forbidden of ["price", "price_cents", "apr", "credit_limit", "approved_amount", "expires_at", "confidence", "priority"]) {
    assert.equal(names.includes(forbidden), false,
      `${forbidden} turns a recorded opportunity into something closer to a firm offer of credit`);
  }
});
