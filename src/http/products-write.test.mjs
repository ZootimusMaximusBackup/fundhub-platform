/* /api/products — Products & Commissions write half. */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/products.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const PROD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("/api/products", () => {
  test("refuses non-POST", async () => {
    stubDb({ session: { role: "owner" } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" }, body: {} }, r);
    assert.equal(r.statusCode, 405);
  });

  test("save updates defaults for the session org", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT \* FROM products/i, {
          rows: [{
            id: PROD, org_id: ORG_A, code: "funding_bundle", name: "Funding Bundle",
            category: "funding", default_price: 3000, min_price: 2000, max_price: 5000,
            price_is_variable: true, default_success_fee_percent: 10, active: true, sort_order: 10
          }]
        }],
        [/UPDATE products/i, (params) => ({
          rows: [{
            id: PROD, org_id: ORG_A, code: "funding_bundle", name: params[2],
            category: params[3], default_price: params[4], min_price: params[5],
            max_price: params[6], price_is_variable: params[7],
            default_success_fee_percent: 10, active: true, sort_order: 10
          }]
        })]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "save", code: "funding_bundle", name: "Funding Bundle Plus",
        category: "funding", default_price: 3500, min_price: 2500, max_price: 6000,
        price_is_variable: true
      }
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.product.name, "Funding Bundle Plus");
    assert.equal(r.body.product.default_price, 3500);
  });

  test("create inserts a product", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT 1 FROM products/i, { rows: [] }],
        [/MAX\(sort_order\)/i, { rows: [{ m: 0 }] }],
        [/INSERT INTO products/i, (params) => ({
          rows: [{
            id: PROD, org_id: ORG_A, code: params[1], name: params[2],
            category: params[3], default_price: params[4], min_price: params[5],
            max_price: params[6], price_is_variable: params[7],
            default_success_fee_percent: params[8], active: true, sort_order: params[9]
          }]
        })]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "create", name: "DIY Letters", category: "repair",
        default_price: 1000, min_price: 1000, max_price: 1000, price_is_variable: false
      }
    }, r);
    assert.equal(r.statusCode, 201);
    assert.equal(r.body.product.name, "DIY Letters");
  });

  test("closer cannot write products (FINANCE gate)", async () => {
    stubDb({ session: { role: "closer", orgId: ORG_A } });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { action: "save", code: "x", name: "Y" }
    }, r);
    assert.equal(r.statusCode, 403);
  });
});
