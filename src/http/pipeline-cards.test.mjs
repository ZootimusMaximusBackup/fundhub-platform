/* /api/pipeline-cards — persist a board drag / MOVE. */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/pipeline-cards.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const CLIENT = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER = "22222222-2222-4222-8222-222222222222";

const realQuery = db.query;
let calls = [];

function stubDb({ session = null, answers = [], openShift = true } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG_A),
        role: pick("role", "closer"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    // requireActiveShift → currentShift
    if (/FROM shifts/i.test(text) || /clocked_in|ended_at IS NULL/i.test(text)) {
      return openShift
        ? { rows: [{ id: "shift-1", staff_id: STAFF, started_at: new Date().toISOString() }] }
        : { rows: [] };
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

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

describe("/api/pipeline-cards", () => {
  test("refuses non-POST", async () => {
    stubDb({ session: { role: "closer" } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" }, body: {} }, r);
    assert.equal(r.statusCode, 405);
  });

  test("owner is exempt from the shift gate and can move", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      openShift: false,
      answers: [
        [/SELECT id FROM clients/i, { rows: [{ id: CLIENT }] }],
        [/SELECT ps\.id AS stage_id/i, { rows: [{ stage_id: "stage-1", pipeline_id: "pipe-1" }] }],
        [/SELECT id FROM cards/i, { rows: [{ id: "card-1" }] }],
        [/UPDATE cards SET stage_id/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "move", client_id: CLIENT,
        pipeline_key: "sales", stage_key: "booked"
      }
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.stage_key, "booked");
  });

  test("closer with an open shift can move a card they own", async () => {
    stubDb({
      session: { role: "closer", orgId: ORG_A },
      openShift: true,
      answers: [
        [/SELECT id FROM clients/i, (params) => {
          assert.equal(params[0], CLIENT);
          assert.equal(params[1], ORG_A);
          return { rows: [{ id: CLIENT }] };
        }],
        [/SELECT ps\.id AS stage_id/i, { rows: [{ stage_id: "stage-1", pipeline_id: "pipe-1" }] }],
        [/SELECT id FROM cards/i, { rows: [{ id: "card-1" }] }],
        [/UPDATE cards SET stage_id/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "move", client_id: CLIENT,
        pipeline_key: "sales", stage_key: "booked"
      }
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.pipeline_key, "sales");
  });

  test("refuses a client from another org", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/SELECT id FROM clients/i, { rows: [] }]]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "move", client_id: OTHER,
        pipeline_key: "sales", stage_key: "booked"
      }
    }, r);
    assert.equal(r.statusCode, 404);
  });

  test("unknown stage returns 404", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT id FROM clients/i, { rows: [{ id: CLIENT }] }],
        [/SELECT ps\.id AS stage_id/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "move", client_id: CLIENT,
        pipeline_key: "sales", stage_key: "not_a_stage"
      }
    }, r);
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.error, "stage_not_found");
  });
});
