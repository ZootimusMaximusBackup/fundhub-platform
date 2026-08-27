/* /api/slo-connections — owner SLO map write half. */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "../db.mjs";
import handler from "../../api/slo-connections.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const PROD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const realQuery = db.query;

function stubDb({ session = null, answers = [] } = {}) {
  db.query = async (text, params) => {
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG_A),
        role: pick("role", "owner"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

afterEach(() => { db.query = realQuery; });

describe("/api/slo-connections", () => {
  test("refuses non-POST", async () => {
    stubDb({ session: { role: "owner" } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" }, body: {} }, r);
    assert.equal(r.statusCode, 405);
  });

  test("sales manager cannot write the map", async () => {
    stubDb({ session: { role: "sales_manager", orgId: ORG_A } });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { name: "SLO", cf_funnel_id: "f1", cf_product_id: "p1", product_code: "funding" }
    }, r);
    assert.equal(r.statusCode, 403);
  });

  test("owner can save a map", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM products/i, { rows: [{ id: PROD, code: "funding", name: "Funding Bundle" }] }],
        [/INSERT INTO slo_connections/i, (params) => ({
          rows: [{
            id: CONN, name: params[1], cf_funnel_id: params[2], cf_product_id: params[3],
            product_id: params[4], active: params[5], created_at: "2026-08-26T00:00:00Z"
          }]
        })]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        name: "Course SLO",
        cf_funnel_id: "funnel-slo-1",
        cf_product_id: "cf-prod-slo-1",
        product_code: "funding"
      }
    }, r);
    assert.equal(r.statusCode, 201);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.connection.cf_funnel_id, "funnel-slo-1");
    assert.equal(r.body.connection.product_code, "funding");
    assert.equal(r.body.connection.active, true);
  });
});
