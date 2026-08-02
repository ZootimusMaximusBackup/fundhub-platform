// Tests for GET /api/read/inbox — the staff reply inbox's thread list.
//
// Under src/http/ rather than next to the handler: npm test globs only
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs" (CLAUDE.md §12).
//
// THIS IS THE ONE READ IN THE INBOX WITH NO ID IN THE REQUEST, which makes it
// exactly the shape audit C1 was about: a cross-client list whose only scope is
// the session's org. Half the cases below are about that single fact.
//
// The rest is the ordering and the "needs reply" flag, both of which are
// derived rather than stored — see the handler header — so they are asserted
// against real rows, not against a fake that could be made to agree.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import handler, { run } from "../../api/read/inbox.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "inbox_read_pg_test@example.com";
const OTHER_ORG = "Inbox Read Test Co";

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

async function drive(query = {}, { role = "closer", method = "GET", orgId = ORG } = {}) {
  const r = res();
  const fake = recorder();
  await run({ method, query, headers: {} }, r, { db: fake, requireAuth: asStaff(role, orgId) });
  return { r, calls: fake.calls };
}

// Audit C1, the write-it-down case: this endpoint takes no id at all, so if the
// org filter is ever dropped it returns every thread in every company and
// nothing about the request looks wrong.
test("inbox: the company comes from the session and is the only scope there is", async () => {
  const { r, calls } = await drive();
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /c\.org_id\s*=\s*\$\d+/, "the inbox list has no org filter");
  assert.ok(calls[0].params.includes(ORG), "the session's org was not bound");
});

test("inbox: a session with no company binds null and can match nothing", async () => {
  const { calls } = await drive({}, { orgId: null });
  assert.ok(calls[0].params.includes(null), "a session with no org must fail closed, not run unfiltered");
});

test("inbox: the company is never taken from the query string", async () => {
  const { calls } = await drive({ org_id: "11111111-1111-4111-8111-111111111111" });
  assert.ok(
    !calls[0].params.includes("11111111-1111-4111-8111-111111111111"),
    "an org id from the query string reached the query — a caller who chooses their own tenancy has none"
  );
});

test("inbox: the list is ordered by the newest activity on each thread", async () => {
  const { calls } = await drive();
  assert.match(calls[0].sql, /order\s+by\s+coalesce\(last\.created_at,\s*c\.last_pulse_at,\s*c\.created_at\)\s+desc/i);
});

test("inbox: the row carries what a list item renders without a second request", async () => {
  const { calls } = await drive();
  const sql = calls[0].sql;
  for (const col of ["client_id", "channel", "first_name", "last_name", "last_direction", "last_body", "last_at", "needs_reply"]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `the inbox list renders ${col} and the query does not produce it`);
  }
});

// A thread with no messages is a real state (upsertConversation can create one
// before a row lands). An inner join would hide it.
test("inbox: threads with no messages yet are still listed", async () => {
  const { calls } = await drive();
  assert.match(calls[0].sql, /left\s+join\s+lateral/i, "the newest-message join is not a LEFT join — empty threads vanish");
});

test("inbox: pagination asks for limit+1 so hasMore is real", async () => {
  const { calls } = await drive({ limit: "10" });
  assert.ok(calls[0].params.includes(11), `expected limit+1 in ${JSON.stringify(calls[0].params)}`);
});

test("inbox: a role outside the staff set is 403 and never reaches the database", async () => {
  const { r, calls } = await drive({}, { role: "affiliate" });
  assert.equal(r.code, 403);
  assert.equal(calls.length, 0);
});

test("inbox: a non-GET method is 405 and is rejected before auth", async () => {
  const { r, calls } = await drive({}, { method: "POST" });
  assert.equal(r.code, 405);
  assert.equal(calls.length, 0);
});

test("inbox: no session is a 401", async () => {
  const r = res();
  await handler({ method: "GET", query: {}, headers: {} }, r);
  assert.equal(r.code, 401);
  assert.equal(r.body.items, undefined);
});

/* ------------------------------------------------------- real Postgres ---- */

let orgId = null;
let token = null;
let sessionId = null;
let otherOrgId = null;
let quietId = null;
let loudId = null;
let emptyId = null;

async function wipe() {
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM conversations WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL}`]);
  await db.query(`DELETE FROM orgs WHERE name = $1`, [OTHER_ORG]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  const s = await db.query(
    `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
      ORDER BY created_at LIMIT 1`, [orgId]);
  if (!s.rows[0]) throw new Error("no active staff — run scripts/seed-staff.mjs");
  const { createSession } = await import("../auth/session.mjs");
  const session = await createSession(db, { staffId: s.rows[0].id, orgId: s.rows[0].org_id });
  token = session.token;
  sessionId = session.sessionId;

  const mkClient = async (org, tag) => (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,$3,'Inbox') RETURNING id`, [org, `${tag}_${EMAIL}`, tag])).rows[0].id;

  // 1. Answered an hour ago — a staff reply is the newest message.
  const answered = await mkClient(orgId, "answered");
  quietId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now() - interval '1 hour') RETURNING id`, [orgId, answered])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status, created_at)
     VALUES ($1,$2,$3,'inbound','sms','hello?','received', now() - interval '3 hours'),
            ($1,$2,$3,'outbound','sms','hi — here now','sent', now() - interval '1 hour')`,
    [orgId, answered, quietId]);

  // 2. Waiting — the client spoke last, ten minutes ago. Newest thread.
  const waiting = await mkClient(orgId, "waiting");
  loudId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now() - interval '10 minutes') RETURNING id`, [orgId, waiting])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status, created_at)
     VALUES ($1,$2,$3,'inbound','sms','any update on my file?','received', now() - interval '10 minutes')`,
    [orgId, waiting, loudId]);

  // 3. A thread with nothing in it. Oldest activity, still listed.
  const silent = await mkClient(orgId, "silent");
  emptyId = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, created_at)
     VALUES ($1,$2,'email', now() - interval '9 hours') RETURNING id`, [orgId, silent])).rows[0].id;

  // 4. Another company's waiting thread. Must never appear.
  otherOrgId = (await db.query(
    `INSERT INTO orgs (name, slug) VALUES ($1,'inbox-read-test-co') RETURNING id`, [OTHER_ORG])).rows[0].id;
  const theirs = await mkClient(otherOrgId, "theirs");
  const theirConvo = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now()) RETURNING id`, [otherOrgId, theirs])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,$3,'inbound','sms','another company''s client','received')`,
    [otherOrgId, theirs, theirConvo]);
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  await close();
});

const call = async (query = {}) => {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
  return r;
};

test("inbox: the newest thread is first and every one of this company's is listed", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  assert.equal(r.code, 200);
  const ids = r.body.items.map((x) => x.id);
  assert.ok(ids.includes(loudId) && ids.includes(quietId) && ids.includes(emptyId),
    "a thread this company owns is missing from its own inbox");
  assert.ok(ids.indexOf(loudId) < ids.indexOf(quietId),
    "a thread that moved ten minutes ago must sort above one that moved an hour ago");
});

test("inbox: a thread with no messages is listed with an honest empty preview", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  const row = r.body.items.find((x) => x.id === emptyId);
  assert.ok(row, "a conversation with no messages was hidden — those are the ones somebody should look at");
  assert.equal(row.last_body, null);
  assert.equal(row.last_at, null);
  // Nothing was said, so nobody is owed a reply. Not "true because we don't know".
  assert.equal(row.needs_reply, null);
});

test("inbox: needs_reply is 'they spoke last', and a staff reply clears it", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  const waiting = r.body.items.find((x) => x.id === loudId);
  const answered = r.body.items.find((x) => x.id === quietId);
  assert.equal(waiting.needs_reply, true);
  assert.equal(waiting.last_direction, "inbound");
  assert.equal(answered.needs_reply, false);
  assert.equal(answered.last_direction, "outbound");
});

// THE LEAK TEST.
test("inbox: another company's threads are not in this company's inbox", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  const foreign = r.body.items.filter((x) => x.last_body === "another company's client");
  assert.deepEqual(foreign, [], "the inbox returned a thread belonging to a different company");
});

// sentiment is NULL for every row in this codebase and nothing computes it.
test("inbox: sentiment comes back null rather than invented", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  for (const row of r.body.items) assert.equal(row.sentiment, null);
});
