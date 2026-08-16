// /api/partner-brand — the role gate, on BOTH methods.
//
// THE HOLE THIS CLOSES. The handler was gated by requireAuth alone, which admits
// any signed-in employee of any role. The PUT had its own inner check
// (canWrite), so the file read as gated — and the GET was not. Any setter could
// pass any partner_id and read that partner's trading name, registered address,
// support email, domain and brand tokens.
//
// It was found by docs/journeys/, which reports the gate at the handler's ENTRY
// rather than per method. That is the right thing for it to report, and it is
// exactly why this went unnoticed: an inner check on one method does not gate
// the other.
//
// SO THIS TEST DRIVES BOTH METHODS. A test that only exercised PUT would have
// passed against the broken code — the inner check was always there.
//
// Lives under src/http/ because npm test's glob is "src/**" and "scripts/**"
// ONLY; a test under api/ silently never runs (CLAUDE.md §12).

import { test, describe, mock } from "node:test";
import assert from "node:assert";

const { default: handler } = await import("../../api/partner-brand.mjs");
const dbModule = await import("../db.mjs");

const PARTNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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

const signedReq = (over = {}) => ({
  headers: { authorization: "Bearer test-session-token" },
  query: {}, body: {}, ...over
});

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

/* The brand row a successful read would return. Fake values — a real partner's
   registered address is exactly what this endpoint must not hand out. */
const BRAND_ROW = {
  partner_id: PARTNER, ink: "#112233", paper: "#ffffff",
  entity_name: "Example Partner Ltd", entity_address: "1 Example Street",
  support_email: "help@example.test", domain: "example.test"
};

function stub(role, rows = []) {
  return mock.method(dbModule.db, "query", async (sql, params) => {
    if (SESSION_SQL.test(sql)) return sessionRow(role);
    for (const [re, out] of rows) if (re.test(sql)) return typeof out === "function" ? out(params) : out;
    throw new Error("unexpected sql: " + sql);
  });
}

const dataCalls = (q) => q.mock.calls.filter((c) => {
  const sql = c.arguments[0];
  return !SESSION_SQL.test(sql) && !ACCOUNT_SQL.test(sql);
}).length;

/* Every staff role that is NOT owner or admin. These are the ones that could
   read a partner's identity before this gate existed. */
const OUTSIDE = ["closer", "setter", "funding_advisor", "inquiry_specialist", "partner", "", null];

describe("/api/partner-brand — the read is gated too", () => {

  test("*** a setter cannot READ a partner's brand — this is the hole ***", async () => {
    const q = stub("setter", [[/v_partner_brand_effective/i, { rows: [BRAND_ROW] }]]);
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { partner_id: PARTNER } }), res);

      assert.equal(res.statusCode, 403, "any signed-in employee could read this before the gate");
      assert.equal(dataCalls(q), 0, "the brand must not even be queried for a refused caller");

      const blob = JSON.stringify(res.body);
      assert.ok(!blob.includes("Example Partner Ltd"), "the partner's trading name leaked into a 403");
      assert.ok(!blob.includes("1 Example Street"), "the partner's registered address leaked into a 403");
    } finally { q.mock.restore(); }
  });

  test("every role outside owner/admin is refused on GET", async () => {
    for (const role of OUTSIDE) {
      const q = stub(role, [[/v_partner_brand_effective/i, { rows: [BRAND_ROW] }]]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "GET", query: { partner_id: PARTNER } }), res);
        assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} should be refused on GET`);
        assert.equal(dataCalls(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("every role outside owner/admin is refused on PUT", async () => {
    // This half was already safe via canWrite. Asserted anyway so a future
    // refactor that removes one of the two checks fails here.
    for (const role of OUTSIDE) {
      const q = stub(role);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "PUT", body: { partner_id: PARTNER, ink: "#000000" } }), res);
        assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} should be refused on PUT`);
        assert.equal(dataCalls(q), 0);
      } finally { q.mock.restore(); }
    }
  });

  test("owner and admin still read the brand", async () => {
    for (const role of ["owner", "admin"]) {
      const q = stub(role, [[/v_partner_brand_effective/i, { rows: [BRAND_ROW] }]]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "GET", query: { partner_id: PARTNER } }), res);
        assert.equal(res.statusCode, 200, `${role} must still be able to read`);
        assert.equal(res.body.brand.entity_name, "Example Partner Ltd");
      } finally { q.mock.restore(); }
    }
  });

  test("owner and admin still write the brand", async () => {
    for (const role of ["owner", "admin"]) {
      const q = stub(role, [
        [/SELECT org_id FROM partners/i, { rows: [{ org_id: ORG }] }],
        [/INSERT INTO/i, { rows: [BRAND_ROW] }],
        [/v_partner_brand_effective/i, { rows: [BRAND_ROW] }]
      ]);
      try {
        const res = mockRes();
        await handler(signedReq({ method: "PUT", body: { partner_id: PARTNER, ink: "#112233" } }), res);
        assert.ok(res.statusCode === 200 || res.statusCode === 201,
          `${role} must still be able to write, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      } finally { q.mock.restore(); }
    }
  });

  test("no session is a 401, and the brand is never queried", async () => {
    const q = mock.method(dbModule.db, "query", async (sql) => {
      if (SESSION_SQL.test(sql)) return { rows: [] };
      if (/account_sessions|FROM accounts/i.test(sql)) return { rows: [] };
      throw new Error("must not be reached: " + sql);
    });
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: { partner_id: PARTNER } }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(dataCalls(q), 0);
    } finally { q.mock.restore(); }
  });

  test("the gate runs BEFORE the partner_id is even validated", async () => {
    // Order matters for what a refused caller can learn. A 400 for a malformed
    // id, handed to someone with no right to the endpoint, confirms the endpoint
    // exists and tells them the parameter's shape.
    const q = stub("closer");
    try {
      const res = mockRes();
      await handler(signedReq({ method: "GET", query: {} }), res);
      assert.equal(res.statusCode, 403, "the role gate must come before parameter validation");
    } finally { q.mock.restore(); }
  });
});

describe("/api/partner-brand — the gate is a real second call", () => {

  test("the handler does not pass `roles` to requireAuth, which would drop it", async () => {
    // The class of bug src/http/auth-gate.test.mjs catches repo-wide, asserted
    // here too because this file just gained a gate and is the obvious place to
    // write the broken form by accident.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../../api/partner-brand.mjs"), "utf8");

    assert.match(src, /requirePrincipal\(\s*req\s*,\s*res\s*,\s*\["staff",\s*"partner"\]/,
      "the entry gate must name staff and partner kinds");
    assert.match(src, /requireRole\(\s*res\s*,\s*staff\s*,\s*PARTNER_BRAND_ROLES\s*\)/,
      "staff still need a separate requireRole call; a roles key on auth is dropped");
  });
});
