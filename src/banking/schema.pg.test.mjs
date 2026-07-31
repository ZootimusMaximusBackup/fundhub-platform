// Schema test for 080_plaid_items, 081_bank_accounts and 082_entity_kind.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// THE MOST IMPORTANT TEST IN THIS FILE is the one asserting that an account
// nobody has classified comes back as 'unknown' and not as 'personal'. Every
// screen built on top of this depends on that default, and a future migration
// that "tidies up" the unknown bucket by defaulting it would break the rule
// silently — the column would still be valid, the CHECK would still pass, and
// somebody's private account would quietly appear inside their business view.
//
// The rest prove the two other rules the banking screens rest on: a balance
// cannot be stored without the moment it was true, and a missing balance stays
// missing.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "banking_schema_pg_test@example.com";

let orgId = null;
let clientId = null;
let itemId = null;
let staffId = null;

async function wipe() {
  await db.query(`DELETE FROM bank_accounts WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM plaid_items  WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Bank','Account') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  itemId = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, item_id, institution_name)
     VALUES ($1,$2,$3,'Test Bank') RETURNING id`,
    [orgId, clientId, `item_${Math.random().toString(36).slice(2)}`]
  )).rows[0].id;
  staffId = (await db.query(`SELECT id FROM staff ORDER BY created_at LIMIT 1`)).rows[0]?.id ?? null;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

let seq = 0;
const account = (extra = {}) => {
  const cols = {
    org_id: orgId, client_id: clientId, plaid_item_id: itemId,
    account_ref: `acct_${++seq}_${Math.random().toString(36).slice(2)}`,
    ...extra
  };
  const keys = Object.keys(cols);
  return db.query(
    `INSERT INTO bank_accounts (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    keys.map((k) => cols[k])
  );
};

/* ------------------------------ 080 --------------------------------------- */

test("a bank connection stores and defaults to good", { skip: !HAS_DB }, async () => {
  const row = (await db.query(`SELECT * FROM plaid_items WHERE id=$1`, [itemId])).rows[0];
  assert.equal(row.status, "good");
  assert.equal(row.access_token_enc, null, "the seam stores no token — there is nothing to fetch one with");
  assert.equal(row.last_synced_at, null, "never synced is not the same as synced and unchanged");
  assert.equal(row.consent_document_id, null, "the consent gap is visible, not filled");
});

test("the same Plaid Item cannot be linked twice", { skip: !HAS_DB }, async () => {
  const dupe = (await db.query(`SELECT item_id FROM plaid_items WHERE id=$1`, [itemId])).rows[0].item_id;
  await assert.rejects(
    () => db.query(`INSERT INTO plaid_items (org_id, client_id, item_id) VALUES ($1,$2,$3)`, [orgId, clientId, dupe]),
    (e) => e.code === UNIQUE_VIOLATION);
});

test("a disconnected connection must say when", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO plaid_items (org_id, client_id, item_id, status) VALUES ($1,$2,'item_disc','disconnected')`,
      [orgId, clientId]),
    (e) => e.code === CHECK_VIOLATION,
    "'when did we stop having access to this person bank' is a question SOC 2 and the consumer both ask");
});

test("login_required is a distinct status from error", { skip: !HAS_DB }, async () => {
  const row = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, item_id, status) VALUES ($1,$2,$3,'login_required') RETURNING *`,
    [orgId, clientId, `item_relink_${Math.random().toString(36).slice(2)}`]
  )).rows[0];
  assert.equal(row.status, "login_required",
    "a screen must say 'reconnect your bank', not 'something went wrong'");
});

/* ------------------------------ 081 --------------------------------------- */

test("an account with no balances at all is legal — nothing is known yet", { skip: !HAS_DB }, async () => {
  const row = (await account({ name: "Everyday Checking", type: "depository", subtype: "checking" })).rows[0];
  assert.equal(row.balance_current_cents, null);
  assert.equal(row.balance_available_cents, null);
  assert.equal(row.balance_limit_cents, null);
  assert.equal(row.balance_as_of, null);
  assert.equal(row.status, "open");
});

test("A BALANCE CANNOT BE STORED WITHOUT THE MOMENT IT WAS TRUE", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => account({ balance_current_cents: 420719 }),
    (e) => e.code === CHECK_VIOLATION,
    "a balance with no timestamp invites a payment scheduled against a nine-day-old number");
  await assert.rejects(() => account({ balance_available_cents: 1000 }), (e) => e.code === CHECK_VIOLATION);
  await assert.rejects(() => account({ balance_limit_cents: 500000 }), (e) => e.code === CHECK_VIOLATION);
});

test("a balance with its timestamp stores, and a missing sibling stays null", { skip: !HAS_DB }, async () => {
  const row = (await account({
    name: "Savings", type: "depository", subtype: "savings",
    balance_current_cents: 850000, balance_as_of: new Date().toISOString()
  })).rows[0];
  assert.equal(row.balance_current_cents, "850000");
  assert.equal(row.balance_available_cents, null,
    "available is routinely absent on savings — NULL, never 0, which would say they have no money");
});

test("an overdrawn account is a real negative balance and is not refused", { skip: !HAS_DB }, async () => {
  const row = (await account({
    name: "Overdrawn Checking", type: "depository",
    balance_current_cents: -12500, balance_as_of: new Date().toISOString()
  })).rows[0];
  assert.equal(row.balance_current_cents, "-12500",
    "refusing this would lose exactly the fact somebody most needs to see");
});

test("a full account number is refused by the mask column", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => account({ mask: "123456789012" }), (e) => e.code === CHECK_VIOLATION);
  await assert.rejects(() => account({ mask: "12a4" }), (e) => e.code === CHECK_VIOLATION);
  const ok = (await account({ mask: "4321" })).rows[0];
  assert.equal(ok.mask, "4321");
});

test("an account type the schema does not know is refused, but a subtype is not", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => account({ type: "crypto_wallet" }), (e) => e.code === CHECK_VIOLATION);
  const row = (await account({ type: "depository", subtype: "some new vendor subtype" })).rows[0];
  assert.equal(row.subtype, "some new vendor subtype",
    "the subtype vocabulary is the vendor's and changes without notice — a CHECK would turn that into a failed sync");
});

test("the same account cannot be stored twice under one connection", { skip: !HAS_DB }, async () => {
  const ref = `acct_dupe_${Math.random().toString(36).slice(2)}`;
  await account({ account_ref: ref });
  await assert.rejects(() => account({ account_ref: ref }), (e) => e.code === UNIQUE_VIOLATION);
});

test("disconnecting a bank removes the accounts it granted", { skip: !HAS_DB }, async () => {
  const tempItem = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, item_id) VALUES ($1,$2,$3) RETURNING id`,
    [orgId, clientId, `item_temp_${Math.random().toString(36).slice(2)}`]
  )).rows[0].id;
  await account({ plaid_item_id: tempItem });

  await db.query(`DELETE FROM plaid_items WHERE id=$1`, [tempItem]);
  const left = (await db.query(`SELECT count(*)::int n FROM bank_accounts WHERE plaid_item_id=$1`, [tempItem])).rows[0].n;
  assert.equal(left, 0, "orphaned accounts would leave balances on screen that nothing can ever refresh");
});

/* ------------------------------ 082 --------------------------------------- */

test("AN UNCLASSIFIED ACCOUNT IS 'unknown' AND NOT 'personal'", { skip: !HAS_DB }, async () => {
  const row = (await account({ name: "Chase Checking" })).rows[0];
  assert.equal(row.entity_kind, "unknown",
    "defaulting to personal hides business money in a personal view; defaulting to business leaks private finances into a commercial one");
  assert.equal(row.entity_kind_source, "unset");
  assert.equal(row.entity_kind_set_at, null);
  assert.equal(row.entity_kind_set_by, null);
});

test("every account created without an opinion lands in the unknown bucket", { skip: !HAS_DB }, async () => {
  const rows = (await db.query(
    `SELECT entity_kind, count(*)::int n FROM bank_accounts WHERE client_id=$1 GROUP BY entity_kind`, [clientId]
  )).rows;
  assert.deepEqual(rows.map((r) => r.entity_kind).sort(), ["unknown"],
    "nothing may drift out of unknown without somebody deciding");
});

test("entity_kind refuses a fourth state", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => account({ entity_kind: "probably_business", entity_kind_source: "inferred" }),
    (e) => e.code === CHECK_VIOLATION);
});

test("A DEFINITE CLASSIFICATION MUST SAY HOW IT WAS REACHED", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => account({ entity_kind: "business" }),
    (e) => e.code === CHECK_VIOLATION,
    "a definite answer with source 'unset' is exactly a guess with no provenance");
  await assert.rejects(
    () => account({ entity_kind: "personal", entity_kind_source: "unset" }),
    (e) => e.code === CHECK_VIOLATION);
});

test("an unknown account cannot claim a source", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => account({ entity_kind: "unknown", entity_kind_source: "plaid" }),
    (e) => e.code === CHECK_VIOLATION,
    "'we do not know, according to Plaid' is not a statement about anything");
});

test("an inferred classification is allowed and is marked as inferred", { skip: !HAS_DB }, async () => {
  const row = (await account({
    name: "Business Complete Checking", entity_kind: "business", entity_kind_source: "inferred"
  })).rows[0];
  assert.equal(row.entity_kind, "business");
  assert.equal(row.entity_kind_source, "inferred");
  assert.equal(row.entity_kind_set_by, null, "a guess has no human and correctly names none");
});

test("a human decision must record who made it", { skip: !HAS_DB, todo: !staffId }, async () => {
  if (!staffId) return;
  await assert.rejects(
    () => account({ entity_kind: "business", entity_kind_source: "manual" }),
    (e) => e.code === CHECK_VIOLATION,
    "a manual classification with nobody attached is not a decision anybody made");

  const row = (await account({
    entity_kind: "business", entity_kind_source: "manual",
    entity_kind_set_by: staffId, entity_kind_set_at: new Date().toISOString()
  })).rows[0];
  assert.equal(row.entity_kind_set_by, staffId);
});
