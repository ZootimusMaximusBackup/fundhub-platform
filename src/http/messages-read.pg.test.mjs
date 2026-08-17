// Tests for GET /api/read/messages — one conversation's thread.
//
// Lives under src/http/ and NOT under api/, because npm test globs only
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs": a test file next to the
// handler would be silently dead. (CLAUDE.md §12.)
//
// Same two halves as src/http/conversations-read.pg.test.mjs, on purpose:
//
//   ALWAYS RUN — the request-shape contract. No session is 401, a non-GET is
//   405, a role outside the staff set is 403, a missing or malformed
//   conversation_id is 400 with NO query issued, and the org is bound from the
//   session rather than the query string. The recording `db` models no table
//   and holds no rows; it can only prove a query happened or did not.
//
//   DATABASE_URL ONLY — the data. That both directions come back in one list,
//   that another company's thread is invisible, and that the sender's name is
//   joined for a staff reply and null for a client's message. Those are claims
//   about the real schema and a fake would get them wrong the moment it moved.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import handler, { run } from "../../api/read/messages.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "messages_read_pg_test@example.com";
const OTHER_ORG = "Messages Read Test Co";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

/* ---------------------------------------------------------------- no DB ---- */

const recorder = () => {
  const calls = [];
  return { calls, query: (sql, params) => { calls.push({ sql, params }); return Promise.resolve({ rows: [] }); } };
};

const ORG = "00000000-0000-4000-8000-0000000000ff";
const asStaff = (role, orgId = ORG) => async () => ({
  id: "00000000-0000-4000-8000-000000000001",
  role, org_id: orgId, email: "recorder@example.com", name: "Recorder", status: "active"
});

const CONVO = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";

async function drive(query, { role = "closer", method = "GET", orgId = ORG } = {}) {
  const r = res();
  const fake = recorder();
  await run({ method, query, headers: {} }, r, { db: fake, requireAuth: asStaff(role, orgId) });
  return { r, calls: fake.calls };
}

test("messages: a missing conversation_id is 400, never every message in the company", async () => {
  const { r, calls } = await drive({});
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_parameter");
  assert.equal(calls.length, 0, "a request with no conversation_id reached the database");
});

test("messages: status=blocked without conversation_id is an org-scoped blocked list", async () => {
  const { r, calls } = await drive({ status: "blocked", limit: "30" });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.items), "blocked list must return items, even if empty");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.includes(ORG), "the session's org was not bound");
  assert.ok(calls[0].params.includes("blocked"), "status was not passed as a bind parameter");
  assert.match(calls[0].sql, /m\.org_id\s*=\s*\$\d+/, "the query has no org filter");
  assert.match(calls[0].sql, /m\.status\s*=\s*\$\d+/, "the query has no status bind");
  assert.ok(!calls[0].sql.includes("'blocked'"), "status was interpolated into the SQL text");
});

test("messages: a status other than blocked still requires conversation_id", async () => {
  const { r, calls } = await drive({ status: "queued" });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_parameter");
  assert.equal(calls.length, 0, "a non-blocked status without conversation_id reached the database");
});

test("messages: a malformed conversation_id is 400 rather than a 500 out of Postgres", async () => {
  for (const bad of ["zzz", "123", "not-a-uuid", "", "   ", "00000000-0000-4000-8000-00000000000"]) {
    const { r, calls } = await drive({ conversation_id: bad });
    assert.equal(r.code, 400, `conversation_id=${JSON.stringify(bad)} was not rejected`);
    assert.equal(calls.length, 0, `conversation_id=${JSON.stringify(bad)} reached the database`);
  }
});

test("messages: the conversation id is bound as a parameter, never interpolated", async () => {
  const { r, calls } = await drive({ conversation_id: CONVO });
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.includes(CONVO), "conversation_id was not passed as a bind parameter");
  assert.ok(!calls[0].sql.includes(CONVO), "conversation_id was interpolated into the SQL text");
});

// Audit C1. conversation_id comes from the query string, so it is a value the
// caller chooses; the only thing making this a scope is the session's org.
test("messages: the org is bound from the session, and a session with none binds null", async () => {
  const { calls } = await drive({ conversation_id: CONVO });
  assert.ok(calls[0].params.includes(ORG), "the session's org was not bound");
  assert.match(calls[0].sql, /m\.org_id\s*=\s*\$\d+/, "the query has no org filter on the rows it returns");

  const { calls: none } = await drive({ conversation_id: CONVO }, { orgId: null });
  assert.ok(none[0].params.includes(null), "a session with no org must bind NULL and match nothing");
});

test("messages: the thread view's columns are selected", async () => {
  const { calls } = await drive({ conversation_id: CONVO });
  const sql = calls[0].sql;
  for (const col of ["direction", "channel", "rendered_body", "status", "created_at", "sender_staff_id", "sender_name"]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `the thread renders ${col} and the query does not select it`);
  }
});

// The destination is on the row and is deliberately not returned: a thread view
// is what was said, not a column of phone numbers on a shared monitor.
test("messages: to_address is not returned to the screen", async () => {
  const { calls } = await drive({ conversation_id: CONVO });
  assert.ok(!/\bto_address\b/.test(calls[0].sql), "to_address is being selected into the thread view");
});

test("messages: newest first — a thread read wants the end of the history", async () => {
  const { calls } = await drive({ conversation_id: CONVO });
  assert.match(calls[0].sql, /order\s+by\s+m\.created_at\s+desc/i);
});

test("messages: pagination asks for limit+1 so hasMore is real", async () => {
  const { calls } = await drive({ conversation_id: CONVO, limit: "10" });
  assert.ok(calls[0].params.includes(11), `expected limit+1 in ${JSON.stringify(calls[0].params)}`);
});

test("messages: a role outside the staff set is 403 and never reaches the database", async () => {
  const { r, calls } = await drive({ conversation_id: CONVO }, { role: "affiliate" });
  assert.equal(r.code, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(calls.length, 0);
});

test("messages: every staff role the inbox is used by is admitted", async () => {
  for (const role of ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager"]) {
    const { r } = await drive({ conversation_id: CONVO }, { role });
    assert.equal(r.code, 200, `${role} was locked out of the thread view`);
  }
});

test("messages: a non-GET method is 405 and is rejected before auth", async () => {
  const { r, calls } = await drive({ conversation_id: CONVO }, { method: "POST" });
  assert.equal(r.code, 405);
  assert.equal(r.body.error, "method_not_allowed");
  assert.equal(calls.length, 0);
});

// The REAL default export — the one the router mounts — with no session.
test("messages: no session is a 401, and returns no rows", async () => {
  const r = res();
  await handler({ method: "GET", query: { conversation_id: CONVO }, headers: {} }, r);
  assert.equal(r.code, 401);
  assert.equal(r.body.error, "unauthorized");
  assert.equal(r.body.items, undefined);
});

/* ------------------------------------------------------- real Postgres ---- */

let orgId = null;
let clientId = null;
let staffId = null;
let convoId = null;
let token = null;
let sessionId = null;
let otherOrgId = null;
let otherConvoId = null;

async function wipe() {
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM staff WHERE org_id IN (SELECT id FROM orgs WHERE name = $1)`, [OTHER_ORG]);
  await db.query(`DELETE FROM orgs WHERE name = $1`, [OTHER_ORG]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  const s = await db.query(
    `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
      ORDER BY created_at LIMIT 1`, [orgId]);
  if (!s.rows[0]) throw new Error("no active staff — run scripts/seed-staff.mjs");
  staffId = s.rows[0].id;
  const { createSession } = await import("../auth/session.mjs");
  const session = await createSession(db, { staffId, orgId: s.rows[0].org_id });
  token = session.token;
  sessionId = session.sessionId;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone)
     VALUES ($1,$2,'Thread','Reader','+15550000111') RETURNING id`, [orgId, `mine_${EMAIL}`])).rows[0].id;

  convoId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now()) RETURNING id`, [orgId, clientId])).rows[0].id;

  // One in each direction, an hour apart, so the ordering assertion is real.
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status, created_at)
     VALUES ($1,$2,$3,'inbound','sms','can you call me back?','received', now() - interval '2 hours')`,
    [orgId, clientId, convoId]);
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status, sender_staff_id, created_at)
     VALUES ($1,$2,$3,'outbound','sms','calling you in five','sent',$4, now() - interval '1 hour')`,
    [orgId, clientId, convoId, staffId]);

  // A second company with its own thread — the leak test below reads it.
  otherOrgId = (await db.query(
    `INSERT INTO orgs (name, slug) VALUES ($1, 'messages-read-test-co') RETURNING id`, [OTHER_ORG])).rows[0].id;
  const otherClient = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,'Other','Company') RETURNING id`, [otherOrgId, `theirs_${EMAIL}`])).rows[0].id;
  otherConvoId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now()) RETURNING id`, [otherOrgId, otherClient])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,$3,'inbound','sms','a different company''s client','received')`,
    [otherOrgId, otherClient, otherConvoId]);
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

test("messages: a signed-in staff member sees both sides of the thread", { skip: !HAS_DB }, async () => {
  const r = await call({ conversation_id: convoId, limit: "200" });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 2);
  assert.deepEqual(
    r.body.items.map((m) => m.direction),
    ["outbound", "inbound"],
    "newest first: the staff reply was written after the client's message"
  );
});

test("messages: a staff reply carries its author's name; a client's message carries none", { skip: !HAS_DB }, async () => {
  const r = await call({ conversation_id: convoId, limit: "200" });
  const outbound = r.body.items.find((m) => m.direction === "outbound");
  const inbound = r.body.items.find((m) => m.direction === "inbound");
  assert.equal(outbound.sender_staff_id, staffId);
  assert.ok(outbound.sender_name, "the thread cannot say who replied");
  // NULL means "no person sent this", not "unknown person" — 120_messages_sender.
  assert.equal(inbound.sender_staff_id, null);
  assert.equal(inbound.sender_name, null);
});

// THE LEAK TEST. conversation_id is attacker-chosen; the org is not.
test("messages: another company's thread returns nothing, not its messages", { skip: !HAS_DB }, async () => {
  const r = await call({ conversation_id: otherConvoId, limit: "200" });
  assert.equal(r.code, 200, "a thread in another company should answer emptily, not 403 — see the handler header");
  assert.deepEqual(r.body.items, []);
});

test("messages: an unknown conversation is an empty answer, not a 404", { skip: !HAS_DB }, async () => {
  const r = await call({ conversation_id: "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.items, []);
});
