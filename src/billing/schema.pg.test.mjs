// Schema test for 075_subscriptions.sql and 076_client_cards.sql.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHY A SCHEMA TEST AND NOT A UNIT TEST. Both migrations put their real rules in
// the database — CHECK constraints and partial unique indexes — precisely so
// they cannot be forgotten by a future writer. A test that stubbed Postgres
// would be testing the stub's opinion of a CHECK, which is worth nothing. Every
// assertion below is a claim about what Postgres will refuse.
//
// The refusals are the point. There is no application code for these tables yet
// (nothing charges, nothing collects — see both headers), so what is being
// proven is that when a writer does arrive it cannot store a subscription in an
// invented state, cannot double a revenue projection by replaying a webhook, and
// cannot put a card number in the column meant for its last four digits.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "billing_schema_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM subscriptions WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM client_cards  WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Bill','Ing') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* Postgres error codes, so a test that expects a refusal proves WHICH refusal.
   Asserting only "it threw" would pass on a typo in the table name. */
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

async function refuses(code, sql, params, message) {
  await assert.rejects(() => db.query(sql, params), (e) => e.code === code, message);
}

const addSub = (extra = {}) => {
  const cols = { org_id: orgId, client_id: clientId, plan_name: "Credit Repair Monthly", ...extra };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO subscriptions (${keys.join(", ")})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

const addCard = (extra = {}) => {
  const cols = { org_id: orgId, client_id: clientId, provider_ref: `tok_${Math.random().toString(36).slice(2)}`, ...extra };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO client_cards (${keys.join(", ")})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

/* ------------------------------- 075 ------------------------------------- */

test("a subscription stores, and an unknown amount stays unknown", { skip: !HAS_DB }, async () => {
  const row = (await addSub({ amount_cents: 19900, interval: "monthly" })).rows[0];
  assert.equal(row.amount_cents, "19900", "money is integer cents");
  assert.equal(row.status, "active", "the default state is active");
  assert.equal(row.currency, "USD");

  const unpriced = (await addSub({ plan_name: "Imported, price unknown" })).rows[0];
  assert.equal(unpriced.amount_cents, null,
    "an unreadable price must stay NULL — a $0 plan and an unknown price are different facts");
  assert.equal(unpriced.interval, null);
  assert.equal(unpriced.current_period_end, null,
    "a missing renewal date must never arrive as a date");
});

test("subscriptions refuse a status nobody defined", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO subscriptions (org_id, client_id, plan_name, status) VALUES ($1,$2,'X','probably_active')`,
    [orgId, clientId],
    "the status vocabulary is closed on purpose — 'active' must mean the same thing to every reader");
});

test("subscriptions refuse an interval nobody defined", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO subscriptions (org_id, client_id, plan_name, interval) VALUES ($1,$2,'X','fortnightly')`,
    [orgId, clientId]);
});

test("subscriptions refuse a negative amount", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO subscriptions (org_id, client_id, plan_name, amount_cents) VALUES ($1,$2,'X',-100)`,
    [orgId, clientId]);
});

test("replaying a processor webhook cannot double a subscription", { skip: !HAS_DB }, async () => {
  await addSub({ provider: "commas", provider_ref: "sub_replay_1" });
  await refuses(UNIQUE_VIOLATION,
    `INSERT INTO subscriptions (org_id, client_id, plan_name, provider, provider_ref)
     VALUES ($1,$2,'X','commas','sub_replay_1')`,
    [orgId, clientId],
    "a replayed webhook would otherwise double every revenue projection built on this table");
});

test("two hand-entered subscriptions with no processor id are both kept", { skip: !HAS_DB }, async () => {
  await addSub({ plan_name: "Manual A" });
  await addSub({ plan_name: "Manual B" });
  const n = (await db.query(
    `SELECT count(*)::int AS n FROM subscriptions WHERE client_id=$1 AND provider_ref IS NULL`, [clientId]
  )).rows[0].n;
  assert.ok(n >= 2, "the uniqueness rule is partial — two rows nobody can prove are the same must both survive");
});

/* ------------------------------- 076 ------------------------------------- */

test("a card on file stores its display detail and nothing more", { skip: !HAS_DB }, async () => {
  const row = (await addCard({ brand: "Visa", last4: "4242", exp_month: 4, exp_year: 2030 })).rows[0];
  assert.equal(row.last4, "4242");
  assert.equal(row.funding, "unknown", "funding type is not guessed — processors do not reliably report it");
  assert.equal(row.method_kind, "card");
  assert.equal(row.is_default, false);
});

test("THE PAN GUARD: a full card number is refused by the database", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref, last4) VALUES ($1,$2,'tok_pan','4242424242424242')`,
    [orgId, clientId],
    "a PAN in the last4 column must fail at write time, not be discovered in a log six months later");

  for (const bad of ["424", "42425", "4a24", ""]) {
    await refuses(CHECK_VIOLATION,
      `INSERT INTO client_cards (org_id, client_id, provider_ref, last4) VALUES ($1,$2,$3,$4)`,
      [orgId, clientId, `tok_${bad || "empty"}`, bad]);
  }
});

test("THE PAN GUARD: no column exists that could hold a card number or a CVV", { skip: !HAS_DB }, async () => {
  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'client_cards'`
  )).rows.map((r) => r.column_name);

  const forbidden = cols.filter((c) => /pan|cvv|cvc|card_number|cardnumber|security_code|full_number/i.test(c));
  assert.deepEqual(forbidden, [],
    `client_cards must never grow a column for a card number or a verification value; found: ${forbidden.join(", ")}`);
});

test("a client cannot end up with two default cards", { skip: !HAS_DB }, async () => {
  await addCard({ last4: "1111", is_default: true });
  await refuses(UNIQUE_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref, last4, is_default)
     VALUES ($1,$2,'tok_second_default','2222',true)`,
    [orgId, clientId],
    "'two default cards' is not a state anyone can bill against");
});

test("removing a card frees the default slot without deleting the history", { skip: !HAS_DB }, async () => {
  await db.query(`UPDATE client_cards SET removed_at = now() WHERE client_id=$1 AND is_default`, [clientId]);
  const replacement = (await addCard({ last4: "3333", is_default: true })).rows[0];
  assert.equal(replacement.is_default, true);

  const kept = (await db.query(
    `SELECT count(*)::int AS n FROM client_cards WHERE client_id=$1 AND removed_at IS NOT NULL`, [clientId]
  )).rows[0].n;
  assert.ok(kept >= 1,
    "a removed card stays readable — it is what paid the transactions already on file");
});

test("the same processor token cannot be stored twice", { skip: !HAS_DB }, async () => {
  await addCard({ provider_ref: "tok_dupe", last4: "9999" });
  await refuses(UNIQUE_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref) VALUES ($1,$2,'tok_dupe')`,
    [orgId, clientId]);
});

test("a payment method with no processor token is refused", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO client_cards (org_id, client_id) VALUES ($1,$2)`, [orgId, clientId]),
    (e) => e.code === "23502",
    "a card we cannot charge is a display artifact, not a payment method");
});

test("an impossible expiry is refused", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref, exp_month) VALUES ($1,$2,'tok_m13',13)`,
    [orgId, clientId]);
  await refuses(CHECK_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref, exp_year) VALUES ($1,$2,'tok_y1999',1999)`,
    [orgId, clientId]);
});

test("funding type refuses a guess it was not given", { skip: !HAS_DB }, async () => {
  await refuses(CHECK_VIOLATION,
    `INSERT INTO client_cards (org_id, client_id, provider_ref, funding) VALUES ($1,$2,'tok_f','probably_credit')`,
    [orgId, clientId]);
});
