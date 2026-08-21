// POST /api/repair/enroll — auth, roles, body shape (no database required).
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/enroll.mjs";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";

test("repair enroll rejects non-POST", async () => {
  const res = resCapture();
  await handler({ method: "GET", body: {} }, res, {
    db: { async query() { return { rows: [] }; } },
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "closer" })
  });
  assert.equal(res.statusCode, 405);
});

test("repair enroll rejects a setter role", async () => {
  const res = resCapture();
  await handler({
    method: "POST",
    body: { client_id: CLIENT, program: "trial", price_total: 200, amount_paid: 200 }
  }, res, {
    db: { async query() { return { rows: [{ "?column?": 1 }] }; } },
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "setter" })
  });
  assert.equal(res.statusCode, 403);
});

test("repair enroll upserts and returns the program", async () => {
  const res = resCapture();
  const queries = [];
  await handler({
    method: "POST",
    body: { client_id: CLIENT, program: "trial", price_total: 200, amount_paid: 200 }
  }, res, {
    db: {
      async query(sql, params) {
        queries.push(String(sql));
        if (String(sql).includes("FROM clients")) return { rows: [{ "?column?": 1 }] };
        if (String(sql).includes("INSERT INTO repair_programs")) {
          return {
            rows: [{
              id: "p1",
              org_id: ORG,
              client_id: CLIENT,
              program: "trial",
              rounds_cap: 2,
              price_total: 200,
              amount_paid: 200,
              status: "active",
              created_at: "2026-08-21T00:00:00Z"
            }]
          };
        }
        return { rows: [] };
      }
    },
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "closer" })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.program?.program, "trial");
  assert.equal(res.body?.program?.rounds_cap, 2);
  assert.ok(queries.some((q) => q.includes("INSERT INTO repair_programs")));
});
