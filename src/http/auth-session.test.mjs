// GET /api/auth/session — had_call on client principals only.
//
// WHY THIS IS A .test.mjs AND NOT A .pg.test.mjs. The portal chat widget
// auto-opens when a client has not been on a sales call. That flag rides the
// existing session payload (not a new /api/read/* route). If this only lived
// behind DATABASE_URL, most CI passes would never prove it.
//
// HOW THE DATABASE IS STUBBED. Same pattern as src/http/consent-capture.test.mjs:
// src/db.mjs exports `{ query }`, and swapping that property runs the real
// handler, the real staff verifier, and the real account-session verifier.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../db.mjs";
import handler from "../../api/auth/session.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";
const ACCOUNT = "44444444-4444-4444-4444-444444444444";
const LOGGED_AT = "2026-08-10T15:00:00.000Z";

const realQuery = db.query;
let calls = [];

function stubDb({ staffRow = null, account = null, callRow = null, callThrows = false } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });
    if (/FROM live JOIN staff/i.test(text)) {
      return { rows: staffRow ? [staffRow] : [] };
    }
    if (/UPDATE account_sessions/i.test(text)) {
      return {
        rows: account
          ? [{ id: "asess-1", account_id: account.id, org_id: account.org_id, expires_at: new Date() }]
          : []
      };
    }
    if (/FROM accounts WHERE id/i.test(text)) {
      return { rows: account ? [account] : [] };
    }
    if (/FROM call_outcomes/i.test(text)) {
      if (callThrows) throw new Error("call_outcomes unavailable");
      return { rows: callRow ? [callRow] : [] };
    }
    return { rows: [] };
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

function mkRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
  return res;
}

const mkReq = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer tok" },
  ...over
});

function staffRow(over = {}) {
  return {
    session_id: "sess-1",
    expires_at: new Date(Date.now() + 3_600_000),
    staff_id: STAFF,
    org_id: ORG,
    role: "closer",
    email: "c@example.com",
    name: "A Closer",
    status: "active",
    active_flag: "true",
    ...over
  };
}

function clientAccount(over = {}) {
  return {
    id: ACCOUNT,
    org_id: ORG,
    kind: "client",
    email: "dana@example.com",
    name: "Dana",
    status: "active",
    client_id: CLIENT,
    affiliate_id: null,
    partner_id: null,
    ...over
  };
}

describe("GET /api/auth/session had_call", () => {
  test("staff sessions do not carry had_call", async () => {
    stubDb({ staffRow: staffRow() });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.principal, "staff");
    assert.equal("had_call" in res.body, false);
    assert.equal("had_call" in res.body.staff, false);
    assert.ok(!calls.some((c) => /call_outcomes/i.test(c.text)));
  });

  test("a client with no call_outcomes row gets had_call false", async () => {
    stubDb({ account: clientAccount() });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.principal, "client");
    assert.equal(res.body.had_call, false);
    assert.equal(res.body.had_call_at, null);
    assert.equal(res.body.staff.had_call, false);
    assert.equal(res.body.staff.had_call_at, null);
    assert.equal(res.body.staff.client_id, CLIENT);
    const callQ = calls.find((c) => /FROM call_outcomes/i.test(c.text));
    assert.ok(callQ, "session must read call_outcomes, not a new route");
    assert.deepEqual(callQ.params, [ORG, CLIENT]);
  });

  test("a client with a call_outcomes row gets had_call true", async () => {
    stubDb({ account: clientAccount(), callRow: { logged_at: LOGGED_AT } });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.had_call, true);
    assert.equal(res.body.had_call_at, LOGGED_AT);
    assert.equal(res.body.staff.had_call, true);
    assert.equal(res.body.staff.had_call_at, LOGGED_AT);
  });

  test("affiliate and partner principals do not get had_call", async () => {
    for (const kind of ["affiliate", "partner"]) {
      stubDb({
        account: clientAccount({
          kind,
          client_id: null,
          affiliate_id: kind === "affiliate" ? "aff-1" : null,
          partner_id: kind === "partner" ? "par-1" : null
        })
      });
      const res = mkRes();
      await handler(mkReq(), res);
      assert.equal(res.statusCode, 200, kind);
      assert.equal(res.body.principal, kind);
      assert.equal("had_call" in res.body, false, kind);
      assert.ok(!calls.some((c) => /call_outcomes/i.test(c.text)), kind);
    }
  });

  test("call_outcomes failure still returns the session with had_call false", async () => {
    stubDb({ account: clientAccount(), callThrows: true });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.had_call, false);
    assert.equal(res.body.staff.role, "client");
  });

  test("does not add a new ROUTES key", () => {
    const routes = fs.readFileSync(
      path.resolve(HERE, "../../netlify/functions/api.mjs"),
      "utf8"
    );
    assert.match(routes, /"auth\/session"/);
    assert.doesNotMatch(routes, /had.call/);
    assert.doesNotMatch(routes, /read\/had-call/);
  });
});
