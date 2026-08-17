// GET /api/read/repair-cases — stubbed database. No Postgres.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/read/repair-cases.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    end() { return res; }
  };
  return res;
}

function makeDb({ session = {}, files = [], letters = [], items = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE sessions")) {
        if (session === null) return { rows: [] };
        return {
          rows: [{
            session_id: "sess", expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1", org_id: ORG, role: "inquiry_specialist",
            email: "inquiry@example.com", name: "A Specialist", status: "active",
            active_flag: "true",
            ...session
          }]
        };
      }
      if (sql.includes("FROM cards") && sql.includes("AND c.client_id")) {
        return { rows: files };
      }
      if (sql.includes("FROM cards")) {
        return { rows: files };
      }
      if (sql.includes("FROM dispute_letters")) {
        return { rows: letters };
      }
      if (sql.includes("FROM dispute_items")) {
        return { rows: items };
      }
      throw new Error("stub db: unexpected query:\n" + sql);
    }
  };
}

const req = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer test-token" },
  query: {},
  ...over
});

describe("GET /api/read/repair-cases", () => {
  test("refuses an unknown method", async () => {
    const res = makeRes();
    await handler(req({ method: "POST" }), res, { db: makeDb() });
    assert.equal(res.statusCode, 405);
  });

  test("refuses a missing session", async () => {
    const res = makeRes();
    await handler(req(), res, { db: makeDb({ session: null }) });
    assert.equal(res.statusCode, 401);
  });

  test("refuses a role outside STAFF", async () => {
    const res = makeRes();
    await handler(req(), res, { db: makeDb({ session: { role: "affiliate" } }) });
    assert.equal(res.statusCode, 403);
  });

  test("lists repair files scoped to the session org", async () => {
    const db = makeDb({
      files: [{
        card_id: "card-1",
        client_id: CLIENT,
        first_name: "Pat",
        last_name: "Lee",
        email: "pat@example.com",
        stage_key: "ready_to_send",
        updated_at: "2026-08-17T00:00:00Z",
        round: "R1",
        bureaus: ["EX"],
        case_count: 1,
        letters_ready: 2,
        letters_sent: 0
      }]
    });
    const res = makeRes();
    await handler(req(), res, { db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.files.length, 1);
    assert.equal(res.body.files[0].name, "Pat Lee");
    assert.equal(res.body.files[0].can_send, true);
    assert.equal(res.body.need_me, 1);
    const listCall = db.calls.find((c) => c.sql.includes("FROM cards") && c.sql.includes("LIMIT"));
    assert.equal(listCall.params[0], ORG);
  });

  test("rejects a bad client_id", async () => {
    const res = makeRes();
    await handler(req({ query: { client_id: "not-a-uuid" } }), res, { db: makeDb() });
    assert.equal(res.statusCode, 400);
  });

  test("detail returns sendable letters for one client in the session org", async () => {
    const db = makeDb({
      files: [{
        card_id: "card-1",
        client_id: CLIENT,
        first_name: "Pat",
        last_name: "Lee",
        email: "pat@example.com",
        stage_key: "ready_to_send",
        updated_at: "2026-08-17T00:00:00Z",
        round: "R1",
        bureaus: ["EX"],
        case_count: 1,
        letters_ready: 1,
        letters_sent: 0
      }],
      letters: [{
        id: "letter-1",
        bureau: "EX",
        round: "R1",
        status: "ready",
        body_text: "Dear Experian",
        rule_ids: ["M2-005"]
      }],
      items: [{
        id: "item-1",
        rule_id: "M2-005",
        severity: "strong",
        field: "24",
        creditor: "BANK",
        account_last4: "1234",
        round: "R1",
        status: "open",
        outcome: null
      }]
    });
    const res = makeRes();
    await handler(req({ query: { client_id: CLIENT } }), res, { db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.can_send, true);
    assert.equal(res.body.letters[0].html, "Dear Experian");
    assert.equal(res.body.letters[0].can_send, true);
    const orgBinds = db.calls.filter((c) => c.sql.includes("org_id = $1")).map((c) => c.params[0]);
    assert.ok(orgBinds.length >= 2);
    assert.ok(orgBinds.every((id) => id === ORG));
  });
});
