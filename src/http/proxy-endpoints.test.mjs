// Role + shape gates for Oxylabs Apply proxy endpoints (no DB, no network).

import { test } from "node:test";
import assert from "node:assert/strict";
import launch from "../../api/proxy/launch.mjs";
import end from "../../api/proxy/end.mjs";
import readSessions from "../../api/read/proxy-sessions.mjs";
import { PROXY_ROLES } from "../../api/proxy/launch.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function staff(role, id = "11111111-1111-4111-8111-111111111111") {
  return {
    id,
    org_id: "22222222-2222-4222-8222-222222222222",
    role,
    email: role + "@test.example",
    status: "active"
  };
}

test("PROXY_ROLES is owner + funding_advisor only", () => {
  assert.deepEqual([...PROXY_ROLES].sort(), ["funding_advisor", "owner"]);
});

test("proxy/launch refuses closer (not in PROXY_ROLES)", async () => {
  const res = mockRes();
  await launch(
    { method: "POST", body: { client_id: "aaaaaaaa-1111-4111-8111-111111111111", lender_id: "bbbbbbbb-1111-4111-8111-111111111111" } },
    res,
    { requireAuth: async () => staff("closer"), db: { query: async () => ({ rows: [] }) } }
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test("proxy/launch refuses missing client_id", async () => {
  const res = mockRes();
  await launch(
    { method: "POST", body: {} },
    res,
    { requireAuth: async () => staff("owner"), db: { query: async () => ({ rows: [] }) } }
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /client_id/);
});

test("proxy/launch returns credentials_missing when env unset", async () => {
  const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
  const LENDER = "bbbbbbbb-1111-4111-8111-111111111111";
  const ORG = "22222222-2222-4222-8222-222222222222";
  const SESSION = "dddddddd-1111-4111-8111-111111111111";
  const inserted = [];
  const updated = [];
  const res = mockRes();
  await launch(
    { method: "POST", body: { client_id: CLIENT, lender_id: LENDER } },
    res,
    {
      requireAuth: async () => staff("funding_advisor"),
      env: {},
      db: {
        query: async (sql, params) => {
          if (/FROM clients/.test(sql)) {
            return { rows: [{ id: CLIENT, org_id: ORG, custom_fields: { city: "Mesa", state: "AZ" } }] };
          }
          if (/FROM lenders/.test(sql)) {
            return { rows: [{ id: LENDER, org_id: ORG, name: "Bank", application_url: "https://bank.test/a" }] };
          }
          // A refused launch must still write, then fail, an audit row.
          if (/INSERT INTO proxy_sessions/.test(sql)) {
            inserted.push(params[14]);
            return { rows: [{ id: SESSION, org_id: ORG, status: params[14] }] };
          }
          if (/UPDATE proxy_sessions SET/.test(sql)) {
            updated.push({ status: params[7], errorCode: params[8] });
            return { rows: [{ id: SESSION, org_id: ORG, status: params[7] }] };
          }
          return { rows: [] };
        }
      }
    }
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "oxylabs_credentials_missing");
  assert.deepEqual(inserted, ["verifying"]);
  assert.deepEqual(updated, [{ status: "failed", errorCode: "oxylabs_credentials_missing" }]);
  assert.equal(res.body.session_id, SESSION);
  assert.equal(res.body.routing_active, false);
  assert.equal(res.body.next_step, "The proxy account is not set up yet. Ask the owner to add the proxy login before applying.");
});

test("proxy/end refuses setter", async () => {
  const res = mockRes();
  await end(
    { method: "POST", body: { session_id: "cccccccc-1111-4111-8111-111111111111" } },
    res,
    { requireAuth: async () => staff("setter"), db: { query: async () => ({ rows: [] }) } }
  );
  assert.equal(res.statusCode, 403);
});

test("read/proxy-sessions refuses closer", async () => {
  const res = mockRes();
  await readSessions(
    { method: "GET", query: {} },
    res,
    { requireAuth: async () => staff("closer"), db: { query: async () => ({ rows: [] }) } }
  );
  assert.equal(res.statusCode, 403);
});

test("proxy/launch success shape never sets routing_active true", async () => {
  const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
  const LENDER = "bbbbbbbb-1111-4111-8111-111111111111";
  const ORG = "22222222-2222-4222-8222-222222222222";
  const STAFF = "11111111-1111-4111-8111-111111111111";
  let inserted = null;
  const res = mockRes();
  await launch(
    { method: "POST", body: { client_id: CLIENT, lender_id: LENDER } },
    res,
    {
      requireAuth: async () => staff("owner", STAFF),
      env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
      fetchFn: async () => ({
        status: 200,
        body: "{}",
        json: { ip: "203.0.113.50", city: "Mesa", region: "Arizona", country: "US" }
      }),
      db: {
        query: async (sql, params) => {
          if (/FROM clients/.test(sql)) {
            return { rows: [{ id: CLIENT, org_id: ORG, custom_fields: { business_city: "Mesa", business_state: "AZ" } }] };
          }
          if (/FROM lenders/.test(sql)) {
            return { rows: [{ id: LENDER, org_id: ORG, name: "Bank", product_name: "CC", application_url: "https://bank.test/a" }] };
          }
          if (/INSERT INTO proxy_sessions/.test(sql)) {
            inserted = { id: "dddddddd-1111-4111-8111-111111111111", status: "verifying", client_id: params[1] };
            return { rows: [inserted] };
          }
          if (/UPDATE proxy_sessions SET/.test(sql)) {
            return {
              rows: [{
                id: inserted.id,
                status: "active",
                client_id: CLIENT,
                lender_id: LENDER,
                application_id: null,
                started_at: new Date().toISOString()
              }]
            };
          }
          return { rows: [] };
        }
      }
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.routing_active, false);
  assert.equal(res.body.extension_required, true);
  assert.equal(res.body.verification.exit_ip, "203.0.113.50");
  assert.equal(res.body.verification.city, "Mesa");
  assert.equal(res.body.connection.host, "pr.oxylabs.io");
  assert.match(res.body.connection.username, /city-mesa/);
});
