// Tests for GET /api/read/conversations — the Closer Dashboard pre-call panel.
//
// Lives under src/http/ and NOT under api/, because npm test globs only
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs": a test file next to the
// handler would be silently dead.
//
// Two halves, deliberately:
//
//   ALWAYS RUN — the request-shape contract. No session is 401, a non-GET is
//   405, a role outside the staff set is 403, and a missing or malformed
//   client_id is 400 with NO query issued. These drive readHandler through its
//   injectable deps, so the recording `db` below never pretends to be Postgres:
//   it returns no rows and exists only to prove a query did or did not happen.
//   That is the opposite of the in-memory schema fakes AUDIT-FINDINGS warns
//   about — nothing here can assert a column into existence.
//
//   DATABASE_URL ONLY — everything about the data. Column presence, the
//   NULLS LAST ordering, sentiment surviving as null, and an unknown client
//   coming back empty are all asserted against the real schema, because those
//   are exactly the claims a fake would get wrong the moment 001_init moves.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import handler, { run } from "../../api/read/conversations.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "conversations_pg_test@example.com";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

/* ---------------------------------------------------------------- no DB ---- */

// Records what was asked and answers nothing. It models no table and holds no
// rows, so it can only ever prove "a query was issued with these params" or
// "no query was issued at all".
const recorder = () => {
  const calls = [];
  return { calls, query: (sql, params) => { calls.push({ sql, params }); return Promise.resolve({ rows: [] }); } };
};

const asStaff = (role) => async () => ({
  id: "00000000-0000-4000-8000-000000000001",
  role, org_id: "00000000-0000-4000-8000-0000000000ff",
  email: "recorder@example.com", name: "Recorder", status: "active"
});

async function drive(query, { role = "closer", method = "GET" } = {}) {
  const r = res();
  const fake = recorder();
  await run({ method, query, headers: {} }, r, { db: fake, requireAuth: asStaff(role) });
  return { r, calls: fake.calls };
}

test("conversations: a missing client_id is 400 invalid_parameter, never an unscoped firehose", async () => {
  const { r, calls } = await drive({});
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_parameter");
  assert.equal(calls.length, 0, "a request with no client_id reached the database");
});

test("conversations: a malformed client_id is 400 rather than a 500 from Postgres", async () => {
  for (const bad of ["zzz", "123", "not-a-uuid", "", "   ", "00000000-0000-4000-8000-00000000000"]) {
    const { r, calls } = await drive({ client_id: bad });
    assert.equal(r.code, 400, `client_id=${JSON.stringify(bad)} was not rejected`);
    assert.equal(r.body.error, "invalid_parameter");
    assert.equal(calls.length, 0, `client_id=${JSON.stringify(bad)} reached the database`);
  }
});

test("conversations: a well-formed client_id is bound as a parameter, never interpolated", async () => {
  const id = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
  const { r, calls } = await drive({ client_id: id });
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.includes(id), "client_id was not passed as a bind parameter");
  assert.ok(!calls[0].sql.includes(id), "client_id was interpolated into the SQL text");
});

test("conversations: the panel's six columns and the NULLS LAST order are in the query", async () => {
  const { calls } = await drive({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" });
  const sql = calls[0].sql;
  for (const col of ["id", "channel", "summary", "sentiment", "last_pulse_at", "created_at"]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `the panel renders ${col} and the query does not select it`);
  }
  // A silent thread is the least recent thing, not the most. Postgres puts NULLs
  // first under DESC, so dropping this clause floats every dead thread to the top.
  assert.match(sql, /order\s+by\s+last_pulse_at\s+desc\s+nulls\s+last\s*,\s*created_at\s+desc/i);
});

test("conversations: pagination asks for limit+1 so hasMore is real and not a second count query", async () => {
  const { calls } = await drive({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b", limit: "10" });
  assert.ok(calls[0].params.includes(11), `expected limit+1 in ${JSON.stringify(calls[0].params)}`);
});

test("conversations: a role outside the staff set is 403 and never reaches the database", async () => {
  const { r, calls } = await drive({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" }, { role: "affiliate" });
  assert.equal(r.code, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(calls.length, 0);
});

test("conversations: every staff role the dashboard is used by is admitted", async () => {
  for (const role of ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter"]) {
    const { r } = await drive({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" }, { role });
    assert.equal(r.code, 200, `${role} was locked out of the pre-call panel`);
  }
});

test("conversations: a non-GET method is 405 and is rejected before auth", async () => {
  const { r, calls } = await drive({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" }, { method: "POST" });
  assert.equal(r.code, 405);
  assert.equal(r.body.error, "method_not_allowed");
  assert.equal(calls.length, 0);
});

// Drives the REAL default export — the one the router mounts — with no session.
// requireAuth short-circuits on a missing token before touching the pool, so
// this holds with or without DATABASE_URL.
test("conversations: no session is a 401, and returns no rows", async () => {
  const r = res();
  await handler({ method: "GET", query: { client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" }, headers: {} }, r);
  assert.equal(r.code, 401);
  assert.equal(r.body.error, "unauthorized");
  assert.equal(r.body.items, undefined);
});

/* ------------------------------------------------------- real Postgres ---- */

let orgId = null;
let clientId = null;
let token = null;
let sessionId = null;

async function wipe() {
  await db.query(
    `DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,'Convo','Reader') RETURNING id`, [orgId, EMAIL])).rows[0].id;

  const s = await db.query(
    `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
      ORDER BY created_at LIMIT 1`, [orgId]);
  if (!s.rows[0]) throw new Error("no active staff — run scripts/seed-staff.mjs");
  const { createSession } = await import("../auth/session.mjs");
  const session = await createSession(db, { staffId: s.rows[0].id, orgId: s.rows[0].org_id });
  token = session.token;
  sessionId = session.sessionId;

  // sentiment is deliberately left out of the INSERT. It is NULL in production
  // for every row, and a test that seeded 'Hot' would be testing a column no
  // code path writes.
  await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, summary, last_pulse_at)
     VALUES ($1,$2,'email','pulsed an hour ago', now() - interval '1 hour'),
            ($1,$2,'sms',  'pulsed two days ago', now() - interval '2 days'),
            ($1,$2,'voice','never pulsed',        NULL)`, [orgId, clientId]);
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  await close();
});

const call = async (query) => {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
  return r;
};

test("conversations: a signed-in closer gets this client's threads and only this client's", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: clientId, limit: "200" });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 3);
  assert.equal(r.body.hasMore, false);
});

test("conversations: every column the pre-call panel renders comes back", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: clientId, limit: "200" });
  for (const row of r.body.items) {
    for (const col of ["id", "channel", "summary", "sentiment", "last_pulse_at", "created_at"]) {
      assert.ok(col in row, `column ${col} missing — the panel renders it`);
    }
  }
});

test("conversations: a thread that never pulsed sorts LAST, not first", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: clientId, limit: "200" });
  const channels = r.body.items.map((i) => i.channel);
  assert.deepEqual(channels, ["email", "sms", "voice"],
    "expected newest pulse first with the never-pulsed thread last");
  assert.equal(r.body.items[2].last_pulse_at, null);
});

test("conversations: sentiment is unknown today and arrives as null, not a default", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: clientId, limit: "200" });
  for (const row of r.body.items) {
    assert.equal(row.sentiment, null,
      `sentiment was substituted with ${JSON.stringify(row.sentiment)} — nothing writes this column`);
  }
});

test("conversations: an unknown client is an empty list with ok:true, not a 404", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.items, []);
});

test("conversations: a signed-in caller with no client_id still gets 400, not everyone's threads", { skip: !HAS_DB }, async () => {
  const r = await call({});
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_parameter");
  assert.equal(r.body.items, undefined);
});

test("conversations: a signed-in caller with a malformed client_id gets 400, not a 500", { skip: !HAS_DB }, async () => {
  const r = await call({ client_id: "zzz" });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_parameter");
});
