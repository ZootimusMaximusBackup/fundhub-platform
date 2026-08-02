/* The outage answer, and the endpoints that owe it (finance-os 500 audit).
 *
 * WHAT THIS PINS. public/app/finance-os.html printed
 *
 *     "Funding capacity could not be read — HTTP 500 internal_error."
 *
 * while the production database was down. The read is /api/read/underwrite; its
 * catch ended in a bare `throw e`, netlify/functions/api.mjs turned that into
 * 500 internal_error, and public/app/data.js words a 500 as "something went
 * wrong on our side ... The database did not report a problem." Every part of
 * that sentence was wrong and it sent the reader away from the actual fault.
 *
 * Two things are asserted here, and the second is the one that stops the bug
 * coming back on a sibling endpoint:
 *
 *   1. isDbDown()/dbDown() classify the failures a POOLED connection actually
 *      dies of — including the two that carry no driver `code` at all — and
 *      refuse to claim anything else.
 *   2. EVERY endpoint in the Finance OS cluster answers 503 db:"down" when its
 *      database read dies, rather than throwing into the generic 500. Driven
 *      through the real handlers with a db stub that throws, so a new endpoint
 *      added to the cluster without the guard fails here.
 *
 * No DATABASE_URL is needed: src/db.mjs exports `db` as a plain object with one
 * `query` method, so the session lookup and the endpoint's own read are both
 * stubbed. Same approach as src/http/finance-os-endpoints.test.mjs.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import { isDbDown, dbDown } from "./db-down.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* Errors as node-postgres actually raises them. The two codeless ones are the
   whole reason this module is not just health.mjs's classify(). */
const conn = (message, code) => Object.assign(new Error(message), code ? { code } : {});

const OUTAGES = [
  ["host refused the connection", conn("connect ECONNREFUSED 10.0.3.14:5432", "ECONNREFUSED")],
  ["host does not resolve", conn("getaddrinfo ENOTFOUND db.example.internal", "ENOTFOUND")],
  ["connection reset", conn("read ECONNRESET", "ECONNRESET")],
  ["pooler reaped the backend", conn("Connection terminated unexpectedly")],
  ["pool could not hand one out", conn("timeout exceeded when trying to connect")],
  ["server is shutting down", conn("terminating connection due to administrator command", "57P01")],
  ["server not accepting yet", conn("the database system is starting up", "57P03")],
  ["connection failure sqlstate", conn("connection failure", "08006")],
  ["nothing is configured", conn("DATABASE_URL not set")]
];

/* Faults that are OURS or the caller's. Every one of these must keep the 500 it
   already had — a false "the database is down" costs an operator an hour in
   Postgres for a null dereference in this repo. */
const NOT_OUTAGES = [
  ["a null dereference", new TypeError("Cannot read properties of undefined (reading 'rows')")],
  ["a bad uuid", conn("invalid input syntax for type uuid", "22P02")],
  ["a missing column", conn('column "nope" does not exist', "42703")],
  ["a permission refusal", conn("permission denied for table crs_results", "42501")],
  ["a statement timeout", conn("canceling statement due to statement timeout", "57014")],
  ["nothing at all", null]
];

describe("isDbDown", () => {
  for (const [what, err] of OUTAGES) {
    test(`${what} is an outage`, () => {
      assert.equal(isDbDown(err), true, `${what} was not recognised as the database failing`);
    });
  }
  for (const [what, err] of NOT_OUTAGES) {
    test(`${what} is NOT an outage`, () => {
      assert.equal(isDbDown(err), false,
        `${what} was blamed on the database — that sends whoever is on call to Postgres for our bug`);
    });
  }
});

describe("dbDown", () => {
  const makeRes = () => ({
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  });

  test("writes the exact shape public/app/data.js reads as an outage", () => {
    const res = makeRes();
    assert.equal(dbDown(res, conn("Connection terminated unexpectedly")), true);
    assert.equal(res.statusCode, 503, "data.js only reads 503 (or db:'down') as an outage");
    assert.equal(res.body.ok, false);
    assert.equal(res.body.db, "down", "the db:'down' marker is the other half of the signal");
  });

  test("writes nothing, and returns false, for a fault that is ours", () => {
    const res = makeRes();
    assert.equal(dbDown(res, new TypeError("x is not a function")), false);
    assert.equal(res.statusCode, 0, "it answered a request it had not classified");
  });

  test("never lets a driver error leak the host or the DSN to a browser", () => {
    const res = makeRes();
    dbDown(res, conn("could not connect to postgres://app:hunter2@db.internal.example.com:5432/fundhub"));
    const body = JSON.stringify(res.body);
    assert.ok(!/hunter2/.test(body), "the password reached the response body");
    assert.ok(!/db\.internal\.example\.com/.test(body), "the database host reached the response body");
  });
});

/* ── the cluster ─────────────────────────────────────────────────────────── */

/* `req` overrides for the two endpoints that refuse a bare GET before they ever
   reach a database — /api/finance/model is POST-only, and banking-surface needs
   Plaid configured (below) or it answers 403 first. Neither is what this file is
   testing; both just have to get far enough to touch the database. */
const CLUSTER = [
  ["/api/read/underwrite", "../../api/read/underwrite.mjs"],
  ["/api/read/finance-os", "../../api/read/finance-os.mjs"],
  ["/api/read/banking-surface", "../../api/read/banking-surface.mjs"],
  ["/api/read/money-map", "../../api/read/money-map.mjs"],
  ["/api/read/finance-command", "../../api/read/finance-command.mjs"],
  ["/api/read/transactions", "../../api/read/transactions.mjs"],
  ["/api/finance/alerts", "../../api/finance/alerts.mjs"],
  ["/api/finance/subscriptions", "../../api/finance/subscriptions.mjs"],
  ["/api/finance/liabilities", "../../api/finance/liabilities.mjs"],
  ["/api/finance/bank-accounts", "../../api/finance/bank-accounts.mjs"],
  ["/api/finance/bills", "../../api/finance/bills.mjs"],
  ["/api/finance/cashflow", "../../api/finance/cashflow.mjs"],
  ["/api/finance/entities", "../../api/finance/entities.mjs"],
  ["/api/finance/model", "../../api/finance/model.mjs", { method: "POST" }]
];

/* Plaid fully configured — the state banking-surface's isPlaidEnabled() gate
   wants. The key is 32 well-formed bytes; it is a test constant and unlocks
   nothing. Copied in shape from src/http/finance-os-endpoints.test.mjs. */
const PLAID_ENV = {
  PLAID_CLIENT_ID: "test-client-id",
  PLAID_SECRET: "test-secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox"
};

describe("the Finance OS cluster reports an outage as an outage", () => {
  let saved = null;
  let savedEnv = {};
  beforeEach(() => {
    saved = db.query;
    savedEnv = {};
    for (const k of Object.keys(PLAID_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = PLAID_ENV[k]; }
  });
  afterEach(() => {
    db.query = saved;
    for (const k of Object.keys(PLAID_ENV)) {
      if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
  });

  /* The session lookup SUCCEEDS and everything after it fails. That is the state
     the screen was actually in: requireAuth answers 503 itself when the auth read
     fails, so a 500 can only come from a database that died AFTER the session was
     verified — a pooler reaping a live connection mid-request. */
  const failAfterAuth = (err) => {
    let first = true;
    return async () => {
      if (first) {
        first = false;
        return { rows: [{
          session_id: "sess-1",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1", org_id: ORG, role: "owner",
          email: "owner@fundhub.ai", name: "owner", status: "active", active_flag: "true"
        }] };
      }
      throw err;
    };
  };

  for (const [name, rel, over = {}] of CLUSTER) {
    test(`${name} answers 503 db:"down", not 500`, async () => {
      db.query = failAfterAuth(conn("Connection terminated unexpectedly"));
      const handler = (await import(rel)).default;

      const res = {
        statusCode: 0, body: null, headers: {},
        setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };
      const req = {
        method: "GET",
        headers: { authorization: "Bearer session-token" },
        query: { client_id: CID, limit: "50" },
        body: { client_id: CID },
        ...over
      };

      const thrown = await handler(req, res).then(() => null, (e) => e);

      assert.equal(thrown, null,
        `${name} threw instead of answering; netlify/functions/api.mjs turns that into ` +
        `500 internal_error, which the screen words as "the database did not report a problem"`);
      assert.equal(res.statusCode, 503,
        `${name} answered ${res.statusCode} for a dead database — the screen will blame our code`);
      assert.equal(res.body && res.body.db, "down",
        `${name} left off the db:"down" marker, so public/app/data.js will not classify it as an outage`);
    });
  }
});
