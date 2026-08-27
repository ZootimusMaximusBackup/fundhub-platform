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

/* THE PAGE MUST BE CHOSEN BEFORE THE LATERAL RUNS.

   This is the scale case, and it is asserted on the SQL text because it is a
   query-plan property that no amount of test data at this size would reveal —
   the old shape returned identical rows, just by sorting the company's whole
   conversations table on every load. Getting it wrong again would be invisible
   until the table is large, which is the worst time to find out. */
test("inbox: the page is chosen from conversations alone, so an index can serve it", async () => {
  const { calls } = await drive();
  const sql = calls[0].sql;

  // The inner page-picker sorts on columns that live on `conversations`.
  assert.match(sql, /order\s+by\s+coalesce\(c\.last_pulse_at,\s*c\.created_at\)\s+desc/i,
    "the page is no longer ordered by conversation columns — it cannot use idx_conversations_activity");
  // ...and the LIMIT is applied there, inside the CTE, not after the join.
  const cte = sql.slice(sql.indexOf("WITH page AS"), sql.indexOf(")\n       SELECT"));
  assert.match(cte, /limit\s+\$1\s+offset\s+\$2/i,
    "the page limit moved out of the CTE — the lateral will run for every row in the company");
  assert.ok(!/lateral/i.test(cte),
    "the newest-message lateral is inside the page-picking CTE, which is the exact shape this " +
    "avoids: it forces one index lookup per conversation in the company on every inbox load");
});

test("inbox: the sort matches the expression idx_conversations_activity indexes", async () => {
  const { calls } = await drive();
  // Migration 119 indexes (org_id, (COALESCE(last_pulse_at, created_at)) DESC, id DESC).
  // If the query's expression drifts from the index's, nothing breaks — the
  // index is just silently not used, and the screen gets slower every month.
  assert.match(calls[0].sql, /coalesce\(c\.last_pulse_at,\s*c\.created_at\)\s+desc,\s*c\.id\s+desc/i);
});

test("inbox: the Needs-reply tab filters in the database, not in the browser", async () => {
  const off = await drive();
  assert.ok(off.calls[0].params.includes(false),
    "the needs-reply flag is not being bound — the tab cannot be a server-side filter");

  const on = await drive({ needs_reply: "1" });
  assert.ok(on.calls[0].params.includes(true), "?needs_reply=1 did not reach the query");
  assert.match(on.calls[0].sql, /=\s*'inbound'\)/,
    "the filter does not ask whether the newest message is inbound");
});

test("inbox: only an explicit 1 or true turns the filter on", async () => {
  for (const raw of ["0", "false", "", "no", undefined]) {
    const { calls } = await drive(raw === undefined ? {} : { needs_reply: raw });
    assert.ok(calls[0].params.includes(false),
      `needs_reply=${JSON.stringify(raw)} switched the filter on`);
  }
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

/* Nothing in the product computes sentiment. src/conversations/store.mjs:167 says
   so outright — "sentiment is never written" — and the reason is in its header:
   "A guessed sentiment is read aloud on a sales call."

   The one exception is the DEMO seeder, which stamps a literal 'Warm' on its own
   rows (platform-seed.mjs:172) so the screen looks populated. That is fixture
   dressing, not a computation, and this test used to assert null for EVERY row —
   so it failed the moment the demo seed existed in the same database, which the
   shared pg suite guarantees.

   The guarantee that matters is about REAL conversations, so that is what is
   asserted, and the demo rows are checked to be the only exception rather than
   quietly skipped. */
test("inbox: sentiment comes back null rather than invented", { skip: !HAS_DB }, async () => {
  const r = await call({ limit: "200" });
  const demoIds = new Set((await db.query(
    `SELECT id FROM conversations WHERE COALESCE(is_demo, false)`
  )).rows.map((x) => String(x.id)));

  let realRows = 0;
  for (const row of r.body.items) {
    if (demoIds.has(String(row.id))) {
      assert.equal(row.sentiment, "Warm",
        "the demo seeder is the only thing that writes sentiment, and it writes 'Warm'");
      continue;
    }
    realRows += 1;
    assert.equal(row.sentiment, null,
      "a real conversation must never carry a sentiment — nothing computes one");
  }
  assert.ok(realRows > 0, "no real rows were checked, so this asserted nothing");
});
