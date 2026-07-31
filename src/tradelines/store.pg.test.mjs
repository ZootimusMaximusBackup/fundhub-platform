// Real-Postgres integration test for tradeline storage.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot: the 054 constraints hold, the
// upsert really is idempotent against the partial unique index, and a second
// pull that omits an APR does not erase the one we already had.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { upsertTradelines, ingestCrsResult, listTradelines } from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "tradelines_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(`DELETE FROM tradelines WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM crs_results WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Trade','Line') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("upsert stores a line and re-running updates rather than duplicating", { skip: !HAS_DB }, async () => {
  const row = {
    lender: "Amex Blue Business", kind: "revolving",
    credit_limit_cents: 1800000, balance_cents: 820000, apr: 0.1699,
    source: "crs", source_ref: null, account_ref: "A1", raw: { creditor: "Amex" }, as_of: new Date().toISOString()
  };

  await upsertTradelines(db, { orgId, clientId, rows: [row] });
  await upsertTradelines(db, { orgId, clientId, rows: [{ ...row, balance_cents: 900000 }] });

  const rows = await listTradelines(db, { clientId, orgId });
  assert.equal(rows.length, 1, "same account_ref must update, not insert a second card");
  assert.equal(Number(rows[0].balance_cents), 900000, "the newer balance wins");
});

test("a later pull that omits the APR does not erase the known rate", { skip: !HAS_DB }, async () => {
  const rows = await upsertTradelines(db, {
    orgId, clientId,
    rows: [{
      lender: "Amex Blue Business", kind: "revolving",
      credit_limit_cents: 1800000, balance_cents: 900000, apr: null,
      source: "crs", source_ref: null, account_ref: "A1", raw: {}, as_of: null
    }]
  });
  assert.equal(Number(rows[0].apr), 0.1699, "absence is not a correction");
});

test("a line with no account_ref inserts rather than merging into another card", { skip: !HAS_DB }, async () => {
  const manual = {
    lender: "Manually entered card", kind: "revolving",
    credit_limit_cents: 500000, balance_cents: 0, apr: 0.2499,
    source: "manual", source_ref: null, account_ref: null, raw: {}, as_of: null
  };
  await upsertTradelines(db, { orgId, clientId, rows: [manual] });
  await upsertTradelines(db, { orgId, clientId, rows: [manual] });

  const rows = await listTradelines(db, { clientId, orgId });
  const unmatched = rows.filter((r) => r.account_ref === null);
  assert.equal(unmatched.length, 2, "unmatchable lines stay visible instead of being averaged away");
});

test("ingestCrsResult reads the lines out of a stored pull", { skip: !HAS_DB }, async () => {
  const crs = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3) RETURNING *`,
    [orgId, clientId, JSON.stringify({
      tradelines: [
        { creditor: "Capital One Spark", credit_limit: 15000, balance: 4000, apr: 14.99, account_number: "B1" },
        { creditor: "Citi Costco", credit_limit: 12000, balance: 4700, apr: 18.99, account_number: "B2" }
      ]
    })]
  )).rows[0];

  const { ingested, rows } = await ingestCrsResult(db, crs);
  assert.equal(ingested, 2);
  assert.ok(rows.every((r) => r.source === "crs" && r.source_ref === crs.id),
    "every stored line points back at the pull it came from");
});

test("the schema refuses a negative limit and an out-of-range APR", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, credit_limit_cents) VALUES ($1,$2,'Bad',-1)`,
      [orgId, clientId]
    ),
    /violates check constraint/
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, apr) VALUES ($1,$2,'Bad',1.5)`,
      [orgId, clientId]
    ),
    /violates check constraint/
  );
});
