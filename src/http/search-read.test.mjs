// Tests for GET /api/read/search — the global CRM search.
//
// Under src/http/ rather than next to the handler: npm test globs only
// src/** and scripts/** (CLAUDE.md §12).
//
// THE CASES THAT MATTER:
//   * ROLE_SETS.STAFF only — a partner session must not search the book
//   * org comes from the session, never the query string
//   * empty q is an honest empty answer, not an error
//   * ILIKE metacharacters in the term are escaped
//   * every group query binds the session org

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.mjs";
import handler, { likePattern, emptyGroups } from "../../api/read/search.mjs";
import { ROLE_SETS } from "./read-api.mjs";

const SEARCH_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api/read/search.mjs"),
  "utf8"
);

const TOKEN = "search-test-session-token";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "11111111-1111-4111-8111-1111111111bb";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const req = (query = {}, method = "GET") => ({
  method,
  headers: { authorization: `Bearer ${TOKEN}` },
  query
});

let realQuery;
let currentRole = "closer";
let currentOrg = ORG;
const sqlCalls = [];

async function stubQuery(sql, params) {
  const text = String(sql);
  if (/FROM live JOIN staff/.test(text)) {
    return {
      rows: [{
        session_id: "session-1",
        expires_at: new Date(Date.now() + 3600_000),
        staff_id: "00000000-0000-4000-8000-000000000002",
        org_id: currentOrg,
        role: currentRole,
        email: "search@example.com",
        name: "Searcher",
        status: "active",
        active_flag: null
      }]
    };
  }
  sqlCalls.push({ sql: text, params: params || [] });
  return { rows: [] };
}

before(() => {
  realQuery = db.query;
  db.query = stubQuery;
});

after(() => {
  db.query = realQuery;
});

async function drive(query, opts = {}) {
  sqlCalls.length = 0;
  currentRole = opts.role || "closer";
  currentOrg = opts.orgId === undefined ? ORG : opts.orgId;
  const r = res();
  await handler(req(query, opts.method || "GET"), r);
  return r;
}

describe("api/read/search — helpers", () => {
  test("likePattern wraps and escapes ILIKE metacharacters", () => {
    assert.equal(likePattern("  ada  "), "%ada%");
    assert.equal(likePattern("100%"), "%100\\%%");
    assert.equal(likePattern("a_b"), "%a\\_b%");
    assert.equal(likePattern(""), null);
    assert.equal(likePattern("   "), null);
  });

  test("emptyGroups names every bucket the screen expects", () => {
    assert.deepEqual(Object.keys(emptyGroups()).sort(), [
      "cards", "clients", "contracts", "conversations", "documents"
    ]);
  });
});

describe("api/read/search — auth and role gate", () => {
  test("POST is refused", async () => {
    const r = await drive({ q: "ada" }, { method: "POST" });
    assert.equal(r.code, 405);
  });

  test("every ROLE_SETS.STAFF role is admitted", async () => {
    for (const role of [...ROLE_SETS.STAFF]) {
      const r = await drive({ q: "ada" }, { role });
      assert.equal(r.code, 200, `${role} was refused`);
      assert.equal(r.body.ok, true);
    }
  });

  test("a partner is refused — not ROLE_SETS.STAFF", async () => {
    const r = await drive({ q: "ada" }, { role: "partner" });
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "forbidden");
  });

  test("a client principal is refused", async () => {
    const r = await drive({ q: "ada" }, { role: "client" });
    assert.equal(r.code, 403);
  });
});

describe("api/read/search — org scope and empty q", () => {
  test("empty q returns empty groups without querying the book", async () => {
    const r = await drive({ q: "  " }, { role: "closer" });
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.groups, emptyGroups());
    assert.equal(sqlCalls.length, 0, "empty q must not fan out five searches");
  });

  test("a session with no org is refused rather than searching everyone", async () => {
    const r = await drive({ q: "ada" }, { orgId: null });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "org_required");
  });

  test("every search query binds the session org, never a query-string org", async () => {
    const r = await drive(
      { q: "ada", org_id: OTHER_ORG },
      { role: "closer", orgId: ORG }
    );
    assert.equal(r.code, 200);
    assert.ok(sqlCalls.length >= 5, "expected one query per group");
    for (const call of sqlCalls) {
      assert.ok(
        call.params.includes(ORG),
        "a search query ran without the session org"
      );
      assert.ok(
        !call.params.includes(OTHER_ORG),
        "an org id from the query string reached SQL — that is a tenancy hole"
      );
    }
  });

  test("the response groups are always present", async () => {
    const r = await drive({ q: "ada" });
    assert.equal(r.code, 200);
    assert.equal(r.body.q, "ada");
    for (const key of Object.keys(emptyGroups())) {
      assert.ok(Array.isArray(r.body.groups[key]), `${key} missing from groups`);
    }
  });

  test("card search also matches a white-label partner name", () => {
    assert.match(SEARCH_SRC, /pr\.name ILIKE/);
    assert.match(SEARCH_SRC, /LEFT JOIN partners/i);
  });
});
