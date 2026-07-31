// Real-Postgres schema test for 080/081/082.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// A DEFAULT IS A SCHEMA FACT, NOT A CODE FACT. bank_accounts.entity_kind
// defaulting to 'unknown' cannot be proved by a unit test — the default lives in
// Postgres and any INSERT from any source (an endpoint, a backfill, a psql
// session) picks it up. So the assertion that matters most in this file inserts
// a row WITHOUT naming entity_kind and reads back what the database chose.
//
// If that ever comes back 'personal', an account nobody has classified is being
// presented as an established personal account, and nothing downstream can tell
// the guess from the fact. See db/migrations/082_bank_account_entity_kind.sql.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "plaid_w5_pg_test@example.com";

let orgId = null;
let clientId = null;
let itemId = null;

async function wipe() {
  await db.query(`DELETE FROM bank_accounts WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM plaid_items   WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Bank','Tester') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  itemId = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id) VALUES ($1,$2) RETURNING id`,
    [orgId, clientId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

describe("entity_kind — unknown is the default and unknown is not personal", () => {
  test("an account inserted without an entity_kind is 'unknown', never 'personal'", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, name)
       VALUES ($1,$2,$3,'Unclassified Checking') RETURNING entity_kind, entity_kind_source, entity_kind_set_at`,
      [orgId, clientId, itemId]
    );
    assert.strictEqual(r.rows[0].entity_kind, "unknown",
      "an unclassified account must record that it is unclassified");
    assert.notStrictEqual(r.rows[0].entity_kind, "personal",
      "defaulting to personal would present a guess as an established fact");
    assert.strictEqual(r.rows[0].entity_kind_source, null, "not knowing needs no provenance");
    assert.strictEqual(r.rows[0].entity_kind_set_at, null);
  });

  test("the column default read from the catalog is literally 'unknown'", { skip: !HAS_DB }, async () => {
    // Belt and braces: an INSERT could be satisfied by a trigger. This reads the
    // declared default itself, which is the thing a future migration might change.
    const r = await db.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name='bank_accounts' AND column_name='entity_kind'`
    );
    assert.ok(r.rows[0], "bank_accounts.entity_kind must exist");
    assert.match(r.rows[0].column_default, /'unknown'/);
    assert.strictEqual(r.rows[0].is_nullable, "NO",
      "NULL would be a third meaningless state — 'unknown' is the recorded one");
  });

  test("'personal' and 'business' are accepted when a basis is given", { skip: !HAS_DB }, async () => {
    for (const kind of ["personal", "business"]) {
      const r = await db.query(
        `INSERT INTO bank_accounts (org_id, client_id, entity_kind, entity_kind_source, entity_kind_set_at)
         VALUES ($1,$2,$3,'staff_reviewed', now()) RETURNING entity_kind`,
        [orgId, clientId, kind]
      );
      assert.strictEqual(r.rows[0].entity_kind, kind);
    }
  });

  test("an invented entity_kind is rejected by the database, not just by code", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO bank_accounts (org_id, client_id, entity_kind, entity_kind_source)
         VALUES ($1,$2,'mixed','staff_reviewed')`,
        [orgId, clientId]
      ),
      /entity_kind_check/,
      "'mixed' is not a decided value — see the 082 header"
    );
  });

  test("classifying an account without saying how we know is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO bank_accounts (org_id, client_id, entity_kind) VALUES ($1,$2,'business')`,
        [orgId, clientId]
      ),
      /provenance_check/,
      "a claim and a verified fact must not look identical in this column"
    );
  });

  test("an invented entity_kind_source is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO bank_accounts (org_id, client_id, entity_kind, entity_kind_source)
         VALUES ($1,$2,'business','vibes')`,
        [orgId, clientId]
      ),
      /entity_kind_source_check/
    );
  });
});

describe("plaid_items — a row is never connected by default", () => {
  test("link_state defaults to 'unlinked' and no consent is on record", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `INSERT INTO plaid_items (org_id, client_id) VALUES ($1,$2)
       RETURNING link_state, consent_granted_at, encrypted_access_token, plaid_item_id`,
      [orgId, clientId]
    );
    assert.strictEqual(r.rows[0].link_state, "unlinked");
    assert.strictEqual(r.rows[0].consent_granted_at, null, "consent that defaults to given is not consent");
    assert.strictEqual(r.rows[0].encrypted_access_token, null);
    assert.strictEqual(r.rows[0].plaid_item_id, null);
  });

  test("an invented link_state is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      db.query(`INSERT INTO plaid_items (org_id, client_id, link_state) VALUES ($1,$2,'connected')`, [orgId, clientId]),
      /link_state/
    );
  });

  test("there is no plaintext access token column to select by accident", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='plaid_items'`
    );
    const cols = r.rows.map((x) => x.column_name);
    assert.ok(cols.includes("encrypted_access_token"));
    for (const c of cols) {
      if (c === "encrypted_access_token") continue;
      assert.ok(!/token|secret/i.test(c), `unexpected credential-shaped column: ${c}`);
    }
  });

  test("the same Plaid Item cannot be linked twice in one org", { skip: !HAS_DB }, async () => {
    await db.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_item_id) VALUES ($1,$2,'item-w5-dup')`,
      [orgId, clientId]
    );
    await assert.rejects(
      db.query(`INSERT INTO plaid_items (org_id, client_id, plaid_item_id) VALUES ($1,$2,'item-w5-dup')`, [orgId, clientId]),
      /uq_plaid_items_item/
    );
  });
});

describe("bank_accounts — unknown balances survive as NULL", () => {
  test("an account with no reported balances stores NULL, not 0", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, name) VALUES ($1,$2,'No Balance Reported')
       RETURNING available_balance_cents, current_balance_cents, credit_limit_cents, account_type, currency_code`,
      [orgId, clientId]
    );
    const row = r.rows[0];
    assert.strictEqual(row.available_balance_cents, null, "unknown is not zero");
    assert.strictEqual(row.current_balance_cents, null);
    assert.strictEqual(row.credit_limit_cents, null);
    assert.strictEqual(row.account_type, null, "an unclassified account type must not default to depository");
    assert.strictEqual(row.currency_code, null);
  });

  test("a negative balance is storable — an overdrawn account is real data", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, name, current_balance_cents)
       VALUES ($1,$2,'Overdrawn', -12345) RETURNING current_balance_cents`,
      [orgId, clientId]
    );
    assert.strictEqual(Number(r.rows[0].current_balance_cents), -12345);
  });

  test("balances are integer cents, not dollars", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='bank_accounts' AND column_name='current_balance_cents'`
    );
    assert.strictEqual(r.rows[0].data_type, "bigint");
  });

  test("re-reading the same Plaid account updates rather than duplicating", { skip: !HAS_DB }, async () => {
    await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, plaid_account_id, name)
       VALUES ($1,$2,$3,'acct-w5-1','Checking')`,
      [orgId, clientId, itemId]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, plaid_account_id, name)
         VALUES ($1,$2,$3,'acct-w5-1','Checking')`,
        [orgId, clientId, itemId]
      ),
      /uq_bank_accounts_plaid/
    );
  });

  test("hand-entered accounts are not blocked by that uniqueness rule", { skip: !HAS_DB }, async () => {
    // Both keys NULL on manual entry; two manual accounts must both be allowed.
    for (let i = 0; i < 2; i += 1) {
      await db.query(`INSERT INTO bank_accounts (org_id, client_id, name) VALUES ($1,$2,'Manual')`, [orgId, clientId]);
    }
    const r = await db.query(
      `SELECT count(*)::int AS n FROM bank_accounts WHERE client_id=$1 AND name='Manual'`, [clientId]
    );
    assert.strictEqual(r.rows[0].n, 2);
  });

  test("deleting the bank login deletes the accounts underneath it", { skip: !HAS_DB }, async () => {
    const scratch = (await db.query(
      `INSERT INTO plaid_items (org_id, client_id) VALUES ($1,$2) RETURNING id`, [orgId, clientId]
    )).rows[0].id;
    await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, name) VALUES ($1,$2,$3,'Cascade')`,
      [orgId, clientId, scratch]
    );
    await db.query(`DELETE FROM plaid_items WHERE id=$1`, [scratch]);
    const r = await db.query(
      `SELECT count(*)::int AS n FROM bank_accounts WHERE plaid_item_id=$1`, [scratch]
    );
    assert.strictEqual(r.rows[0].n, 0, "a revoked login must not leave orphan accounts behind");
  });

  test("there is no full account number or routing number column", { skip: !HAS_DB }, async () => {
    const r = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='bank_accounts'`
    );
    for (const c of r.rows.map((x) => x.column_name)) {
      assert.ok(!/routing|account_number|iban/i.test(c), `payment credential column present: ${c}`);
    }
  });
});
