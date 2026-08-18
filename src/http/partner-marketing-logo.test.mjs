import { test, describe, mock } from "node:test";
import assert from "node:assert";

const { default: handler } = await import("../../api/partner-marketing/generate-logo.mjs");
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

describe("/api/partner-marketing/generate-logo", () => {
  test("creates a brand row when the partner has none", async () => {
    const q = stubSession("owner");
    let inserted = false;
    const scoped = async (_principal, fn) => fn({
      query: async (sql, params) => {
        const text = String(sql);
        if (/FROM partner_module_settings/i.test(text)) {
          return { rows: [{
            marketing_suite_enabled: true,
            ai_token_cap_monthly: 250000,
            org_id: ORG
          }] };
        }
        if (/FROM partners WHERE id/i.test(text)) return { rows: [{ org_id: ORG }] };
        if (/FROM partner_brand WHERE partner_id/i.test(text)) return { rows: [] };
        if (/INSERT INTO partner_brand/i.test(text)) {
          inserted = true;
          return { rows: [{
            org_id: ORG,
            partner_id: PARTNER,
            entity_name: params[2],
            wordmark_url: params[3]
          }] };
        }
        if (/INSERT INTO partner_ai_usage/i.test(text)) {
          return { rows: [{ id: "u1", input_tokens: 0, output_tokens: 0, created_at: "2099-01-01" }] };
        }
        throw new Error("unexpected tx sql: " + text);
      }
    });
    try {
      const res = mockRes();
      await handler(signedReq({
        method: "POST",
        body: { partner_id: PARTNER, name: "Acme Review Co" }
      }), res, { withPartnerScope: scoped });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(inserted, true);
      assert.equal(res.body.brand.entity_name, "Acme Review Co");
      assert.match(String(res.body.brand.wordmark_url || ""), /^data:image\/svg\+xml/);
    } finally {
      q.mock.restore();
    }
  });
});
