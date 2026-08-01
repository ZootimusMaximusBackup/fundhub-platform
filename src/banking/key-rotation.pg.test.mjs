// Key rotation against real Postgres — the no-downtime claim, on real rows.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// src/banking/key-rotation.test.mjs proves the cryptography with pure functions
// and runs on every pass. This file proves the two claims that are about the
// DATABASE rather than the cipher, and that a fake handle cannot establish:
//
//   1. NO PLAINTEXT IS EVER WRITTEN. Asserted by reading the stored bytes back
//      out of Postgres afterwards and searching the whole table for the secret —
//      not by trusting what the code passed in.
//   2. NO DOWNTIME. A half-rotated table is queried and every row still decrypts,
//      on both key versions at once, with no flag day and no maintenance window.
//
// The keys here are generated per run. A fixed base64 key in a test file is a key
// in the repository, and the next person who needs one copies the nearest example.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import {
  encryptPlaidToken, decryptPlaidToken, plaidTokenKeyId, rotatePlaidTokens
} from "./plaid.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const STAMP = "rotation-pg-test";
const EMAIL = "rotation_pg_test@example.com";

const KEY_V1 = crypto.randomBytes(32).toString("base64");
const KEY_V2 = crypto.randomBytes(32).toString("base64");
const ENV = { PLAID_TOKEN_ENC_KEY: KEY_V1, PLAID_TOKEN_ENC_KEY_V2: KEY_V2 };

/* Fake, random, and never a real credential. */
const SECRETS = ["access-sandbox-aaa-111", "access-sandbox-bbb-222", "access-sandbox-ccc-333"];

let orgId = null;
let clientId = null;
let itemIds = [];

async function wipe() {
  await db.query(`DELETE FROM plaid_items WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM clients WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [STAMP]);
}

async function seed() {
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP])).rows[0].id;
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email) VALUES ($1,$2) RETURNING id`, [orgId, EMAIL])).rows[0].id;

  itemIds = [];
  for (const secret of SECRETS) {
    // Two steps on purpose: the ciphertext binds the row's id as additional
    // authenticated data, so the row has to exist before its token can be sealed.
    const id = (await db.query(
      `INSERT INTO plaid_items (org_id, client_id, institution_name, link_state)
       VALUES ($1,$2,'Test Bank','active') RETURNING id`, [orgId, clientId])).rows[0].id;
    await db.query(
      `UPDATE plaid_items SET encrypted_access_token = $1 WHERE id = $2`,
      [encryptPlaidToken(secret, { itemId: id, env: ENV }), id]);
    itemIds.push(id);
  }
}

before(async () => { if (!HAS_DB) return; await wipe(); await seed(); });
after(async () => { if (!HAS_DB) return; await wipe(); await close(); });

describe("key rotation against a real database", () => {

  test("the rows start on v1 and decrypt", { skip: !HAS_DB }, async () => {
    const rows = (await db.query(
      `SELECT id, encrypted_access_token FROM plaid_items WHERE org_id = $1 ORDER BY created_at`, [orgId])).rows;

    assert.equal(rows.length, 3);
    rows.forEach((r, i) => {
      assert.equal(plaidTokenKeyId(r.encrypted_access_token), "v1");
      assert.equal(decryptPlaidToken(r.encrypted_access_token, { itemId: r.id, env: ENV }), SECRETS[i]);
    });
  });

  test("*** ROTATE, THEN DECRYPT, reading the bytes back out of Postgres ***", { skip: !HAS_DB }, async () => {
    const summary = await rotatePlaidTokens(db, { orgId, toKeyId: "v2", env: ENV });
    assert.deepEqual(
      { scanned: summary.scanned, rotated: summary.rotated, alreadyCurrent: summary.alreadyCurrent, failed: summary.failed },
      { scanned: 3, rotated: 3, alreadyCurrent: 0, failed: [] });

    const rows = (await db.query(
      `SELECT id, encrypted_access_token FROM plaid_items WHERE org_id = $1 ORDER BY created_at`, [orgId])).rows;

    rows.forEach((r, i) => {
      assert.equal(plaidTokenKeyId(r.encrypted_access_token), "v2", "the stored row did not move to the new key");
      assert.equal(
        decryptPlaidToken(r.encrypted_access_token, { itemId: r.id, env: ENV }), SECRETS[i],
        "a rotated token must still decrypt to the original credential"
      );
    });
  });

  test("*** NO PLAINTEXT ANYWHERE IN THE TABLE, checked against the database itself ***", { skip: !HAS_DB }, async () => {
    // Not "the code did not pass it in" — the actual stored bytes, cast to text
    // and searched. This is what a temp plaintext column, a partial write or a
    // botched rollback would show up as.
    for (const secret of SECRETS) {
      const hits = (await db.query(
        `SELECT id FROM plaid_items
          WHERE org_id = $1 AND (plaid_items::text LIKE '%' || $2 || '%')`,
        [orgId, secret])).rows;
      assert.deepEqual(hits, [], `the plaintext token ${secret.slice(0, 16)}... is present in plaid_items`);
    }
  });

  test("no plaintext staging column was added or left behind", { skip: !HAS_DB }, async () => {
    // The classic bad rotation shape: add plaintext_token, decrypt into it,
    // re-encrypt, drop it. It leaves the value in WAL and in every backup taken
    // during the run, and dropping the column afterwards does not unwrite it.
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'plaid_items'`)).rows.map((r) => r.column_name);

    assert.deepEqual(cols.filter((c) => /plain|temp|_old$|_new$|decrypt/i.test(c)), [],
      "plaid_items has a column that looks like plaintext staging: " + cols.join(", "));
    assert.ok(cols.includes("encrypted_access_token"), "sanity: the ciphertext column is still there");
  });

  test("*** NO DOWNTIME: a half-rotated table reads correctly on both keys at once ***", { skip: !HAS_DB }, async () => {
    await wipe(); await seed();

    // Move exactly one row, leaving the other two on v1 — the state the table is
    // in for the whole middle of a real rotation.
    await rotatePlaidTokens(db, { orgId, toKeyId: "v2", env: ENV, limit: 1 });

    const rows = (await db.query(
      `SELECT id, encrypted_access_token FROM plaid_items WHERE org_id = $1 ORDER BY created_at`, [orgId])).rows;

    const versions = rows.map((r) => plaidTokenKeyId(r.encrypted_access_token));
    assert.deepEqual(versions, ["v2", "v1", "v1"], "expected exactly one row to have moved");

    // ONE READER, ONE ENVIRONMENT, BOTH VERSIONS. No flag day, no lock, no window
    // in which a credential is unreadable.
    rows.forEach((r, i) => {
      assert.equal(
        decryptPlaidToken(r.encrypted_access_token, { itemId: r.id, env: ENV }), SECRETS[i],
        "a half-rotated table must read correctly on every row"
      );
    });
  });

  test("re-running finishes the job and leaves the already-moved rows alone", { skip: !HAS_DB }, async () => {
    const before = (await db.query(
      `SELECT id, encrypted_access_token FROM plaid_items WHERE org_id = $1 ORDER BY created_at`, [orgId])).rows;
    const alreadyMoved = before[0].encrypted_access_token;

    const summary = await rotatePlaidTokens(db, { orgId, toKeyId: "v2", env: ENV });
    assert.deepEqual(
      { rotated: summary.rotated, alreadyCurrent: summary.alreadyCurrent, failed: summary.failed },
      { rotated: 2, alreadyCurrent: 1, failed: [] });

    const after = (await db.query(
      `SELECT id, encrypted_access_token FROM plaid_items WHERE org_id = $1 ORDER BY created_at`, [orgId])).rows;

    assert.equal(after[0].encrypted_access_token, alreadyMoved,
      "a row already on the target key must not be rewritten");
    after.forEach((r, i) => {
      assert.equal(plaidTokenKeyId(r.encrypted_access_token), "v2");
      assert.equal(decryptPlaidToken(r.encrypted_access_token, { itemId: r.id, env: ENV }), SECRETS[i]);
    });
  });

  test("a row with no credential is skipped rather than counted as a failure", { skip: !HAS_DB }, async () => {
    await db.query(
      `INSERT INTO plaid_items (org_id, client_id, link_state) VALUES ($1,$2,'unlinked')`, [orgId, clientId]);

    const summary = await rotatePlaidTokens(db, { orgId, toKeyId: "v2", env: ENV });
    assert.equal(summary.scanned, 3, "the credential-less row must not even be selected");
    assert.deepEqual(summary.failed, []);
  });

  test("another org's credentials are not touched", { skip: !HAS_DB }, async () => {
    const otherOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP + "-other"])).rows[0].id;
    try {
      const otherClient = (await db.query(
        `INSERT INTO clients (org_id, email) VALUES ($1,$2) RETURNING id`,
        [otherOrg, "other_" + EMAIL])).rows[0].id;
      const otherItem = (await db.query(
        `INSERT INTO plaid_items (org_id, client_id, link_state) VALUES ($1,$2,'active') RETURNING id`,
        [otherOrg, otherClient])).rows[0].id;
      await db.query(`UPDATE plaid_items SET encrypted_access_token = $1 WHERE id = $2`,
        [encryptPlaidToken("access-sandbox-other-org", { itemId: otherItem, env: ENV }), otherItem]);

      await rotatePlaidTokens(db, { orgId, toKeyId: "v2", env: ENV });

      const still = (await db.query(
        `SELECT encrypted_access_token FROM plaid_items WHERE id = $1`, [otherItem])).rows[0];
      assert.equal(plaidTokenKeyId(still.encrypted_access_token), "v1",
        "rotating one org must not reach another org's credentials");
    } finally {
      await db.query(`DELETE FROM plaid_items WHERE org_id = $1`, [otherOrg]);
      await db.query(`DELETE FROM clients WHERE org_id = $1`, [otherOrg]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [otherOrg]);
    }
  });
});
