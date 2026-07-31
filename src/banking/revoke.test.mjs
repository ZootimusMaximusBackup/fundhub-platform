// Revoking a bank login — unit tests over a stubbed database.
//
// No DATABASE_URL and no Postgres. The stub has no connect(), so
// src/db/with-transaction.mjs runs the callback inline (its third branch) and
// these tests exercise the real ordering of statements without a server. The
// behaviour that genuinely needs a database — that deleting plaid_items really
// does cascade bank_accounts — is asserted in revoke.pg.test.mjs, which skips
// unless DATABASE_URL is set.
//
// WHAT IS BEING PROVEN HERE, in order of how much it would cost to get wrong:
//   1. The audit row is written BEFORE the delete, in the same transaction.
//   2. Transactions are KEPT, and the manifest says so with a written reason.
//   3. A revoke over unanchored transactions is REFUSED, not warned about.
//   4. Org scope comes from the caller and fails closed.
//   5. No credential is ever selected, returned or echoed.

import { test, describe } from "node:test";
import assert from "node:assert";

import { revokeBankLogin, listBankLogins, RevokeError, TRANSACTIONS_KEPT_REASON } from "./revoke.mjs";

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const STAFF = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ACCOUNT = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const REQUESTED_BY = { staffId: STAFF, label: "Dana Owner <" + STAFF + ">" };
const REASON = "client called and asked us to disconnect their Chase login";

/* A stubbed database that records every statement in order. Deliberately dumb:
   it routes on the shape of the SQL and returns what the caller configured, so a
   test can say "this login has 12 transactions under it" without a schema. */
function stubDb({
  item = { id: ITEM, org_id: ORG, client_id: CLIENT, institution_name: "Chase", link_state: "active", has_access_token: true },
  accounts = [{ id: ACCOUNT }],
  txnCount = 0,
  unanchoredCount = 0,
  deleteRowCount = 1
} = {}) {
  const log = [];
  return {
    log,
    async query(sql, params) {
      log.push({ sql: sql.replace(/\s+/g, " ").trim(), params });

      if (/FROM plaid_items[\s\S]*FOR UPDATE/i.test(sql)) {
        const [id, org] = params;
        return { rows: item && item.id === id && item.org_id === org ? [item] : [] };
      }
      if (/SELECT id FROM bank_accounts/i.test(sql)) return { rows: accounts };
      if (/count\(\*\)[\s\S]*bank_transactions[\s\S]*subject_client_id IS NULL/i.test(sql)) {
        return { rows: [{ n: String(unanchoredCount) }] };
      }
      if (/count\(\*\)[\s\S]*bank_transactions/i.test(sql)) {
        return { rows: [{ n: String(txnCount) }] };
      }
      if (/INSERT INTO erasure_requests/i.test(sql)) {
        return { rows: [{ id: "audit-1", created_at: "2026-07-31T00:00:00Z" }] };
      }
      if (/DELETE FROM plaid_items/i.test(sql)) {
        return { rowCount: deleteRowCount, rows: deleteRowCount ? [{ id: ITEM }] : [] };
      }
      if (/FROM plaid_items i/i.test(sql)) return { rows: [] };
      throw new Error("unexpected sql: " + sql);
    }
  };
}

const indexOfSql = (log, re) => log.findIndex((c) => re.test(c.sql));

describe("revoke: the order of operations", () => {

  test("*** the audit row is written BEFORE the login is deleted ***", async () => {
    // If the delete came first and the audit insert then failed, the credential
    // would be gone with no record that anybody asked for it. Inside one
    // transaction the rollback saves it either way, but the ordering is the part
    // that does not depend on the transaction being real — and
    // src/pii/index.mjs's own rule ("no log row, no plaintext") is the precedent.
    const db = stubDb({ txnCount: 12 });
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    const audit = indexOfSql(db.log, /INSERT INTO erasure_requests/i);
    const del = indexOfSql(db.log, /DELETE FROM plaid_items/i);

    assert.ok(audit >= 0, "no audit row was written");
    assert.ok(del >= 0, "the login was never deleted");
    assert.ok(audit < del, "the audit row must be written before the delete, not after");
  });

  test("the counts are taken before the delete, or they would all be zero", async () => {
    const db = stubDb({ txnCount: 5 });
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    const count = indexOfSql(db.log, /count\(\*\)[\s\S]*bank_transactions/i);
    const del = indexOfSql(db.log, /DELETE FROM plaid_items/i);
    assert.ok(count >= 0 && count < del, "counting after the cascade counts nothing");
  });

  test("the login row is locked FOR UPDATE before anything is decided about it", async () => {
    const db = stubDb();
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    assert.match(db.log[0].sql, /FOR UPDATE/i);
  });
});

describe("revoke: the transactions are kept, deliberately", () => {

  test("*** the ledger is NOT deleted — no statement touches bank_transactions destructively ***", async () => {
    const db = stubDb({ txnCount: 412 });
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    for (const call of db.log) {
      assert.ok(
        !/DELETE FROM bank_transactions/i.test(call.sql),
        "revoking a bank login must never delete the ledger. Disconnecting an account " +
        "is not a request to forget that the money moved — that is an erasure request."
      );
      assert.ok(!/TRUNCATE/i.test(call.sql));
    }
  });

  test("what was kept is recorded with a written reason, not just a count", async () => {
    const db = stubDb({ txnCount: 412 });
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    const kept = out.kept.find((k) => k.table === "bank_transactions");
    assert.ok(kept, "bank_transactions must appear in the kept manifest");
    assert.equal(kept.rows, 412);
    assert.equal(kept.reason, TRANSACTIONS_KEPT_REASON);
    // Migration 102 rejects a kept entry whose reason is shorter than 20 characters.
    assert.ok(kept.reason.length >= 20);
    assert.match(kept.reason, /erasure request/i, "the reason must point at the route that DOES remove them");
  });

  test("the removed manifest names the credential and the accounts, with counts", async () => {
    const db = stubDb({ accounts: [{ id: ACCOUNT }, { id: "a2" }, { id: "a3" }], txnCount: 7 });
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    const items = out.removed.find((r) => r.table === "plaid_items");
    const accts = out.removed.find((r) => r.table === "bank_accounts");
    assert.equal(items.rows, 1);
    assert.match(items.detail, /access token/i);
    assert.equal(accts.rows, 3);
  });

  test("a login with no token stored says so rather than claiming one was removed", async () => {
    const db = stubDb({
      item: { id: ITEM, org_id: ORG, client_id: CLIENT, institution_name: null, link_state: "unlinked", has_access_token: false }
    });
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    assert.match(out.removed.find((r) => r.table === "plaid_items").detail, /no access token was stored/i);
  });
});

describe("revoke: it refuses to create orphans", () => {

  test("*** REFUSED when transactions under the login have no anchor ***", async () => {
    // Deleting the accounts above unanchored rows strands them permanently: no
    // client_id after the next client delete, and a bank_account_id pointing at
    // nothing. That is the exact bug migration 101 fixes, and doing it while
    // writing an audit row that says the ledger was kept safely is worse than
    // doing it loudly.
    const db = stubDb({ txnCount: 10, unanchoredCount: 3 });

    await assert.rejects(
      () => revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON }),
      (e) => {
        assert.equal(e.status, 409);
        assert.match(e.message, /refusing to revoke/i);
        assert.match(e.message, /3 of 10/);
        assert.match(e.message, /migration 101/i);
        return true;
      }
    );

    // And it stopped before doing anything.
    assert.equal(indexOfSql(db.log, /DELETE FROM plaid_items/i), -1, "nothing may be deleted after a refusal");
    assert.equal(indexOfSql(db.log, /INSERT INTO erasure_requests/i), -1, "no audit row for an action that did not happen");
  });

  test("a login with no transactions under it skips the anchor check and proceeds", async () => {
    const db = stubDb({ txnCount: 0, unanchoredCount: 99 });
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    assert.equal(out.revoked, true);
    assert.equal(out.kept.find((k) => k.table === "bank_transactions").rows, 0);
  });

  test("if the row moves underneath the revoke, nothing is reported as removed", async () => {
    const db = stubDb({ deleteRowCount: 0 });
    await assert.rejects(
      () => revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON }),
      (e) => {
        assert.equal(e.status, 409);
        assert.match(e.message, /nothing was removed/i);
        return true;
      }
    );
  });
});

describe("revoke: org scope fails closed", () => {

  test("another org's login is not found, and the answer is the same as for one that does not exist", async () => {
    const db = stubDb();
    await assert.rejects(
      () => revokeBankLogin(db, { orgId: OTHER_ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON }),
      (e) => { assert.equal(e.status, 404); assert.match(e.message, /not found/); return true; }
    );

    await assert.rejects(
      () => revokeBankLogin(stubDb({ item: null }), { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON }),
      (e) => { assert.equal(e.status, 404); assert.match(e.message, /not found/); return true; }
    );
  });

  test("the org goes into the WHERE clause, not into a check afterwards", async () => {
    const db = stubDb();
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    assert.match(db.log[0].sql, /WHERE id = \$1 AND org_id = \$2/i);
    assert.deepEqual(db.log[0].params, [ITEM, ORG]);
  });

  test("a missing or malformed org id throws before any query runs", async () => {
    for (const bad of [undefined, null, "", "not-a-uuid", "  "]) {
      const db = stubDb();
      await assert.rejects(
        () => revokeBankLogin(db, { orgId: bad, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON }),
        /orgId must be a uuid/
      );
      assert.equal(db.log.length, 0, "an unscoped revoke must not reach the database at all");
    }
  });

  test("a malformed item id is refused before any query runs", async () => {
    for (const bad of [undefined, null, "", "1; DROP TABLE plaid_items"]) {
      const db = stubDb();
      await assert.rejects(
        () => revokeBankLogin(db, { orgId: ORG, itemId: bad, requestedBy: REQUESTED_BY, reason: REASON }),
        /itemId must be a uuid/
      );
      assert.equal(db.log.length, 0);
    }
  });
});

describe("revoke: attribution and reason are required in the module, not only the browser", () => {

  test("an unattributed revoke is refused", async () => {
    const db = stubDb();
    for (const bad of [undefined, {}, { label: "" }, { label: "   " }, { staffId: STAFF }]) {
      await assert.rejects(
        () => revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: bad, reason: REASON }),
        /requestedBy.label is required/
      );
    }
    assert.equal(db.log.length, 0);
  });

  test("a missing or throwaway reason is refused — migration 102 requires ten characters", async () => {
    const db = stubDb();
    for (const bad of [undefined, null, "", "cleanup", "n/a", "        "]) {
      await assert.rejects(
        () => revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: bad }),
        /reason is required/
      );
    }
    assert.equal(db.log.length, 0);
  });

  test("the audit row carries the org, the client, the item, the staff id and the label", async () => {
    const db = stubDb({ txnCount: 2 });
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });

    const insert = db.log.find((c) => /INSERT INTO erasure_requests/i.test(c.sql));
    assert.match(insert.sql, /'bank_revoke'/, "the audit row must record which kind of removal this was");
    const [org, subject, item, staffId, label, why] = insert.params;
    assert.deepEqual([org, subject, item, staffId, label, why], [ORG, CLIENT, ITEM, STAFF, REQUESTED_BY.label, REASON]);
  });

  test("a non-uuid staff id becomes NULL rather than being passed through to a foreign key", async () => {
    const db = stubDb();
    await revokeBankLogin(db, {
      orgId: ORG, itemId: ITEM, reason: REASON,
      requestedBy: { staffId: "dashboard-shared-secret", label: "shared secret caller" }
    });
    const insert = db.log.find((c) => /INSERT INTO erasure_requests/i.test(c.sql));
    assert.equal(insert.params[3], null);
    assert.equal(insert.params[4], "shared secret caller", "the label still records who it was");
  });
});

describe("revoke: no credential ever leaves the module", () => {

  test("the SELECT does not name encrypted_access_token at all", async () => {
    // Stronger than redacting afterwards: there is no line to forget to add.
    const db = stubDb();
    await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    for (const call of db.log) {
      assert.ok(
        !/SELECT[\s\S]*[^(]\bencrypted_access_token\b(?![\s]*IS)/i.test(call.sql) ||
        /encrypted_access_token IS NOT NULL/i.test(call.sql),
        "the credential column may only be tested for presence, never selected: " + call.sql
      );
    }
  });

  test("the return value carries no token and no key material", async () => {
    const db = stubDb({ txnCount: 3 });
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON });
    const blob = JSON.stringify(out);
    assert.ok(!/encrypted_access_token/.test(blob));
    assert.ok(!/access-sandbox|access-production/.test(blob));
    assert.equal(out.item.id, ITEM);
  });

  test("listBankLogins reports presence, never the value", async () => {
    const db = {
      async query(sql) {
        assert.match(sql, /encrypted_access_token IS NOT NULL\) AS has_access_token/,
          "the list must test presence, not select the column");
        assert.ok(!/SELECT[\s\S]*i\.encrypted_access_token\s*,/i.test(sql));
        return { rows: [{ id: ITEM, has_access_token: true, account_count: "2" }] };
      }
    };
    const rows = await listBankLogins(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(rows[0].has_access_token, true);
    assert.equal(rows[0].encrypted_access_token, undefined);
  });

  test("listBankLogins fails closed without an org", async () => {
    const db = { async query() { throw new Error("must not be reached"); } };
    await assert.rejects(() => listBankLogins(db, { clientId: CLIENT }), /orgId must be a uuid/);
    await assert.rejects(() => listBankLogins(db, { orgId: ORG }), /clientId must be a uuid/);
  });
});

describe("revoke: the provider gap is reported, never hidden", () => {

  test("provider_revoked is false and says why, even on a successful local revoke", async () => {
    // Nothing in this repository transmits. A caller must not read "revoked: true"
    // as "access is torn down at the bank".
    const db = stubDb();
    const out = await revokeBankLogin(db, {
      orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON, env: {}
    });

    assert.equal(out.revoked, true, "our own record really is removed");
    assert.equal(out.providerRevoked, false);
    assert.equal(out.providerReason, "not_configured");
    assert.match(out.providerNote, /has NOT been revoked at the provider/i);
  });

  test("with credentials configured it says not_implemented, which is a different fact", async () => {
    const db = stubDb();
    const env = {
      PLAID_CLIENT_ID: "id", PLAID_SECRET: "secret",
      PLAID_TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"), PLAID_ENV: "sandbox"
    };
    const out = await revokeBankLogin(db, { orgId: ORG, itemId: ITEM, requestedBy: REQUESTED_BY, reason: REASON, env });
    assert.equal(out.providerReason, "not_implemented");
  });
});
