/* The two Finance OS read endpoints, driven end to end (audit M15).
 *
 * WHAT WAS MISSING. api/read/finance-os.mjs and api/read/banking-surface.mjs
 * were both routed and live (netlify/functions/api.mjs) with nothing under src/
 * or scripts/ exercising them. The only things that touched them were two
 * browser smoke scripts that need a hand-typed client uuid and a running server,
 * so they run on nobody's pass. Untested: the 405, the malformed-id 400, the
 * role gate, the Postgres error mapping, and — the one that matters —
 * WHICH ROWS THE QUERY IS ALLOWED TO REACH.
 *
 * WHY IT RUNS WITHOUT A DATABASE. package.json's test glob only walks src/ and
 * scripts/ (CLAUDE.md, traps), and a `.pg.test.mjs` skips whenever DATABASE_URL
 * is unset, which is most passes. src/db.mjs exports `db` as a plain object with
 * one `query` method, so the session lookup and the endpoint's own read are both
 * stubbed here and the handlers run exactly as they do in production. Same
 * approach as src/tradelines/store.tenancy.test.mjs, and for the same reason:
 * the tenancy bug it guards is INVISIBLE on a one-org database, and every
 * database this repo has is a one-org database.
 *
 * THE DEFECT THIS FILE FOUND. api/read/banking-surface.mjs read
 * `FROM bank_accounts WHERE client_id = $1` and nothing else. `bank_accounts`
 * has `org_id uuid NOT NULL` (db/migrations/081), the session knows the caller's
 * org, and the read never compared them — the identical hole that was found and
 * fixed on the tradeline path. So an owner of org A who knew a client id
 * belonging to org B got that consumer's bank balances. finance-os was already
 * scoped, because it reads through listTradelines, which refuses to run without
 * an org id; the endpoint next door had its own SQL and no such guard.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import financeOs from "../../api/read/finance-os.mjs";
import bankingSurface from "../../api/read/banking-surface.mjs";
import { ROLE_SETS } from "./read-api.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A; ORG_B is the tenant whose
   client id is being handed in. On a single-org database these are the same
   value and the bug is unobservable, which is exactly why it survived. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_ORG_CLIENT = "22222222-2222-4222-8222-222222222222";

/* Plaid fully and correctly configured — the state that makes the existing
   isPlaidEnabled() gate open. The key is 32 bytes of base64 so it is well
   formed; it is a test constant and unlocks nothing. */
const PLAID_ENV = {
  PLAID_CLIENT_ID: "test-client-id",
  PLAID_SECRET: "test-secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox"
};
const PLAID_KEYS = Object.keys(PLAID_ENV);

let savedEnv = {};
let savedQuery = null;

function setPlaid(on) {
  for (const k of PLAID_KEYS) {
    if (on) process.env[k] = PLAID_ENV[k];
    else delete process.env[k];
  }
}

beforeEach(() => {
  savedEnv = {};
  for (const k of PLAID_KEYS) savedEnv[k] = process.env[k];
  savedQuery = db.query;
});

afterEach(() => {
  for (const k of PLAID_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  db.query = savedQuery;
});

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/**
 * call(handler, opts) — run a real handler against a stubbed database.
 *
 * db.query sees two shapes: verifySession()'s CTE, and the endpoint's own read.
 * `table` is the regex that recognises the second one. `readError` makes that
 * read throw, which is how the Postgres error mapping is exercised. Returns the
 * status, the body, the response headers, and every read that was issued — the
 * SQL text and its bound parameters, which is where tenancy is proved.
 */
async function call(handler, {
  table,
  role = "owner",
  orgId = ORG_A,
  method = "GET",
  query = { client_id: CID },
  rows = [],
  readError = null,
  authenticated = true
} = {}) {
  const reads = [];
  db.query = async (sql, params) => {
    if (table.test(sql)) {
      reads.push({ sql, params });
      if (readError) throw readError;
      return { rows };
    }
    // verifySession's CTE. One live session for a staff member with this role.
    if (!authenticated) return { rows: [] };
    return {
      rows: [{
        session_id: "sess-1",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        staff_id: "staff-1",
        org_id: orgId,
        role,
        email: `${role}@fundhub.ai`,
        name: role,
        status: "active",
        active_flag: "true"
      }]
    };
  };

  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query };
  const thrown = await handler(req, res).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, reads, thrown };
}

const TRADELINES = /FROM\s+tradelines/i;
const BANK = /FROM\s+bank_accounts/i;

/* ── GET /api/read/finance-os ─────────────────────────────────────────────── */

describe("GET /api/read/finance-os", () => {

  test("a POST is refused with 405 and an allow header, before any database work", async () => {
    const r = await call(financeOs, { table: TRADELINES, method: "POST" });
    assert.equal(r.status, 405);
    assert.equal(r.body.error, "method_not_allowed");
    assert.equal(r.headers.allow, "GET");
    assert.deepEqual(r.reads, [], "a rejected method still hit the database");
  });

  test("no session is a 401 and reads nothing", async () => {
    const r = await call(financeOs, { table: TRADELINES, authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(r.reads, []);
  });

  for (const role of [...ROLE_SETS.STAFF]) {
    test(`a ${role} gets the grid`, async () => {
      const r = await call(financeOs, { table: TRADELINES, role });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.STAFF and was refused`);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.source, "tradelines",
        "the response must name its source, so the screen can print what it is looking at");
    });
  }

  for (const role of ["partner", "client", "", null]) {
    test(`a session whose role is ${JSON.stringify(role)} is refused and reads nothing`, async () => {
      const r = await call(financeOs, { table: TRADELINES, role });
      assert.equal(r.status, 403,
        "the gate is deny-by-default: a role outside ROLE_SETS.STAFF gets nothing");
      assert.deepEqual(r.reads, [], "refused, and the tradelines were read anyway");
    });
  }

  test("a missing client_id is a 400, not a firehose of everybody's balances", async () => {
    const r = await call(financeOs, { table: TRADELINES, query: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, []);
  });

  test("a malformed client_id is a 400 before the query, not a 500 after it", async () => {
    const r = await call(financeOs, { table: TRADELINES, query: { client_id: "not-a-uuid" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, [], "a bad uuid must not reach Postgres");
  });

  test("the read is scoped to the CALLER's org, never to anything in the query string", async () => {
    const r = await call(financeOs, {
      table: TRADELINES,
      query: { client_id: OTHER_ORG_CLIENT, org_id: "33333333-3333-4333-8333-333333333333" }
    });
    assert.equal(r.status, 200);
    assert.equal(r.reads.length, 1);
    assert.ok(r.reads[0].params.includes(ORG_A),
      "the tradeline read did not carry the session's org id — a caller in one org " +
      "could read a named client's credit file in another");
    assert.ok(!r.reads[0].params.includes("33333333-3333-4333-8333-333333333333"),
      "an org id from the query string reached the database");
  });

  test("a bad parameter Postgres rejects comes back as 400, not 500", async () => {
    const e = new Error("invalid input syntax for type uuid");
    e.code = "22P02";
    const r = await call(financeOs, { table: TRADELINES, readError: e });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  test("a real database fault is not disguised as the caller's mistake", async () => {
    const e = new Error("relation \"tradelines\" does not exist");
    e.code = "42P01";
    const r = await call(financeOs, { table: TRADELINES, readError: e });
    assert.ok(r.thrown, "a server fault was swallowed and answered as a 400");
    assert.equal(r.thrown.code, "42P01");
  });
});

/* ── GET /api/read/banking-surface ────────────────────────────────────────── */

describe("GET /api/read/banking-surface", () => {

  test("a POST is refused with 405 and an allow header, before any database work", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK, method: "POST" });
    assert.equal(r.status, 405);
    assert.equal(r.body.error, "method_not_allowed");
    assert.equal(r.headers.allow, "GET");
    assert.deepEqual(r.reads, []);
  });

  test("no session is a 401 and reads nothing", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK, authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(r.reads, []);
  });

  test("a missing client_id is a 400", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK, query: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, []);
  });

  test("a malformed client_id is a 400 before the query, not a 500 after it", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK, query: { client_id: "12345" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, [], "a bad uuid must not reach Postgres");
  });

  test("a bad parameter Postgres rejects comes back as 400, not 500", async () => {
    setPlaid(true);
    const e = new Error("invalid input syntax for type uuid");
    e.code = "22P02";
    const r = await call(bankingSurface, { table: BANK, readError: e });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  test("a real database fault is not disguised as the caller's mistake", async () => {
    setPlaid(true);
    const e = new Error("connection terminated unexpectedly");
    e.code = "08006";
    const r = await call(bankingSurface, { table: BANK, readError: e });
    assert.ok(r.thrown, "a server fault was swallowed and answered as a 400");
    assert.equal(r.thrown.code, "08006");
  });

  /* THE ONE THE COMMENT PROMISED. api/read/banking-surface.mjs says in prose
     that it selects columns rather than `*`, because `encrypted_access_token`
     lives one join away on plaid_items and bank_accounts holds a mask only.
     Nothing asserted it, so the next hand that widens the list to `*` while
     debugging finds out at review time or never. */
  test("the SELECT names its columns and never reaches a credential", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK });
    assert.equal(r.status, 200);
    assert.equal(r.reads.length, 1);
    const sql = r.reads[0].sql;

    assert.doesNotMatch(sql, /SELECT\s+\*/i,
      "banking-surface went back to SELECT * — the column list is the only thing " +
      "between this endpoint and plaid_items.encrypted_access_token");
    for (const forbidden of [
      "encrypted_access_token", "access_token", "plaid_items",
      "account_number", "routing_number", "token_hash", "raw"
    ]) {
      assert.ok(!new RegExp(`\\b${forbidden}\\b`, "i").test(sql),
        `the banking surface query mentions ${forbidden}`);
    }
    // The mask is the only account-number fragment 081 stores, and the screen
    // needs it, so its presence is the control on the assertions above.
    assert.match(sql, /\bmask\b/);
  });

  test("the read is scoped to the CALLER's org, not to the client id alone", async () => {
    setPlaid(true);
    const r = await call(bankingSurface, { table: BANK, query: { client_id: OTHER_ORG_CLIENT } });
    assert.equal(r.status, 200);
    assert.equal(r.reads.length, 1);
    assert.match(r.reads[0].sql, /org_id\s*=\s*\$/i,
      "banking-surface reads bank_accounts by client_id alone. bank_accounts.org_id " +
      "is NOT NULL and the session knows the caller's org, so a staff member of one " +
      "org who knows a client id in another gets that person's bank balances");
    assert.ok(r.reads[0].params.includes(ORG_A),
      "the bank_accounts read did not carry the session's org id");
  });

  test("an org id in the query string cannot widen the read", async () => {
    setPlaid(true);
    const evil = "33333333-3333-4333-8333-333333333333";
    const r = await call(bankingSurface, {
      table: BANK,
      query: { client_id: CID, org_id: evil }
    });
    assert.equal(r.status, 200);
    assert.ok(!r.reads[0].params.includes(evil),
      "an org id from the query string reached the database");
  });
});
