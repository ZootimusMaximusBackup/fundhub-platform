import test from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/company-brain/sync.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

const ORG = "00000000-0000-4000-8000-000000000001";

test("GET /api/company-brain/sync refuses closers", async () => {
  const res = mockRes();
  await handler(
    { method: "GET" },
    res,
    { requireAuth: async () => ({ id: "s1", org_id: ORG, role: "closer" }) }
  );
  assert.equal(res.statusCode, 403);
});

test("GET /api/company-brain/sync is honest when Drive is off", async () => {
  const res = mockRes();
  await handler(
    { method: "GET" },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: ORG, role: "sales_manager" }),
      env: {},
      getSyncState: async () => null
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.drive_ready, false);
  assert.ok(res.body.missing.includes("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"));
});

test("POST /api/company-brain/sync does not look like a database outage when Drive is off", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: {} },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: ORG, role: "sales_manager" }),
      env: {}
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.synced, false);
  assert.equal(res.body.reason, "not_configured");
});

test("POST /api/company-brain/sync runs incremental when configured", async () => {
  const res = mockRes();
  let called = false;
  const env = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n"
    }),
    GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
  };
  await handler(
    { method: "POST", body: {} },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: ORG, role: "owner" }),
      env,
      syncDriveIncremental: async (_db, args) => {
        called = true;
        assert.equal(args.orgId, ORG);
        return { ok: true, mode: "incremental", upserted: 2, deleted: 0 };
      }
    }
  );
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.synced, true);
  assert.equal(res.body.upserted, 2);
});
