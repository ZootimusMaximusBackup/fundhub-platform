// GET /api/read/repair-cases — stubbed database. No Postgres.
// Pins §9 signals: program/auth/trial_ending, no money, detail timeline/signer/target.

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

function makeDb({
  session = {},
  files = [],
  letters = [],
  items = [],
  programs = [],
  consents = [],
  identity = [],
  businesses = [],
  dues = [],
  unconfirmed = [],
  timeline = [],
  contracts = []
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const text = String(sql);
      if (text.includes("UPDATE sessions")) {
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
      if (/FROM repair_programs/i.test(text)) return { rows: programs };
      if (/FROM client_consents/i.test(text)) return { rows: consents };
      if (/FROM pii_identity/i.test(text)) return { rows: identity };
      if (/FROM businesses/i.test(text)) return { rows: businesses };
      if (/MIN\(response_due_at\)/i.test(text) && /client_id = ANY/i.test(text) && /GROUP BY client_id/i.test(text)) {
        return { rows: dues };
      }
      if (/FROM dispute_responses/i.test(text)) return { rows: unconfirmed };
      if (/FROM repair_decision_log/i.test(text)) return { rows: timeline };
      if (/FROM contracts/i.test(text)) return { rows: contracts };
      if (text.includes("FROM cards") && text.includes("AND c.client_id")) {
        return { rows: files };
      }
      if (text.includes("FROM cards")) {
        return { rows: files };
      }
      if (text.includes("FROM dispute_letters")) {
        return { rows: letters };
      }
      if (text.includes("FROM dispute_items")) {
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

const baseFile = {
  card_id: "card-1",
  client_id: CLIENT,
  first_name: "Pat",
  last_name: "Lee",
  email: "pat@example.com",
  stage_key: "ready_to_send",
  updated_at: "2026-08-17T00:00:00Z",
  entered_at: "2026-08-17T00:00:00Z",
  round: "R1",
  bureaus: ["EX"],
  response_due_at: null,
  case_count: 1,
  letters_ready: 2,
  letters_sent: 0
};

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

  test("lists repair files with program/auth and trial_ending — no money", async () => {
    const db = makeDb({
      files: [baseFile],
      programs: [{
        client_id: CLIENT,
        program: "trial",
        rounds_cap: 2,
        status: "upsell_pending"
      }],
      consents: [{ client_id: CLIENT, is_valid: true }],
      identity: [{ client_id: CLIENT, address_ok: true }]
    });
    const res = makeRes();
    await handler(req(), res, { db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.files.length, 1);
    const f = res.body.files[0];
    assert.equal(f.name, "Pat Lee");
    assert.equal(f.program, "trial");
    assert.equal(f.rounds_cap, 2);
    assert.equal(f.authorization_ok, true);
    assert.equal(f.upsell_pending, true);
    assert.equal(res.body.trial_ending, 1);
    assert.ok(!("price_total" in f));
    assert.ok(!("amount_paid" in f));
    assert.ok(!("price_total" in res.body));
    assert.ok(!("amount_paid" in res.body));

    const programCall = db.calls.find((c) => /FROM repair_programs/i.test(c.sql));
    assert.ok(programCall);
    assert.ok(!/price_total/i.test(programCall.sql));
    assert.ok(!/amount_paid/i.test(programCall.sql));

    const listCall = db.calls.find((c) => c.sql.includes("FROM cards") && c.sql.includes("LIMIT"));
    assert.equal(listCall.params[0], ORG);
    assert.match(listCall.sql, /response_due_at/);
  });

  test("rejects a bad client_id", async () => {
    const res = makeRes();
    await handler(req({ query: { client_id: "not-a-uuid" } }), res, { db: makeDb() });
    assert.equal(res.statusCode, 400);
  });

  test("detail returns timeline, signer, target, and sendable letters", async () => {
    const db = makeDb({
      files: [baseFile],
      letters: [{
        id: "letter-1",
        bureau: "EX",
        round: "R1",
        status: "ready",
        body_text: "Dear Experian",
        rule_ids: ["M2-005"],
        target: "bureau"
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
      }],
      programs: [{ client_id: CLIENT, program: "full", rounds_cap: 6, status: "active" }],
      consents: [{ client_id: CLIENT, is_valid: true }],
      identity: [{ client_id: CLIENT, address_ok: true }],
      timeline: [{
        ts: "2026-08-21T10:00:00Z",
        action: "letters_generated",
        payload: {}
      }],
      contracts: [{
        signer_name: "Pat Lee",
        signed_at: "2026-08-19T12:00:00Z"
      }]
    });
    const res = makeRes();
    await handler(req({ query: { client_id: CLIENT } }), res, { db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.can_send, true);
    assert.equal(res.body.letters[0].html, "Dear Experian");
    assert.equal(res.body.letters[0].can_send, true);
    assert.equal(res.body.letters[0].target, "bureau");
    assert.equal(res.body.signer_name, "Pat Lee");
    assert.ok(res.body.signed_at);
    assert.ok(Array.isArray(res.body.timeline));
    assert.equal(res.body.timeline.length, 1);
    assert.ok(!("price_total" in (res.body.file || {})));
    const orgBinds = db.calls.filter((c) => c.sql.includes("org_id = $1")).map((c) => c.params[0]);
    assert.ok(orgBinds.length >= 2);
    assert.ok(orgBinds.every((id) => id === ORG));
  });
});
