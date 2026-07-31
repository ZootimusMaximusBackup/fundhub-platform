// Real-Postgres test for 087_reminders and recordReminders().
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// What this proves that cashflow.test.mjs cannot: the basis/confidence pairing
// is enforced by the database rather than only by the builder, the live-dedupe
// index really does turn a nightly recompute into an update, and remind_on
// cannot be stored after the date it is reminding about.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { buildReminders, recordReminders } from "./cashflow.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "reminders_pg_test@example.com";
const TODAY = "2026-07-01";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM reminders WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Re','Minder') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const CHECK_VIOLATION = "23514";
const SUBJECT = "33333333-3333-4333-8333-333333333333";

const insert = (extra = {}) => {
  const cols = {
    org_id: orgId, client_id: clientId, kind: "card_payment",
    subject_type: "card_liability", subject_id: SUBJECT,
    basis: "reported", due_date: "2026-07-20", remind_on: "2026-07-15",
    ...extra
  };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO reminders (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

test("a reported reminder stores with no confidence and nothing sent", { skip: !HAS_DB }, async () => {
  const row = (await insert({ dedupe_key: "basic" })).rows[0];
  assert.equal(row.basis, "reported");
  assert.equal(row.confidence, null);
  assert.equal(row.status, "pending");
  assert.equal(row.sent_at, null, "nothing in this repository transmits — NULL means not sent");
});

test("AN INFERRED REMINDER MUST CARRY THE CONFIDENCE OF THE GUESS IT RESTS ON", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => insert({ basis: "inferred", confidence: null, dedupe_key: "inf-null" }),
    (e) => e.code === CHECK_VIOLATION,
    "an inference presented without its confidence is a guess wearing the clothes of a fact");

  const row = (await insert({ basis: "inferred", confidence: 0.32, kind: "bill_due", subject_type: "recurring_bill", dedupe_key: "inf-ok" })).rows[0];
  assert.equal(Number(row.confidence), 0.32);
});

test("a reported reminder cannot pretend to have been estimated", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => insert({ basis: "reported", confidence: 0.5, dedupe_key: "rep-conf" }),
    (e) => e.code === CHECK_VIOLATION);
});

test("confidence can never be certainty", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => insert({ basis: "inferred", confidence: 1, dedupe_key: "certain" }),
    (e) => e.code === CHECK_VIOLATION);
});

test("A REMINDER CANNOT FIRE AFTER THE THING IT REMINDS ABOUT", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => insert({ due_date: "2026-07-10", remind_on: "2026-07-20", dedupe_key: "late" }),
    (e) => e.code === CHECK_VIOLATION,
    "that is not a reminder, it is a report");
});

test("a nightly recompute updates the same row instead of adding one", { skip: !HAS_DB }, async () => {
  const { reminders } = buildReminders({
    today: TODAY,
    liabilities: [{ id: SUBJECT, next_payment_due_date: "2026-07-20", minimum_payment_cents: 3500 }]
  });

  const first = await recordReminders(db, { orgId, clientId, reminders });
  const second = await recordReminders(db, { orgId, clientId, reminders });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id, "the derived row is rebuilt, not accumulated");

  // Scoped to this reminder's own dedupe key: other tests in this file store
  // rows for the same subject under different keys, and those are legitimately
  // different reminders rather than duplicates of this one.
  const n = (await db.query(
    `SELECT count(*)::int n FROM reminders WHERE client_id=$1 AND kind='card_payment' AND dedupe_key=$2`,
    [clientId, reminders[0].dedupeKey])).rows[0].n;
  assert.equal(n, 1);
});

test("a changed amount is carried onto the existing row", { skip: !HAS_DB }, async () => {
  const build = (min) => buildReminders({
    today: TODAY, liabilities: [{ id: SUBJECT, next_payment_due_date: "2026-07-20", minimum_payment_cents: min }]
  }).reminders;

  await recordReminders(db, { orgId, clientId, reminders: build(3500) });
  const updated = await recordReminders(db, { orgId, clientId, reminders: build(4200) });
  assert.equal(updated[0].amount_cents, "4200");
});

test("a dismissed reminder does not block next month's", { skip: !HAS_DB }, async () => {
  await db.query(
    `UPDATE reminders SET status='dismissed' WHERE client_id=$1 AND subject_id=$2`, [clientId, SUBJECT]);

  const { reminders } = buildReminders({
    today: TODAY, liabilities: [{ id: SUBJECT, next_payment_due_date: "2026-07-20" }]
  });
  const again = await recordReminders(db, { orgId, clientId, reminders });
  assert.equal(again.length, 1);
  assert.equal(again[0].status, "pending");
});

test("an amount of zero is refused — a reminder for nothing is not a reminder", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => insert({ amount_cents: 0, dedupe_key: "zero" }),
    (e) => e.code === CHECK_VIOLATION);
});

test("the kind and subject vocabularies are closed", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => insert({ kind: "vibes", dedupe_key: "k" }), (e) => e.code === CHECK_VIOLATION);
  await assert.rejects(() => insert({ subject_type: "hunch", dedupe_key: "s" }), (e) => e.code === CHECK_VIOLATION);
});
