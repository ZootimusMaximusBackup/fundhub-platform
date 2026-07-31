// Postgres-backed tests for bank linking — /api/banking/plaid and the store
// behind it.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead.
//
// NO LIVE PLAID CALL HAPPENS IN THIS FILE. Two different mechanisms make that
// true, and both are load-bearing:
//
//   1. The endpoint tests run with PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV
//      DELETED from the environment. That is not a convenience — it is the
//      assertion. AUDIT-FINDINGS.md's third lesson is "'absent config' must
//      never mean 'no gate'", and the shape of that failure here would be an
//      unconfigured deploy quietly reaching sandbox.plaid.com with empty keys.
//      These tests prove the endpoint answers 503 and writes no row instead.
//
//   2. The store tests pass an explicit `fetchImpl` stub and an explicit `env`,
//      so nothing resolves through process.env or globalThis.fetch at all.
//
// WHAT THESE TESTS ASSERT AGAINST. Where a claim is about what the system DID —
// "the token was stored encrypted", "the sync was recorded", "a re-sync did not
// erase the classification" — the assertion reads the TABLE, not the response
// body. A response is the endpoint's account of what it did; the row is what it
// did. src/http/pii.pg.test.mjs makes the same distinction for the same reason.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { linkItem, syncItem, classifyAccount, listAccounts, listItems, syncHistory, decryptAccessToken } from "../banking/index.mjs";
import handler from "../../api/banking/plaid.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const BANK_KEY = crypto.randomBytes(32).toString("base64");
const PLAID_ENV = { PLAID_CLIENT_ID: "pgtest_client", PLAID_SECRET: "pgtest_secret", PLAID_ENV: "sandbox" };
const ACCESS_TOKEN = "access-sandbox-pgtest-0000-1111-2222-333344445555";

const STAFF_EMAIL_LIKE = "banking_pg_test_%@example.com";
const CLIENT_EMAIL_LIKE = "banking.pg.test.%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

/* A Plaid that never existed. Returns whatever the test says and counts calls,
   so "no request was made" is checkable rather than assumed. */
function stubPlaid({ accounts = [], item = {}, exchange = { access_token: ACCESS_TOKEN, item_id: "item-pgtest", request_id: "req-x" } } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/item/public_token/exchange")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(exchange) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ accounts, item, request_id: "req-bal" }) };
  };
  fn.calls = calls;
  return fn;
}

const ACCOUNT = (over = {}) => ({
  account_id: "acc-checking",
  mask: "4021",
  name: "Everyday Checking",
  official_name: "Chase Total Checking",
  type: "depository",
  subtype: "checking",
  balances: { current: 4210.55, available: 3990.1, iso_currency_code: "USD", last_updated_datetime: "2026-07-30T12:00:00Z" },
  ...over
});

describe("bank linking", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, otherOrg, client, otherClient, business;
  const staff = {};
  const envBefore = {};

  const call = async (body, token, method = "POST", query = {}) => {
    const r = res();
    await handler({ method, query, body, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE])).rows.map((r) => r.id);
    if (ids.length) {
      // plaid_sync_audit is ON DELETE SET NULL from both sides on purpose — the
      // trail outlives the link — so it has to be cleared by hand.
      await db.query(`DELETE FROM plaid_sync_audit WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM plaid_items WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM businesses WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = 'banking-pg-test-other'`);
  }

  /* Wipe the linked state between tests without tearing down the fixtures. */
  async function reset() {
    await db.query(`DELETE FROM plaid_sync_audit WHERE client_id = ANY($1)`, [[client, otherClient]]);
    await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [[client, otherClient]]);
    await db.query(`DELETE FROM plaid_items WHERE client_id = ANY($1)`, [[client, otherClient]]);
  }

  before(async () => {
    for (const k of ["BANK_TOKEN_ENC_KEY", "PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"]) envBefore[k] = process.env[k];
    process.env.BANK_TOKEN_ENC_KEY = BANK_KEY;
    /* Deleted, not blanked, and left that way for every endpoint test in this
       file. See the header: an unconfigured deploy is the state these tests are
       here to pin down. */
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.PLAID_ENV;

    org = await resolveDefaultOrg(db);
    await purge();

    otherOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('banking-pg-test-other','Other Org PG Test') RETURNING id`
    )).rows[0].id;

    // Three roles inside BANKING_ROLES and two deliberately outside it. The gate
    // in api/banking/plaid.mjs is narrower than ROLE_SETS.STAFF on purpose, and
    // both sides of that line need a witness.
    for (const role of ["owner", "admin", "funding_advisor", "closer", "setter"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Banking Pgtest ${role}`, role, `banking_pg_test_${role}@example.com`]
      )).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Banking','Subject','banking.pg.test.subject@example.com') RETURNING id`,
      [org]
    )).rows[0].id;

    otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Other','Tenant','banking.pg.test.other@example.com') RETURNING id`,
      [otherOrg]
    )).rows[0].id;

    business = (await db.query(
      `INSERT INTO businesses (org_id, client_id, name) VALUES ($1,$2,'Subject Holdings LLC') RETURNING id`,
      [org, client]
    )).rows[0].id;
  });

  after(async () => {
    await purge();
    for (const [k, v] of Object.entries(envBefore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await close();
  });

  // ── absent config means disabled, proven through the whole HTTP path ───────

  describe("an unconfigured deploy refuses, it does not fall through", () => {
    test("POST link answers 503 not_configured and stores nothing", async () => {
      await reset();
      const r = await call({ action: "link", client_id: client, public_token: "public-sandbox-abc" }, staff.admin.token);

      assert.equal(r.code, 503, JSON.stringify(r.body));
      assert.equal(r.body.error, "not_configured");
      assert.match(r.body.message, /PLAID_CLIENT_ID/);

      // The claim is not "it said 503". It is that no half-built link exists.
      const items = (await db.query(`SELECT * FROM plaid_items WHERE client_id = $1`, [client])).rows;
      assert.equal(items.length, 0, "an unconfigured deploy created a bank link row");
    });

    test("the refusal names variables and never quotes a value", async () => {
      process.env.PLAID_CLIENT_ID = "a-real-looking-client-id";
      try {
        const r = await call({ action: "link", client_id: client, public_token: "public-x" }, staff.admin.token);
        assert.equal(r.code, 503);
        assert.ok(!JSON.stringify(r.body).includes("a-real-looking-client-id"), "a config value was echoed to the caller");
      } finally {
        delete process.env.PLAID_CLIENT_ID;
      }
    });

    test("the ATTEMPT is still audited — somebody asked to read this client's bank", async () => {
      await reset();
      await call({ action: "link", client_id: client, public_token: "public-sandbox-abc" }, staff.funding_advisor.token);

      const rows = await syncHistory(db, { clientId: client });
      assert.equal(rows.length, 1, "a refused link attempt wrote no audit row");
      assert.equal(rows[0].action, "exchange");
      assert.equal(rows[0].outcome, "error");
      assert.equal(rows[0].error_code, "NOT_CONFIGURED");
      assert.equal(rows[0].triggered_by, staff.funding_advisor.id, "the attempt was not attributed to the caller");
    });

    test("the GET reports configured:false so a screen can say so instead of showing a broken button", async () => {
      const r = await call(null, staff.admin.token, "GET", { client_id: client });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.configured, false);
    });
  });

  // ── the gate ──────────────────────────────────────────────────────────────

  describe("who may read a client's bank accounts", () => {
    test("no token is 401", async () => {
      const r = await call(null, null, "GET", { client_id: client });
      assert.equal(r.code, 401, JSON.stringify(r.body));
    });

    for (const role of ["owner", "admin", "funding_advisor"]) {
      test(`${role} may read`, async () => {
        const r = await call(null, staff[role].token, "GET", { client_id: client });
        assert.equal(r.code, 200, JSON.stringify(r.body));
      });
    }

    for (const role of ["closer", "setter"]) {
      test(`${role} may NOT read — bank balances are not operational data`, async () => {
        const r = await call(null, staff[role].token, "GET", { client_id: client });
        assert.equal(r.code, 403, JSON.stringify(r.body));
      });

      test(`${role} may not link either`, async () => {
        const r = await call({ action: "link", client_id: client, public_token: "public-x" }, staff[role].token);
        assert.equal(r.code, 403, JSON.stringify(r.body));
      });
    }

    test("a client in ANOTHER org is a 404, not another org's bank data", async () => {
      const r = await call(null, staff.owner.token, "GET", { client_id: otherClient });
      assert.equal(r.code, 404, JSON.stringify(r.body));
    });

    test("linking against another org's client is refused", async () => {
      const r = await call({ action: "link", client_id: otherClient, public_token: "public-x" }, staff.owner.token);
      assert.equal(r.code, 404, JSON.stringify(r.body));
      assert.equal(
        (await db.query(`SELECT count(*)::int n FROM plaid_items WHERE client_id = $1`, [otherClient])).rows[0].n,
        0
      );
    });

    test("a malformed uuid is a 400, not a 500", async () => {
      assert.equal((await call(null, staff.admin.token, "GET", { client_id: "not-a-uuid" })).code, 400);
      assert.equal((await call({ action: "sync", item_id: "nope" }, staff.admin.token)).code, 400);
      assert.equal((await call({ action: "classify", account_id: "nope", entity_kind: "personal" }, staff.admin.token)).code, 400);
    });

    test("an unknown action is a 400 with the allowed list", async () => {
      const r = await call({ action: "delete_everything", client_id: client }, staff.admin.token);
      assert.equal(r.code, 400);
      assert.match(r.body.error, /link, sync, classify/);
    });

    test("an unsupported method is a 405 with an allow header", async () => {
      const r = await call(null, staff.admin.token, "DELETE");
      assert.equal(r.code, 405);
      assert.equal(r.headers.allow, "GET, POST");
    });
  });

  // ── the store, with Plaid stubbed at the module boundary ──────────────────

  describe("linking stores ciphertext and nothing else", () => {
    test("the access token is encrypted at rest, and the plaintext is nowhere in the row", async () => {
      await reset();
      const fetchImpl = stubPlaid({ accounts: [ACCOUNT()], item: { item_id: "item-pgtest", institution_id: "ins_3" } });
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-sandbox-abc",
        institutionName: "Chase", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY }, fetchImpl
      });

      const row = (await db.query(`SELECT * FROM plaid_items WHERE client_id = $1`, [client])).rows[0];
      assert.ok(row, "no item row was written");
      assert.ok(row.access_token_enc, "no ciphertext was stored");
      assert.ok(!row.access_token_enc.includes(ACCESS_TOKEN), "THE PLAINTEXT TOKEN IS IN THE COLUMN");
      // Every text column, not just the obvious one: a token that leaked into
      // last_error_message would be just as bad and much harder to notice.
      assert.ok(!JSON.stringify(row).includes(ACCESS_TOKEN), "the plaintext token is somewhere in the item row");

      // And it is the real token, bound to this client.
      assert.equal(decryptAccessToken(row.access_token_enc, { clientId: client, env: { BANK_TOKEN_ENC_KEY: BANK_KEY } }), ACCESS_TOKEN);
      assert.throws(
        () => decryptAccessToken(row.access_token_enc, { clientId: otherClient, env: { BANK_TOKEN_ENC_KEY: BANK_KEY } }),
        "the ciphertext decrypted for the wrong client — the AAD binding is not applied"
      );
    });

    test("no read path projects the ciphertext", async () => {
      const items = await listItems(db, { clientId: client });
      assert.equal(items.length, 1);
      assert.equal(items[0].access_token_enc, undefined, "listItems returned the ciphertext");
      assert.equal(items[0].has_access_token, true, "the safe derived form is missing");

      // And through the endpoint, which is where it would actually reach a browser.
      const r = await call(null, staff.admin.token, "GET", { client_id: client });
      assert.equal(r.code, 200);
      const serialized = JSON.stringify(r.body);
      assert.ok(!serialized.includes(ACCESS_TOKEN), "the endpoint returned the access token");
      assert.ok(!serialized.includes("access_token_enc"), "the endpoint returned the ciphertext column");
    });

    test("the public token is not stored anywhere — it is single-use and worthless after", async () => {
      const row = (await db.query(`SELECT * FROM plaid_items WHERE client_id = $1`, [client])).rows[0];
      assert.ok(!JSON.stringify(row).includes("public-sandbox-abc"));
    });

    test("both the exchange and the balance pull are audited, in order, attributed to the caller", async () => {
      const rows = (await syncHistory(db, { clientId: client })).reverse();   // oldest first
      assert.deepEqual(rows.map((r) => r.action), ["exchange", "accounts_sync"]);
      for (const r of rows) {
        assert.equal(r.outcome, "ok");
        assert.equal(r.triggered_by, staff.admin.id);
        assert.equal(r.triggered_by_kind, "staff");
        assert.ok(!JSON.stringify(r).includes(ACCESS_TOKEN), "the audit trail contains the access token");
      }
      assert.equal(rows[1].account_count, 1);
      // What came back — shape, never figures. An audit trail is not a second
      // copy of the client's finances.
      const summary = rows[1].summary;
      assert.equal(summary.accounts[0].mask, "4021");
      assert.ok(!JSON.stringify(summary).includes("4210"), "a balance figure is in the audit summary");
    });
  });

  describe("balances land as integer cents, and unknown survives", () => {
    test("dollars became cents in the column", async () => {
      const [acc] = await listAccounts(db, { clientId: client });
      assert.equal(String(acc.current_balance_cents), "421055");
      assert.equal(String(acc.available_balance_cents), "399010");
      assert.equal(acc.mask, "4021");
      assert.equal(acc.official_name, "Chase Total Checking");
      assert.equal(acc.iso_currency_code, "USD");
    });

    test("a null available balance is stored as NULL, never as 0", async () => {
      await reset();
      const fetchImpl = stubPlaid({
        accounts: [ACCOUNT({ balances: { current: 100, available: null, iso_currency_code: "USD" } })]
      });
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-x", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY }, fetchImpl
      });

      const row = (await db.query(
        `SELECT available_balance_cents FROM bank_accounts WHERE client_id = $1`, [client]
      )).rows[0];
      assert.equal(row.available_balance_cents, null,
        "an unknown balance became a number — this decides whether somebody gets funded");
    });

    test("a currency Plaid did not send is NULL, not 'USD'", async () => {
      const row = (await db.query(`SELECT unofficial_currency_code FROM bank_accounts WHERE client_id = $1`, [client])).rows[0];
      assert.equal(row.unofficial_currency_code, null);
    });
  });

  describe("classification", () => {
    let accountId;

    test("a freshly synced account is 'unknown' and unclassified — never a guess", async () => {
      await reset();
      const fetchImpl = stubPlaid({
        accounts: [ACCOUNT({ name: "Business Complete Checking", official_name: "Chase Business Complete Banking" })]
      });
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-x", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY }, fetchImpl
      });

      const [acc] = await listAccounts(db, { clientId: client });
      accountId = acc.id;
      // The account is named "Business Complete Checking" and Plaid still did not
      // say whose money it is. Nothing in the sync path is allowed to read that
      // name and decide.
      assert.equal(acc.entity_kind, "unknown");
      assert.equal(acc.entity_kind_source, "unclassified");
      assert.equal(acc.entity_kind_set_by, null);
      assert.equal(acc.business_id, null);
    });

    test("a named human classifies it, and the row records who and when", async () => {
      const r = await call(
        { action: "classify", account_id: accountId, entity_kind: "business", business_id: business },
        staff.funding_advisor.token
      );
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const row = (await db.query(`SELECT * FROM bank_accounts WHERE id = $1`, [accountId])).rows[0];
      assert.equal(row.entity_kind, "business");
      assert.equal(row.business_id, business);
      assert.equal(row.entity_kind_source, "staff");
      assert.equal(row.entity_kind_set_by, staff.funding_advisor.id, "attribution came from somewhere other than the session");
      assert.ok(row.entity_kind_set_at);
    });

    test("A RE-SYNC DOES NOT ERASE IT", async () => {
      // The regression this exists to catch: somebody adds entity_kind to the
      // upsert's SET list while making it "complete", and every balance refresh
      // silently resets every classification in the platform back to unknown.
      const item = (await db.query(`SELECT id FROM plaid_items WHERE client_id = $1`, [client])).rows[0];
      const fetchImpl = stubPlaid({ accounts: [ACCOUNT({ balances: { current: 9999.99, available: null, iso_currency_code: "USD" } })] });
      await syncItem(db, {
        itemRowId: item.id, triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY }, fetchImpl
      });

      const row = (await db.query(`SELECT * FROM bank_accounts WHERE id = $1`, [accountId])).rows[0];
      assert.equal(row.entity_kind, "business", "a balance refresh reset a human's classification");
      assert.equal(row.business_id, business);
      assert.equal(row.entity_kind_set_by, staff.funding_advisor.id);
      assert.equal(String(row.current_balance_cents), "999999", "the balance did not refresh");
    });

    test("demoting to personal clears the business rather than leaving a dangling one", async () => {
      const r = await call({ action: "classify", account_id: accountId, entity_kind: "personal" }, staff.admin.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = (await db.query(`SELECT * FROM bank_accounts WHERE id = $1`, [accountId])).rows[0];
      assert.equal(row.entity_kind, "personal");
      assert.equal(row.business_id, null);
    });

    test("'unknown' can be chosen deliberately, and stays attributed", async () => {
      const r = await call({ action: "classify", account_id: accountId, entity_kind: "unknown" }, staff.admin.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = (await db.query(`SELECT * FROM bank_accounts WHERE id = $1`, [accountId])).rows[0];
      // "Somebody looked and could not tell" is a different fact from "nobody
      // has looked", and the row is able to say which.
      assert.equal(row.entity_kind, "unknown");
      assert.equal(row.entity_kind_source, "staff");
      assert.equal(row.entity_kind_set_by, staff.admin.id);
    });

    test("an invented kind is refused by the endpoint", async () => {
      const r = await call({ action: "classify", account_id: accountId, entity_kind: "corporate" }, staff.admin.token);
      assert.equal(r.code, 400, JSON.stringify(r.body));
    });

    test("the DATABASE refuses an invented kind too, not just the endpoint", async () => {
      // A rule enforced only in the API is a rule a psql session walks past.
      await assert.rejects(
        () => db.query(`UPDATE bank_accounts SET entity_kind = 'corporate' WHERE id = $1`, [accountId]),
        /bank_accounts_entity_kind_chk/
      );
    });

    test("the database refuses a business named on a personal account", async () => {
      await db.query(
        `UPDATE bank_accounts SET entity_kind='personal', business_id=NULL,
           entity_kind_source='staff', entity_kind_set_by=$2, entity_kind_set_at=now() WHERE id = $1`,
        [accountId, staff.admin.id]
      );
      await assert.rejects(
        () => db.query(`UPDATE bank_accounts SET business_id = $2 WHERE id = $1`, [accountId, business]),
        /bank_accounts_business_requires_kind/
      );
    });

    test("the database refuses a classification with no author", async () => {
      await assert.rejects(
        () => db.query(
          `UPDATE bank_accounts SET entity_kind='business', entity_kind_source='staff',
             entity_kind_set_by=NULL, entity_kind_set_at=NULL WHERE id = $1`,
          [accountId]
        ),
        /bank_accounts_entity_kind_attribution/
      );
    });

    test("classifying an account in another org is a 404", async () => {
      const foreign = (await db.query(
        `INSERT INTO plaid_items (org_id, client_id, item_id, status)
         VALUES ($1,$2,'item-foreign','active') RETURNING id`, [otherOrg, otherClient]
      )).rows[0].id;
      const foreignAcc = (await db.query(
        `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, account_id)
         VALUES ($1,$2,$3,'acc-foreign') RETURNING id`, [otherOrg, otherClient, foreign]
      )).rows[0].id;

      const r = await call({ action: "classify", account_id: foreignAcc, entity_kind: "business" }, staff.owner.token);
      assert.equal(r.code, 404, JSON.stringify(r.body));
      const row = (await db.query(`SELECT entity_kind FROM bank_accounts WHERE id = $1`, [foreignAcc])).rows[0];
      assert.equal(row.entity_kind, "unknown", "another org's account was reclassified");
    });
  });

  describe("keys are scoped per org, never globally unique", () => {
    test("two orgs may hold the same Plaid item_id", async () => {
      await reset();
      const fetchImpl = stubPlaid({ accounts: [ACCOUNT()], item: { item_id: "item-shared" } });
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-x", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY },
        fetchImpl: stubPlaid({ accounts: [], exchange: { access_token: ACCESS_TOKEN, item_id: "item-shared" } })
      });

      // The same item id under a different org must be insertable. A global
      // UNIQUE here would let one org's link block another org's forever.
      await assert.doesNotReject(() =>
        db.query(
          `INSERT INTO plaid_items (org_id, client_id, item_id, status) VALUES ($1,$2,'item-shared','active')`,
          [otherOrg, otherClient]
        )
      );
      void fetchImpl;
    });

    test("the SAME org may not hold the same item_id twice", async () => {
      await assert.rejects(
        () => db.query(
          `INSERT INTO plaid_items (org_id, client_id, item_id, status) VALUES ($1,$2,'item-shared','active')`,
          [org, client]
        ),
        /uq_plaid_items_org_item/
      );
    });
  });

  describe("a failing sync is recorded on the item and in the trail", () => {
    test("ITEM_LOGIN_REQUIRED marks the link as needing the client, not as a retryable blip", async () => {
      await reset();
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-x", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY },
        fetchImpl: stubPlaid({ accounts: [ACCOUNT()] })
      });
      const item = (await db.query(`SELECT id FROM plaid_items WHERE client_id = $1`, [client])).rows[0];

      const failing = async (url) => {
        if (String(url).endsWith("/item/public_token/exchange")) throw new Error("not reached");
        return {
          ok: false, status: 400,
          text: async () => JSON.stringify({
            error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR",
            error_message: `re-auth needed for ${ACCESS_TOKEN}`, request_id: "req-fail"
          })
        };
      };

      await assert.rejects(() =>
        syncItem(db, {
          itemRowId: item.id, triggeredBy: staff.funding_advisor.id,
          env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY }, fetchImpl: failing
        })
      );

      const row = (await db.query(`SELECT * FROM plaid_items WHERE id = $1`, [item.id])).rows[0];
      assert.equal(row.status, "login_required", "only the client can fix this and the status has to say so");
      assert.equal(row.last_error_code, "ITEM_LOGIN_REQUIRED");
      assert.ok(!JSON.stringify(row).includes(ACCESS_TOKEN), "the access token was written into last_error_message");

      const [newest] = await syncHistory(db, { clientId: client });
      assert.equal(newest.outcome, "error");
      assert.equal(newest.error_code, "ITEM_LOGIN_REQUIRED");
      assert.equal(newest.triggered_by, staff.funding_advisor.id);
      assert.ok(!JSON.stringify(newest).includes(ACCESS_TOKEN), "the audit row carries the access token");
    });

    test("an account that stops being reported is marked closed, not deleted", async () => {
      await reset();
      await linkItem(db, {
        orgId: org, clientId: client, publicToken: "public-x", triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY },
        fetchImpl: stubPlaid({ accounts: [ACCOUNT(), ACCOUNT({ account_id: "acc-savings", mask: "9917", subtype: "savings" })] })
      });
      assert.equal((await listAccounts(db, { clientId: client })).length, 2);

      const item = (await db.query(`SELECT id FROM plaid_items WHERE client_id = $1`, [client])).rows[0];
      await syncItem(db, {
        itemRowId: item.id, triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY },
        fetchImpl: stubPlaid({ accounts: [ACCOUNT()] })
      });

      const rows = await listAccounts(db, { clientId: client });
      assert.equal(rows.length, 2, "the vanished account was deleted — its history went with it");
      const savings = rows.find((r) => r.account_id === "acc-savings");
      assert.ok(savings.closed_at, "the vanished account was not marked closed");
    });

    test("a zero-account response closes NOTHING — a blip must not empty a client's finances", async () => {
      const item = (await db.query(`SELECT id FROM plaid_items WHERE client_id = $1`, [client])).rows[0];
      await syncItem(db, {
        itemRowId: item.id, triggeredBy: staff.admin.id,
        env: { ...PLAID_ENV, BANK_TOKEN_ENC_KEY: BANK_KEY },
        fetchImpl: stubPlaid({ accounts: [] })
      });

      const open = (await listAccounts(db, { clientId: client })).filter((r) => !r.closed_at);
      assert.equal(open.length, 1, "an empty Plaid response closed the client's open accounts");

      const [newest] = await syncHistory(db, { clientId: client });
      assert.equal(newest.summary.zero_accounts_returned, true, "the empty response was not recorded for a human to see");
    });
  });

  // ── Plaid's refusal is not this endpoint's refusal ────────────────────────

  describe("an upstream refusal is reported as an upstream refusal", () => {
    /* The only tests in this file that run with Plaid CONFIGURED. The endpoint
       takes no fetch seam — it is the production path, and giving it one would
       be an injection point that exists solely for tests — so the stub goes on
       globalThis.fetch for the duration of the call and comes straight back off.
       Still no live call: the stub answers every request. */
    const withPlaid = async (respond, fn) => {
      const realFetch = globalThis.fetch;
      Object.assign(process.env, PLAID_ENV);
      globalThis.fetch = respond;
      try {
        return await fn();
      } finally {
        globalThis.fetch = realFetch;
        for (const k of Object.keys(PLAID_ENV)) delete process.env[k];
      }
    };

    const plaidSays = (status, body) => async () => ({ ok: false, status, text: async () => JSON.stringify(body) });

    test("Plaid answering 401 does NOT log the caller out — it is a 502", async () => {
      await reset();
      const r = await withPlaid(
        plaidSays(401, { error_code: "INVALID_API_KEYS", error_type: "INVALID_INPUT", error_message: `bad key ${PLAID_ENV.PLAID_SECRET}`, request_id: "req-401" }),
        () => call({ action: "link", client_id: client, public_token: "public-x" }, staff.admin.token)
      );

      /* Mirroring Plaid's 401 back would tell a signed-in employee they are
         signed out, and send them to re-authenticate a session that is fine. */
      assert.equal(r.code, 502, `Plaid's status was mirrored to the caller: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "plaid_error");
      assert.equal(r.body.plaid_error_code, "INVALID_API_KEYS");
      assert.ok(!JSON.stringify(r.body).includes(PLAID_ENV.PLAID_SECRET), "PLAID_SECRET was echoed to the caller");
    });

    test("Plaid answering 400 is a 502 carrying Plaid's own code, not a 400 blaming the caller", async () => {
      await reset();
      const r = await withPlaid(
        plaidSays(400, { error_code: "INVALID_PUBLIC_TOKEN", error_type: "INVALID_INPUT", error_message: "that token is used", request_id: "req-400" }),
        () => call({ action: "link", client_id: client, public_token: "public-x" }, staff.admin.token)
      );
      assert.equal(r.code, 502, JSON.stringify(r.body));
      assert.equal(r.body.plaid_error_code, "INVALID_PUBLIC_TOKEN");
      assert.equal(r.body.retryable, false);
    });

    test("Plaid answering 500 is reported as retryable", async () => {
      await reset();
      const r = await withPlaid(
        plaidSays(500, { error_code: "INTERNAL_SERVER_ERROR", error_message: "sorry" }),
        () => call({ action: "link", client_id: client, public_token: "public-x" }, staff.admin.token)
      );
      assert.equal(r.code, 502, JSON.stringify(r.body));
      assert.equal(r.body.retryable, true);
    });

    test("a refused exchange leaves no item row and writes one audited attempt", async () => {
      await reset();
      await withPlaid(
        plaidSays(400, { error_code: "INVALID_PUBLIC_TOKEN", error_message: "no", request_id: "req-x" }),
        () => call({ action: "link", client_id: client, public_token: "public-x" }, staff.funding_advisor.token)
      );

      assert.equal(
        (await db.query(`SELECT count(*)::int n FROM plaid_items WHERE client_id = $1`, [client])).rows[0].n, 0,
        "a refused exchange left a half-built bank link"
      );
      const rows = await syncHistory(db, { clientId: client });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].outcome, "error");
      assert.equal(rows[0].error_code, "INVALID_PUBLIC_TOKEN");
      assert.equal(rows[0].request_id, "req-x", "Plaid's request_id is the only handle their support can act on");
      assert.equal(rows[0].triggered_by, staff.funding_advisor.id);
    });

    test("a configured deploy reports configured:true on the read", async () => {
      const r = await withPlaid(
        async () => { throw new Error("the GET must not call Plaid"); },
        () => call(null, staff.admin.token, "GET", { client_id: client })
      );
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.configured, true);
    });
  });
});
