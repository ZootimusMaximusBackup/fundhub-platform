// Real-Postgres tests for the revoke path and migrations 101/102.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// THIS IS WHERE THE ORPHAN BUG IS PROVEN AGAINST A REAL DATABASE. The unit-level
// proof is src/banking/orphan-anchor.test.mjs, which reads the migration and runs
// on every pass. This file does the honest version — actually delete a client and
// see whether the transactions can still be found — and it can only run where
// there is a Postgres to delete it in.
//
// Both tests exist on purpose. CLAUDE.md §12 records that with DATABASE_URL unset
// roughly 193 pg tests skip and the suite reports zero failures, so a control that
// lives only here does not run in the passes where somebody reverts it.
//
// A DEFAULT AND A CASCADE ARE SCHEMA FACTS, NOT CODE FACTS. That plaid_items
// cascades to bank_accounts, that a client delete nulls bank_transactions.client_id,
// and that the trigger fills subject_client_id on any INSERT from any source, are
// all things only the database can answer. A stubbed test cannot.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { revokeBankLogin } from "./revoke.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "revoke_w101_pg_test@example.com";
const STAMP = "revoke-pg-test";

let orgId = null;
let clientId = null;
let itemId = null;
let accountId = null;

async function wipe() {
  await db.query(`DELETE FROM erasure_requests WHERE reason = $1`, [STAMP + " reason, long enough"]);
  await db.query(
    `DELETE FROM bank_transactions WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(
    `DELETE FROM bank_accounts WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(
    `DELETE FROM plaid_items WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  // By org rather than by email: an erased client has a NULL email, and a cleanup
  // keyed on the address would leave the row behind and fail the org delete below.
  await db.query(`DELETE FROM clients WHERE org_id IN (SELECT id FROM orgs WHERE slug LIKE $1)`, [STAMP + '%']);
  await db.query(`DELETE FROM orgs WHERE slug LIKE $1`, [STAMP + '%']);
}

/* Build one org, one client, one login, one account and two transactions. */
async function seed() {
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP])).rows[0].id;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name) VALUES ($1,$2,'Test') RETURNING id`,
    [orgId, EMAIL])).rows[0].id;

  itemId = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, institution_name, link_state)
     VALUES ($1,$2,'Test Bank','active') RETURNING id`, [orgId, clientId])).rows[0].id;

  accountId = (await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, name)
     VALUES ($1,$2,$3,'Checking') RETURNING id`, [orgId, clientId, itemId])).rows[0].id;

  // NOTE: subject_client_id is deliberately NOT named here. The trigger from
  // migration 101 must fill it — that is the assertion in the first test.
  for (const [ref, cents] of [["txn-1", -2500], ["txn-2", 180000]]) {
    await db.query(
      `INSERT INTO bank_transactions
         (org_id, bank_account_id, client_id, amount_cents, posted_on, merchant_name, provider_transaction_id)
       VALUES ($1,$2,$3,$4,'2026-06-01','SQ *TEST MERCHANT',$5)`,
      [orgId, accountId, clientId, cents, ref]);
  }
}

before(async () => { if (!HAS_DB) return; await wipe(); await seed(); });
after(async () => { if (!HAS_DB) return; await wipe(); await close(); });

describe("migration 101: the anchor is a schema fact", () => {

  test("the trigger fills subject_client_id on an INSERT that never mentions it", { skip: !HAS_DB }, async () => {
    // The ingest path for this table is owned by another workflow and rows also
    // arrive from backfills and psql sessions. If the anchor depended on a writer
    // remembering it, it would be NULL on exactly the rows that matter. seed()
    // above does not name the column.
    const rows = (await db.query(
      `SELECT subject_client_id FROM bank_transactions WHERE org_id = $1`, [orgId])).rows;

    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.subject_client_id, clientId,
        "the trigger did not populate the anchor — any writer must pick it up");
    }
  });

  test("subject_client_id is not a foreign key, per the database catalog", { skip: !HAS_DB }, async () => {
    // Asserted against pg_constraint rather than the migration text: this is the
    // fact that actually governs behaviour, and a later migration could add the
    // FK without touching 101.
    const fks = (await db.query(
      `SELECT c.conname
         FROM pg_constraint c
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'bank_transactions'::regclass
          AND c.contype = 'f'
          AND a.attname = 'subject_client_id'`)).rows;

    assert.deepEqual(fks, [],
      "subject_client_id has a foreign key. SET NULL reproduces the orphan bug, " +
      "CASCADE destroys the ledger, RESTRICT blocks client deletion. It must stay a plain uuid.");
  });

  test("*** THE ORPHAN BUG: deleting the client leaves the ledger findable ***", { skip: !HAS_DB }, async () => {
    // The honest version of the proof. Before migration 101 this test could not
    // pass: client_id becomes NULL, the bank_accounts row cascades away, and
    // bank_account_id points at nothing.
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);

    // Both severances really did happen — this is the bug, still present.
    const after = (await db.query(
      `SELECT client_id, bank_account_id, subject_client_id
         FROM bank_transactions WHERE org_id = $1`, [orgId])).rows;

    assert.equal(after.length, 2, "the ledger must survive a client delete");
    for (const r of after) {
      assert.equal(r.client_id, null, "ON DELETE SET NULL still fires — the direct link is gone");
    }
    const acct = (await db.query(`SELECT id FROM bank_accounts WHERE id = $1`, [accountId])).rows;
    assert.deepEqual(acct, [], "the account cascaded away — the route through it is gone too");

    // AND YET THE ROWS ARE STILL FINDABLE. This is the whole fix.
    const found = (await db.query(
      `SELECT id FROM bank_transactions WHERE org_id = $1 AND subject_client_id = $2`,
      [orgId, clientId])).rows;
    assert.equal(found.length, 2,
      "the transactions are unreachable. A later erasure request would search by " +
      "client_id, match nothing, and report the person erased when they were not.");

    // Put the world back for the remaining tests.
    await wipe(); await seed();
  });

  test("the SET NULL update does not clear the anchor", { skip: !HAS_DB }, async () => {
    // The subtle failure: ON DELETE SET NULL arrives at the trigger as an UPDATE
    // with client_id NULL. A symmetric trigger would null the anchor at exactly
    // the moment it becomes the only copy.
    await db.query(`UPDATE bank_transactions SET client_id = NULL WHERE org_id = $1`, [orgId]);
    const rows = (await db.query(
      `SELECT subject_client_id FROM bank_transactions WHERE org_id = $1`, [orgId])).rows;
    for (const r of rows) assert.equal(r.subject_client_id, clientId, "the anchor was cleared by an UPDATE");

    await wipe(); await seed();
  });
});

describe("migration 102: the audit record refuses a bad row", () => {

  test("a completed client_erasure that kept nothing is rejected by the database", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests
           (org_id, kind, subject_client_id, requested_by_label, reason, status, kept, completed_at)
         VALUES ($1,'client_erasure',$2,'tester','a reason long enough','completed','[]'::jsonb, now())`,
        [orgId, clientId]),
      /erasure_requests_completed_erasure_kept_ck/,
      "a completed erasure that kept nothing is an incomplete audit, not a thorough deletion"
    );
  });

  test("a kept entry with no written reason is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests
           (org_id, kind, subject_client_id, requested_by_label, reason, status, kept, completed_at)
         VALUES ($1,'client_erasure',$2,'tester','a reason long enough','completed',
                 '[{"table":"bank_transactions","rows":3}]'::jsonb, now())`,
        [orgId, clientId]),
      /erasure_requests_kept_reasons_ck/,
      "'{table, rows}' is not an answer to 'what do you still hold and why'"
    );
  });

  test("a throwaway reason is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests (org_id, kind, subject_client_id, requested_by_label, reason)
         VALUES ($1,'client_erasure',$2,'tester','cleanup')`,
        [orgId, clientId]),
      /reason/,
      "'cleanup' is not a reason a regulator accepts"
    );
  });

  test("an unattributed request is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests (org_id, kind, subject_client_id, requested_by_label, reason)
         VALUES ($1,'client_erasure',$2,'   ','a reason long enough')`,
        [orgId, clientId]),
      /requested_by_label/
    );
  });

  test("a bank_revoke must name an item and a client_erasure must not", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests (org_id, kind, subject_client_id, requested_by_label, reason)
         VALUES ($1,'bank_revoke',$2,'tester','a reason long enough')`,
        [orgId, clientId]),
      /erasure_requests_item_matches_kind_ck/
    );

    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests (org_id, kind, subject_client_id, subject_item_id, requested_by_label, reason)
         VALUES ($1,'client_erasure',$2,$3,'tester','a reason long enough')`,
        [orgId, clientId, itemId]),
      /erasure_requests_item_matches_kind_ck/
    );
  });

  test("an invented kind is rejected", { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO erasure_requests (org_id, kind, subject_client_id, requested_by_label, reason)
         VALUES ($1,'because_i_said_so',$2,'tester','a reason long enough')`,
        [orgId, clientId]),
      /kind/
    );
  });

  test("the audit record survives its subject being deleted", { skip: !HAS_DB }, async () => {
    // The reason subject_client_id is not a foreign key. If it cascaded, the proof
    // that the erasure happened would be destroyed at the moment it is needed.
    await db.query(
      `INSERT INTO erasure_requests (org_id, kind, subject_client_id, requested_by_label, reason)
       VALUES ($1,'client_erasure',$2,'tester',$3)`,
      [orgId, clientId, STAMP + " reason, long enough"]);

    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);

    const rows = (await db.query(
      `SELECT id, subject_client_id FROM erasure_requests WHERE subject_client_id = $1`, [clientId])).rows;
    assert.equal(rows.length, 1, "the audit record must outlive the person it documents");

    await wipe(); await seed();
  });
});

describe("revoke against a real database", () => {

  test("*** revoking removes the login and cascades the accounts, and KEEPS the ledger ***", { skip: !HAS_DB }, async () => {
    const out = await revokeBankLogin(db, {
      orgId, itemId,
      requestedBy: { staffId: null, label: "pg test" },
      reason: STAMP + " reason, long enough"
    });

    assert.equal(out.revoked, true);

    // The login and its accounts are gone.
    assert.equal((await db.query(`SELECT id FROM plaid_items WHERE id = $1`, [itemId])).rows.length, 0);
    assert.equal((await db.query(`SELECT id FROM bank_accounts WHERE id = $1`, [accountId])).rows.length, 0,
      "bank_accounts must cascade from plaid_items");

    // THE LEDGER SURVIVES, and is still findable by the anchor.
    const left = (await db.query(
      `SELECT id FROM bank_transactions WHERE org_id = $1 AND subject_client_id = $2`,
      [orgId, clientId])).rows;
    assert.equal(left.length, 2,
      "revoking a bank login is not a request to forget the money moved");

    // And the audit row is real, with both manifests.
    const audit = (await db.query(
      `SELECT kind, status, removed, kept FROM erasure_requests WHERE id = $1`, [out.auditId])).rows[0];
    assert.equal(audit.kind, "bank_revoke");
    assert.equal(audit.status, "completed");
    assert.ok(audit.kept.some((k) => k.table === "bank_transactions" && k.rows === 2));

    await wipe(); await seed();
  });

  test("another org's login is not found", { skip: !HAS_DB }, async () => {
    const other = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP + "-other"])).rows[0].id;
    try {
      await assert.rejects(
        () => revokeBankLogin(db, {
          orgId: other, itemId,
          requestedBy: { label: "pg test" }, reason: STAMP + " reason, long enough"
        }),
        (e) => { assert.equal(e.status, 404); return true; }
      );
      // And it really is still there.
      assert.equal((await db.query(`SELECT id FROM plaid_items WHERE id = $1`, [itemId])).rows.length, 1);
    } finally {
      await db.query(`DELETE FROM orgs WHERE id = $1`, [other]);
    }
  });
});
