// Real-Postgres test for ONE claim: a bank transaction and a detected bill must
// belong to a bank account that actually exists.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHY THIS FILE EXISTS.
//
// 085_bank_transactions.sql section 4 declined to put a foreign key on
// bank_account_id and gave this reason, in these words:
//
//   "`bank_account_id uuid NOT NULL` points at a `bank_accounts` table that
//    DOES NOT EXIST IN THIS REPOSITORY TODAY"
//
// It does exist. db/migrations/081_bank_accounts.sql:34 creates it, and 081
// sorts before 085, so it already existed when 085 was written. 086 then
// repeated the same reason by reference for recurring_bills. The justification
// was false, so the gap it justified was never a considered trade-off.
//
// What the missing key actually cost, both reproduced below against real
// Postgres before the fix:
//
//   1. REVOKED CONSENT LEFT THE DATA BEHIND. bank_accounts.plaid_item_id is
//      ON DELETE CASCADE (081:42). A client revoking a bank login deletes the
//      plaid_items row, every account under it cascades away — and the
//      transactions and bills kept pointing at accounts that no longer exist.
//      listRecurringBills() filters on org and client, never on whether the
//      account is still connected, so a projector would price a client's cash
//      flow off a connection they had already withdrawn.
//   2. A WHOLLY INVENTED ACCOUNT UUID WAS ACCEPTED. Any uuid at all could be
//      written into bank_account_id and Postgres raised nothing.
//
// These are schema claims, so they are checked against the schema and not
// against a fake. AUDIT-FINDINGS' first lesson applies exactly: "A fake that
// models the schema you wish you had cannot fail when the schema moves."

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { listRecurringBills } from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// Every row this file writes carries one of these sentinels, so the wipe can
// never reach a real record.
const PROVIDER_PREFIX = "M17PGTEST";
const MERCHANT_PREFIX = "M17PGTEST";
const CLIENT_EMAIL = "bank_account_link_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(
    `DELETE FROM recurring_bill_transactions
      WHERE bank_transaction_id IN (
        SELECT id FROM bank_transactions WHERE provider_transaction_id LIKE $1 || '%')`,
    [PROVIDER_PREFIX]
  );
  await db.query(`DELETE FROM recurring_bills WHERE merchant_key LIKE $1 || '%'`,
    [MERCHANT_PREFIX]);
  await db.query(`DELETE FROM bank_transactions WHERE provider_transaction_id LIKE $1 || '%'`,
    [PROVIDER_PREFIX]);
  await db.query(
    `DELETE FROM bank_accounts WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`,
    [CLIENT_EMAIL]
  );
  await db.query(
    `DELETE FROM plaid_items WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`,
    [CLIENT_EMAIL]
  );
  await db.query(`DELETE FROM clients WHERE email = $1`, [CLIENT_EMAIL]);
}

/** A bank login, the thing a client revokes. Returns its id. */
async function newLogin() {
  const r = await db.query(
    `INSERT INTO plaid_items (org_id, client_id, institution_name)
     VALUES ($1,$2,'M17 Test Bank') RETURNING id`,
    [orgId, clientId]
  );
  return r.rows[0].id;
}

/** An account inside a login (or a hand-entered one when itemId is null). */
async function newAccount(itemId = null) {
  const r = await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, name)
     VALUES ($1,$2,$3,'M17 Checking') RETURNING id`,
    [orgId, clientId, itemId]
  );
  return r.rows[0].id;
}

const insertTxn = (accountId, providerId) => db.query(
  `INSERT INTO bank_transactions
     (org_id, bank_account_id, client_id, amount_cents, posted_on, merchant_name,
      provider_transaction_id)
   VALUES ($1,$2,$3,-5499,'2026-03-15',$4,$5) RETURNING id`,
  [orgId, accountId, clientId, `${MERCHANT_PREFIX} INTERNET`, `${PROVIDER_PREFIX}${providerId}`]
);

const insertBill = (accountId, merchantSuffix) => db.query(
  `INSERT INTO recurring_bills
     (org_id, bank_account_id, client_id, merchant_key, cadence, typical_amount_cents,
      next_expected_on, next_expected_unknown_reason, confidence_pct, confidence_label,
      occurrence_count, first_seen_on, last_seen_on, detected_as_of)
   VALUES ($1,$2,$3,$4,'monthly',-5499,'2026-04-15',NULL,90,'high',4,
           '2025-12-15','2026-03-15','2026-03-20T00:00:00.000Z') RETURNING id`,
  [orgId, accountId, clientId, `${MERCHANT_PREFIX} ${merchantSuffix}`]
);

const errorOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

const countWhere = async (sql, params) =>
  (await db.query(sql, params)).rows[0].n;

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the migrations");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name) VALUES ($1,$2,'AccountLink') RETURNING id`,
    [orgId, CLIENT_EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* ========================================================================= *
 * The link is a real foreign key, not a comment
 * ========================================================================= */

test("bank_account_id is a real foreign key on both tables", { skip: !HAS_DB }, async () => {
  const fks = (await db.query(
    `SELECT c.conrelid::regclass::text AS child,
            c.confrelid::regclass::text AS parent,
            c.confdeltype                AS on_delete,
            c.convalidated               AS validated
       FROM pg_constraint c
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND a.attname = 'bank_account_id'
        AND c.conrelid::regclass::text IN ('bank_transactions', 'recurring_bills')`
  )).rows;

  for (const child of ["bank_transactions", "recurring_bills"]) {
    const fk = fks.find((r) => r.child === child);
    assert.ok(fk, `${child}.bank_account_id has no foreign key to bank_accounts`);
    assert.equal(fk.parent, "bank_accounts", `${child}.bank_account_id points at the wrong table`);
    // 'c' = ON DELETE CASCADE. A revoked login must not leave the rows behind.
    assert.equal(fk.on_delete, "c", `${child}.bank_account_id must be ON DELETE CASCADE`);
  }
});

test("an invented account uuid is refused, not accepted in silence", { skip: !HAS_DB }, async () => {
  // A uuid that is well-formed and belongs to nothing.
  const NOWHERE = "17171717-0000-4000-8000-000000000017";

  const txn = await errorOf(() => insertTxn(NOWHERE, "-invented"));
  assert.ok(txn, "a transaction on an account that does not exist must be refused");
  assert.equal(txn.code, "23503", "expected a foreign key violation");

  const bill = await errorOf(() => insertBill(NOWHERE, "INVENTED"));
  assert.ok(bill, "a bill on an account that does not exist must be refused");
  assert.equal(bill.code, "23503", "expected a foreign key violation");
});

/* ========================================================================= *
 * Revoked consent takes the derived data with it
 * ========================================================================= */

test("revoking a bank login leaves no transaction or bill pointing at nothing",
  { skip: !HAS_DB }, async () => {
    const itemId = await newLogin();
    const accountId = await newAccount(itemId);
    await insertTxn(accountId, "-revoke-1");
    await insertBill(accountId, "REVOKE");

    // The bill is visible to the projector's read while the login stands.
    const before = await listRecurringBills(db, { orgId, bankAccountId: accountId });
    assert.equal(before.length, 1, "the bill should be readable before the revoke");

    // The client revokes consent: the login row goes, and 081:42 cascades the
    // accounts under it away.
    await db.query(`DELETE FROM plaid_items WHERE id = $1`, [itemId]);
    assert.equal(
      await countWhere(`SELECT count(*)::int AS n FROM bank_accounts WHERE id = $1`, [accountId]),
      0, "the account should have cascaded away with the login"
    );

    assert.equal(
      await countWhere(
        `SELECT count(*)::int AS n FROM bank_transactions WHERE bank_account_id = $1`, [accountId]
      ),
      0, "a transaction survived a revoked login, pointing at an account that is gone"
    );
    assert.equal(
      await countWhere(
        `SELECT count(*)::int AS n FROM recurring_bills WHERE bank_account_id = $1`, [accountId]
      ),
      0, "a bill survived a revoked login, pointing at an account that is gone"
    );

    // And the read the projector uses returns nothing, rather than pricing a
    // client's cash flow off a connection they withdrew.
    const after = await listRecurringBills(db, { orgId, bankAccountId: accountId });
    assert.equal(after.length, 0, "listRecurringBills still returns a disconnected account's bill");
  });

test("deleting one account does not touch another account's rows",
  { skip: !HAS_DB }, async () => {
    const keep = await newAccount();
    const drop = await newAccount();
    await insertTxn(keep, "-keep-1");
    await insertBill(keep, "KEEP");
    await insertTxn(drop, "-drop-1");
    await insertBill(drop, "DROP");

    await db.query(`DELETE FROM bank_accounts WHERE id = $1`, [drop]);

    assert.equal(
      await countWhere(
        `SELECT count(*)::int AS n FROM bank_transactions WHERE bank_account_id = $1`, [keep]
      ), 1, "the surviving account lost its transaction"
    );
    assert.equal(
      await countWhere(
        `SELECT count(*)::int AS n FROM recurring_bills WHERE bank_account_id = $1`, [keep]
      ), 1, "the surviving account lost its bill"
    );
  });

/* ========================================================================= *
 * The standing audit: no orphans, anywhere, ever
 * ========================================================================= */

test("no transaction or bill anywhere points at a missing account", { skip: !HAS_DB }, async () => {
  for (const table of ["bank_transactions", "recurring_bills"]) {
    const n = await countWhere(
      `SELECT count(*)::int AS n
         FROM ${table} x
         LEFT JOIN bank_accounts a ON a.id = x.bank_account_id
        WHERE a.id IS NULL`
    );
    assert.equal(n, 0, `${table} holds ${n} row(s) pointing at an account that does not exist`);
  }
});
