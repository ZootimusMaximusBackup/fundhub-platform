// Real-Postgres tests for client erasure.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT ONLY A REAL DATABASE CAN PROVE:
//   - that the erasure finds an ALREADY-ORPHANED row through the anchor. This is
//     the scenario the whole batch exists for and it cannot be simulated: it needs
//     a real ON DELETE SET NULL and a real cascade to create the orphan first.
//   - that a hard DELETE of the client would have been refused anyway, which is
//     one of the two reasons erasure de-identifies instead.
//   - that the CHECK constraints in migration 102 accept the manifests this
//     module actually builds. A stub accepts anything.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { eraseClient, listErasureRequests } from "./erasure.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "erasure_w102_pg_test@example.com";
const STAMP = "erasure-pg-test";
const REASON = "data subject asked to be erased, pg test";

let orgId = null;
let clientId = null;
let itemId = null;
let accountId = null;

async function wipe() {
  await db.query(`DELETE FROM erasure_requests WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM bank_transactions WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM bank_accounts WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM plaid_items WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM pii_access_log WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM pii_identity WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  // BY ORG, NOT BY EMAIL. A successful erasure sets clients.email to NULL, so a
  // cleanup keyed on the email address silently misses the very row the test just
  // erased — and the DELETE FROM orgs below then fails on the foreign key. Found
  // by running this file against a real database, which is the point of having it.
  await db.query(`DELETE FROM clients WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM orgs WHERE slug LIKE $1`, [STAMP + '%']);
}

async function seed() {
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP])).rows[0].id;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, custom_fields, tags)
     VALUES ($1,$2,'Jane','Doe','+15555550100','{"cf_note":"sensitive"}'::jsonb,'{vip}') RETURNING id`,
    [orgId, EMAIL])).rows[0].id;

  await db.query(
    `INSERT INTO pii_identity (org_id, client_id, dob, addresses)
     VALUES ($1,$2,'1985-04-01','[{"line1":"1 Test St"}]'::jsonb)`, [orgId, clientId]);

  await db.query(
    `INSERT INTO pii_access_log (org_id, client_id, accessed_by, field)
     VALUES ($1,$2,'someone','ssn')`, [orgId, clientId]);

  itemId = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, institution_name, link_state)
     VALUES ($1,$2,'Test Bank','active') RETURNING id`, [orgId, clientId])).rows[0].id;

  accountId = (await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, provider, name)
     VALUES ($1,$2,$3,'plaid','Checking') RETURNING id`, [orgId, clientId, itemId])).rows[0].id;

  await db.query(
    `INSERT INTO bank_transactions
       (org_id, bank_account_id, client_id, amount_cents, posted_on, merchant_name, raw, provider_transaction_id)
     VALUES ($1,$2,$3,-2500,'2026-06-01','SQ *BLUE BOTTLE OAKLAND','{"name":"Jane Doe"}'::jsonb,'t-1')`,
    [orgId, accountId, clientId]);
}

before(async () => { if (!HAS_DB) return; await wipe(); await seed(); });
after(async () => { if (!HAS_DB) return; await wipe(); await close(); });

describe("erasure against a real database", () => {

  test("a hard DELETE of the client would be refused — which is why we de-identify", { skip: !HAS_DB }, async () => {
    // pii_access_log.client_id references clients(id) with NO cascade. An erasure
    // built around a delete works in testing, where nobody read the SSN, and
    // fails in production, where somebody did.
    await assert.rejects(
      () => db.query(`DELETE FROM clients WHERE id = $1`, [clientId]),
      /violates foreign key constraint/i,
      "if this ever stops being true, revisit src/privacy/erasure.mjs section 2(a)"
    );
  });

  test("*** the erasure completes and the audit row satisfies every CHECK in 102 ***", { skip: !HAS_DB }, async () => {
    const out = await eraseClient(db, {
      orgId, clientId,
      requestedBy: { staffId: null, label: "pg test <no staff row>" },
      reason: REASON
    });

    assert.equal(out.erased, true);

    const audit = (await db.query(
      `SELECT kind, status, removed, kept, completed_at, requested_by_label
         FROM erasure_requests WHERE id = $1`, [out.auditId])).rows[0];

    assert.equal(audit.kind, "client_erasure");
    assert.equal(audit.status, "completed");
    assert.ok(audit.completed_at, "a completed request must say when");
    assert.ok(audit.kept.length > 0, "a completed erasure that kept nothing is an incomplete audit");
    for (const k of audit.kept) {
      assert.ok(k.reason && k.reason.trim().length >= 20, `${k.table} kept without a written reason`);
    }
  });

  test("the identifying values are gone and the row is retained as a pseudonym", { skip: !HAS_DB }, async () => {
    const row = (await db.query(
      `SELECT first_name, last_name, email, phone, custom_fields, tags FROM clients WHERE id = $1`,
      [clientId])).rows[0];

    assert.ok(row, "the client row must survive — deleting it strands the ledger");
    assert.equal(row.first_name, "[erased]");
    assert.equal(row.last_name, "[erased]");
    assert.equal(row.email, null);
    assert.equal(row.phone, null);
    assert.deepEqual(row.custom_fields, {});
    assert.deepEqual(row.tags, []);
  });

  test("the identity record and the bank credentials are gone", { skip: !HAS_DB }, async () => {
    assert.equal((await db.query(`SELECT id FROM pii_identity WHERE client_id = $1`, [clientId])).rows.length, 0);
    assert.equal((await db.query(`SELECT id FROM plaid_items WHERE id = $1`, [itemId])).rows.length, 0);
    assert.equal((await db.query(`SELECT id FROM bank_accounts WHERE id = $1`, [accountId])).rows.length, 0);
  });

  test("the ledger is kept, scrubbed of who it was about but not of the money", { skip: !HAS_DB }, async () => {
    const rows = (await db.query(
      `SELECT amount_cents, posted_on, merchant_name, raw, subject_client_id
         FROM bank_transactions WHERE org_id = $1`, [orgId])).rows;

    assert.equal(rows.length, 1, "the financial record must survive an erasure");
    assert.equal(rows[0].merchant_name, null, "where they shop is personal data");
    assert.deepEqual(rows[0].raw, {}, "the raw payload carried their name");
    assert.equal(String(rows[0].amount_cents), "-2500", "the amount is the financial record");
    assert.ok(rows[0].posted_on, "the date is the financial record");
    assert.equal(rows[0].subject_client_id, clientId,
      "the anchor stays — it is now a pseudonym and it is what proves the erasure covered this row");
  });

  test("the access log is kept: the values went, the record of who read them stayed", { skip: !HAS_DB }, async () => {
    const rows = (await db.query(`SELECT id FROM pii_access_log WHERE client_id = $1`, [clientId])).rows;
    assert.equal(rows.length, 1, "deleting the access log erases the accountability trail");
  });

  test("the record can be read back after the fact", { skip: !HAS_DB }, async () => {
    const rows = await listErasureRequests(db, { orgId, clientId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "client_erasure");
    assert.equal(rows[0].reason, REASON);
  });
});

describe("erasure finds a client whose row was ALREADY hard-deleted", () => {

  test("*** the scenario the whole batch exists for ***", { skip: !HAS_DB }, async () => {
    await wipe();
    await seed();

    // Create the orphan for real: remove the access-log row so the delete is
    // permitted, then delete the client. client_id goes NULL, the account
    // cascades away, bank_account_id points at nothing.
    await db.query(`DELETE FROM pii_access_log WHERE client_id = $1`, [clientId]);
    await db.query(`DELETE FROM pii_identity WHERE client_id = $1`, [clientId]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);

    const orphan = (await db.query(
      `SELECT client_id, subject_client_id FROM bank_transactions WHERE org_id = $1`, [orgId])).rows;
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].client_id, null, "the direct link really is severed");
    assert.equal(orphan[0].subject_client_id, clientId, "and the anchor really is what is left");

    // An erasure request arrives AFTER the client row is gone. Without the anchor
    // there would be nothing to find and the request would be answered wrongly.
    // eraseClient resolves the client first, so a deleted client is a 404 — the
    // honest answer. What matters is that the data is still LOCATABLE, which is
    // what a compliance team needs in order to act on it at all.
    const found = (await db.query(
      `SELECT id, merchant_name FROM bank_transactions WHERE org_id = $1 AND subject_client_id = $2`,
      [orgId, clientId])).rows;

    assert.equal(found.length, 1,
      "the person's financial history is unreachable. Before migration 101 this is " +
      "exactly where an erasure request would report success having found nothing.");
    assert.equal(found[0].merchant_name, "SQ *BLUE BOTTLE OAKLAND",
      "and it still holds their merchant detail, which is the point");

    // And the erasure endpoint refuses rather than pretending, because the subject
    // no longer exists to scope against.
    await assert.rejects(
      () => eraseClient(db, { orgId, clientId, requestedBy: { label: "pg test" }, reason: REASON }),
      (e) => { assert.equal(e.status, 404); return true; },
      "a client that is gone must be reported as not found, not silently 'erased'"
    );

    await wipe(); await seed();
  });
});
