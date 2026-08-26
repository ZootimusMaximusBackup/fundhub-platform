import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/read/unrecorded-calls.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "33333333-3333-4333-8333-333333333333";
const OLD = "2026-08-26T16:00:00.000Z";

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

function staff(role) {
  return { id: STAFF, org_id: ORG, role, name: role, email: role + "@x.test", status: "active" };
}

function dbWith(rows) {
  return {
    async query(sql) {
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/FROM call_outcomes/i.test(sql)) return { rows };
      return { rows: [] };
    }
  };
}

async function get(opts = {}) {
  const res = resCapture();
  await handler(
    { method: opts.method ?? "GET", query: opts.query || {} },
    res,
    {
      db: opts.db ?? dbWith([]),
      requireAuth: opts.requireAuth ?? (async () => staff(opts.role ?? "closer")),
      now: opts.now ?? new Date("2026-08-26T18:00:00Z")
    }
  );
  return res;
}

test("GET lists a no-tape call as unrecorded", async () => {
  const res = await get({
    role: "closer",
    db: dbWith([{
      id: "co-1",
      client_id: "c1",
      staff_id: STAFF,
      outcome: "deposit",
      recording_url: null,
      transcript: null,
      logged_at: OLD,
      client_name: "Jane Doe"
    }])
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.flag, "unrecorded");
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].flag, "unrecorded");
});

test("GET does not list a call that already has a transcript", async () => {
  const res = await get({
    role: "closer",
    db: dbWith([{
      id: "co-2",
      client_id: "c2",
      staff_id: STAFF,
      outcome: "deposit",
      recording_url: null,
      transcript: "we talked money",
      logged_at: OLD,
      client_name: "Sam Lee"
    }])
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 0);
});
