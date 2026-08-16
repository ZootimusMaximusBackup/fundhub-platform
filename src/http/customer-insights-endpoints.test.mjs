import { test, describe } from "node:test";
import assert from "node:assert/strict";
import writeInsights from "../../api/customer-insights.mjs";
import readInsights from "../../api/read/customer-insights.mjs";
import { QUESTIONS } from "../insights/questions.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function staff(role, orgId = ORG) {
  return { id: STAFF, org_id: orgId, role, name: role, email: role + "@x.test", status: "active" };
}

function dbOk() {
  return {
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients/.test(s)) return { rows: [{ id: CLIENT }] };
      if (/INSERT INTO customer_insights/.test(s)) {
        return {
          rows: [{
            id: "ins1",
            org_id: params[0],
            client_id: params[1],
            product_id: params[2],
            task_id: params[3],
            stage: params[4],
            channel: params[5],
            answers: JSON.parse(params[6]),
            notes: params[7],
            meeting_url: params[8],
            recording_url: params[9],
            recorded_by: params[10],
            occurred_at: "2026-08-15T00:00:00.000Z",
            created_at: "2026-08-15T00:00:00.000Z"
          }]
        };
      }
      if (/FROM customer_insights/.test(s)) {
        return {
          rows: [{
            id: "ins1", org_id: ORG, client_id: CLIENT, stage: "post",
            channel: "google_meet", answers: { felt_funded: "relieved" },
            recorded_by: STAFF, occurred_at: "2026-08-15T00:00:00.000Z",
            created_at: "2026-08-15T00:00:00.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };
}

async function post(body, opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "funding_advisor";
  await writeInsights(
    { method: opts.method ?? "POST", body },
    res,
    {
      db: opts.db ?? dbOk(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId))
    }
  );
  return res;
}

async function get(opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "funding_advisor";
  await readInsights(
    { method: opts.method ?? "GET", query: opts.query ?? { client_id: CLIENT } },
    res,
    {
      db: opts.db ?? dbOk(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId))
    }
  );
  return res;
}

describe("POST /api/customer-insights", () => {
  test("unsigned is 401", async () => {
    const res = await post({}, {
      requireAuth: async (_req, r) => {
        r.status(401).json({ ok: false, error: "unauthorized" });
        return null;
      }
    });
    assert.equal(res.statusCode, 401);
  });

  test("affiliate is refused", async () => {
    const res = await post(
      { client_id: CLIENT, stage: "post", channel: "google_meet" },
      { role: "affiliate" }
    );
    assert.equal(res.statusCode, 403);
  });

  test("funding advisor can save a post interview", async () => {
    const res = await post({
      client_id: CLIENT,
      stage: "post",
      channel: "google_meet",
      answers: { felt_funded: "relieved" }
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.insight.stage, "post");
    assert.equal(res.body.insight.answers.felt_funded, "relieved");
  });

  test("bad stage is 400", async () => {
    const res = await post({
      client_id: CLIENT,
      stage: "before",
      channel: "call"
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("GET /api/read/customer-insights", () => {
  test("unsigned is 401", async () => {
    const res = await get({
      requireAuth: async (_req, r) => {
        r.status(401).json({ ok: false, error: "unauthorized" });
        return null;
      }
    });
    assert.equal(res.statusCode, 401);
  });

  test("returns items plus the question banks", async () => {
    const res = await get();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.items.length, 1);
    assert.deepEqual(res.body.questions.post.map((q) => q.id), QUESTIONS.post.map((q) => q.id));
    assert.ok(res.body.questions.mid.length > 0);
  });
});
