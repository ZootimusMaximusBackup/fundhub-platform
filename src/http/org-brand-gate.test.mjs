// /api/org-brand — role gates for the CRM brand lane.
//
// GET is open to any signed-in app principal (shell applies tokens at boot).
// PUT is owner/admin staff only. A closer must not recolor the company CRM; a
// partner must not rewrite the org row through this endpoint (they use
// partner-brand).

import { test, describe, mock } from "node:test";
import assert from "node:assert";

const { default: handler } = await import("../../api/org-brand.mjs");
const dbModule = await import("../db.mjs");

const ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STAFF = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SESSION_SQL = /FROM live JOIN staff/i;
const ACCOUNT_SQL = /account_sessions|FROM accounts/i;

const sessionRow = (role) => ({
  rows: [{
    session_id: "s1", expires_at: "2099-01-01T00:00:00Z",
    staff_id: STAFF, org_id: ORG, role,
    email: "someone@example.com", name: "Someone", status: "active", active_flag: null
  }]
});

const BRAND_ROW = {
  org_id: ORG, slug: "fundhub", entity_name: "Fundhub",
  wordmark_url: null, ink: "#0A0A0A", paper: "#FCFCFC",
  ramp: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"],
  display_face: "Inter", mono_face: "JetBrains Mono"
};

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

function stub(role, rows = []) {
  return mock.method(dbModule.db, "query", async (sql, params) => {
    if (SESSION_SQL.test(sql)) return sessionRow(role);
    if (ACCOUNT_SQL.test(sql)) return { rows: [] };
    for (const [re, out] of rows) if (re.test(sql)) return typeof out === "function" ? out(params) : out;
    throw new Error("unexpected sql: " + sql);
  });
}

describe("/api/org-brand — CRM brand lane", () => {

  test("a closer can READ the org brand (shell needs it)", async () => {
    const q = stub("closer", [[/v_org_brand_effective/i, { rows: [BRAND_ROW] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET" }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.brand.ink, "#0A0A0A");
    } finally { q.mock.restore(); }
  });

  test("*** a closer cannot WRITE the org brand ***", async () => {
    const q = stub("closer", [[/v_org_brand_effective/i, { rows: [BRAND_ROW] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "PUT", body: { ink: "#112233" } }), res);
      assert.equal(res.statusCode, 403);
      assert.notEqual(res.body && res.body.ok, true);
    } finally { q.mock.restore(); }
  });

  test("owner can WRITE and gets the effective brand back", async () => {
    const q = stub("owner", [
      [/INSERT INTO org_brand/i, { rows: [{ org_id: ORG }] }],
      [/v_org_brand_effective/i, { rows: [{ ...BRAND_ROW, ink: "#112233" }] }]
    ]);
    try {
      const res = mockRes();
      await handler(signedReq({
        method: "PUT",
        body: { ink: "#112233", paper: "#FFFFFF", ramp: [], display_face: "Inter", mono_face: "JetBrains Mono" }
      }), res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.brand.ink, "#112233");
    } finally { q.mock.restore(); }
  });

  test("PUT rejects a non-hex ink", async () => {
    const q = stub("owner", []);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "PUT", body: { ink: "red" } }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "invalid");
    } finally { q.mock.restore(); }
  });

  test("PUT rejects a javascript: wordmark", async () => {
    const q = stub("owner", []);
    try {
      const res = mockRes();
      await handler(signedReq({
        method: "PUT",
        body: { wordmark_url: "javascript:alert(1)" }
      }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "invalid");
    } finally { q.mock.restore(); }
  });

  test("unauthenticated GET is 401", async () => {
    const q = stub("owner", []);
    try {
      const res = mockRes();
      await handler({ method: "GET", headers: {}, query: {}, body: {} }, res);
      assert.equal(res.statusCode, 401);
    } finally { q.mock.restore(); }
  });
});
