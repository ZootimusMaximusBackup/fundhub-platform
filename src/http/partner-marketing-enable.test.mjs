import { test, describe, mock } from "node:test";
import assert from "node:assert";

const { default: handler } = await import("../../api/partner-marketing/enable.mjs");
const dbModule = await import("../db.mjs");

const PARTNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_SQL = /FROM live JOIN staff/i;
const ACCOUNT_SQL = /account_sessions|FROM accounts/i;

const sessionRow = (role) => ({
  rows: [{
    session_id: "s1", expires_at: "2099-01-01T00:00:00Z",
    staff_id: STAFF, org_id: ORG, role,
    email: "someone@example.com", name: "Someone", status: "active", active_flag: null
  }]
});

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const signedReq = (over = {}) => ({
  headers: { authorization: "Bearer test-session-token" },
  query: {}, body: {}, ...over
});

function stubSession(role) {
  return mock.method(dbModule.db, "query", async (sql) => {
    if (SESSION_SQL.test(sql)) return sessionRow(role);
    if (ACCOUNT_SQL.test(sql)) return { rows: [] };
    throw new Error("unexpected sql: " + sql);
  });
}

describe("/api/partner-marketing/enable", () => {
  test("a closer cannot read the switch", async () => {
    const q = stubSession("closer");
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { partner_id: PARTNER } }), res);
      assert.equal(res.statusCode, 403);
    } finally { q.mock.restore(); }
  });

  test("an admin cannot turn it on — owner only", async () => {
    const q = stubSession("admin");
    try {
      const res = mockRes();
      await handler(signedReq({
        method: "POST",
        query: { partner_id: PARTNER },
        body: { partner_id: PARTNER, enabled: true }
      }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, "forbidden");
    } finally { q.mock.restore(); }
  });
});
