/* The CSM's day, against a real Postgres.
 *
 * The thing under test is SQL and a route, so a fake db would prove only that
 * JavaScript can call itself. Three real risks are pinned here:
 *
 *   1. THE ROUTE EXISTS. Calls go through netlify/functions/api.mjs, the real
 *      ROUTES map. A handler file that is not in that map 404s locally and
 *      deployed, and that has shipped broken twice (CLAUDE.md §12).
 *   2. AN UNKNOWN BALANCE IS NOT ZERO. A client with no invoice must come back
 *      null, never 0 — "owes nothing" and "we have not looked" are different
 *      answers and only one of them is safe to say on a call.
 *   3. THE QUEUE IS THE CSM'S, not everyone's. A task owned by another role
 *      must not appear.
 *
 * SKIPS WITHOUT A DATABASE, LOUDLY. A skipped run of this file proves nothing:
 *   DATABASE_URL=postgres://… node --test src/http/csm-queue.pg.test.mjs
 *
 * Rows are marked by NONCE so cleanup touches only what this run made.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const NONCE = `csmq-${process.pid}-${Date.now()}`;

describe("CSM queue: who to call, what they owe, what they own",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {

  let org, handler, token, owes, clean, csmStaff;

  const call = async (path) => {
    const r = await handler(new Request("https://x" + path, {
      headers: { authorization: "Bearer " + token, host: "x" }
    }), {});
    let body = null;
    try { body = JSON.parse(await r.text()); } catch { /* not json */ }
    return { status: r.status, body };
  };

  const mkClient = async (tag) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, client_code)
     VALUES ($1, $2, 'Tester', $3, $4) RETURNING id`,
    [org, tag, `${NONCE}.${tag}@example.com`.toLowerCase(), `${NONCE}-${tag}`.slice(0, 40)]
  )).rows[0].id;

  const mkTask = (clientId, title, role) => db.query(
    `INSERT INTO tasks (org_id, client_id, title, assignee_role, source_workflow, due_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [org, clientId, `${NONCE} ${title}`, role, `${NONCE}-wf`]
  );

  /* INVOICES REFUSE TO BE DELETED, on purpose: trg_invoices_no_delete raises
     "invoices are not deleted — void or write off instead" (031). That guard is
     right and this test is not an exception to it, so cleanup lifts it for the
     one statement and puts it straight back, the same way
     src/funding/success-fee.pg.test.mjs does. The .catch swallows the case
     where the connecting role may not ALTER the table — the rows are
     NONCE-marked in a scratch database, so leaving them is harmless and
     failing the run over cleanup is not.

     The invoices → clients foreign key deliberately does NOT cascade, so the
     invoice has to go before its client or the client delete fails. */
  async function wipe() {
    await db.query(`DELETE FROM tasks WHERE org_id = $1 AND source_workflow = $2`, [org, `${NONCE}-wf`]);
    await db.query(`ALTER TABLE invoices DISABLE TRIGGER trg_invoices_no_delete`).catch(() => {});
    try {
      await db.query(`DELETE FROM invoices WHERE org_id = $1 AND client_id IN
                        (SELECT id FROM clients WHERE org_id = $1 AND email LIKE $2)`, [org, `${NONCE}%`]);
    } finally {
      await db.query(`ALTER TABLE invoices ENABLE TRIGGER trg_invoices_no_delete`).catch(() => {});
    }
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND email LIKE $2`, [org, `${NONCE}%`]);
  }

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    const owner = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org])).rows[0];
    assert.ok(owner, "the default org has an owner staff row (seeded)");
    token = (await createSession(db, { staffId: owner.id, orgId: owner.org_id })).token;

    csmStaff = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'csm' LIMIT 1`, [org])).rows[0];

    await wipe();

    // One client who owes money, one who does not, one whose task belongs elsewhere.
    owes = await mkClient("owes");
    clean = await mkClient("clean");
    const other = await mkClient("other");

    await db.query(
      `INSERT INTO invoices (org_id, client_id, amount_due, source, status)
       VALUES ($1, $2, 500.00, 'funding_success_fee', 'sent')`, [org, owes]);

    await mkTask(owes, "call about the balance", "csm");
    await mkTask(clean, "mid check-in", "csm");
    await mkTask(other, "not the CSM's problem", "closer");
  });

  after(async () => { await wipe(); await close(); });

  // page() calls the envelope key `items`.
  const mine = (body) => (body.items || []).filter(
    (r) => String(r.title || "").startsWith(NONCE));

  test("the route is reachable through the real ROUTES map", async () => {
    const res = await call("/api/read/csm-queue");
    assert.notEqual(res.status, 404,
      "read/csm-queue is not in netlify/functions/api.mjs ROUTES — it would 404 deployed");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test("a CSM role holder is allowed in", async () => {
    if (!csmStaff) return; // 290 seeds a demo CSM; skip rather than fail if demo seeds are off
    const csmToken = (await createSession(db, { staffId: csmStaff.id, orgId: org })).token;
    const r = await handler(new Request("https://x/api/read/csm-queue", {
      headers: { authorization: "Bearer " + csmToken, host: "x" }
    }), {});
    assert.equal(r.status, 200, "a CSM must be in ROLE_SETS.STAFF or they 403 on their own queue");
  });

  test("only the CSM's own open tasks appear", async () => {
    const rows = mine((await call("/api/read/csm-queue?limit=200")).body);
    const titles = rows.map((r) => r.title);
    assert.equal(rows.length, 2, `expected the two csm tasks, got ${JSON.stringify(titles)}`);
    assert.ok(!titles.some((t) => t.includes("not the CSM's problem")),
      "a closer's task must not appear on the CSM queue");
  });

  test("an open balance comes back in cents AND formatted", async () => {
    const row = mine((await call("/api/read/csm-queue?limit=200")).body)
      .find((r) => r.client_id === owes);
    assert.ok(row, "the client who owes money is on the queue");
    assert.equal(row.balance_due_cents, 50000, "$500.00 is 50000 cents");
    assert.equal(row.open_invoices, 1);
    assert.ok(row.balance_due, "a formatted balance for the screen");
  });

  test("a client with no invoice is NULL, never 0", async () => {
    const row = mine((await call("/api/read/csm-queue?limit=200")).body)
      .find((r) => r.client_id === clean);
    assert.ok(row, "the client with nothing owed is still on the queue");
    assert.strictEqual(row.balance_due_cents, null,
      "unknown must not render as zero — 'owes nothing' and 'we did not look' are different answers");
    assert.strictEqual(row.balance_due, null);
  });

  test("the client is named, so the CSM knows who they are calling", async () => {
    const row = mine((await call("/api/read/csm-queue?limit=200")).body)
      .find((r) => r.client_id === owes);
    assert.match(row.client_name || "", /Tester/);
  });

  test("hasMore is real — the query fetches one more than the limit", async () => {
    const res = await call("/api/read/csm-queue?limit=1");
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1, "limit=1 returns one row");
    assert.equal(res.body.hasMore, true,
      "there are at least two csm tasks, so hasMore must be true — if this fails the SQL is fetching exactly `limit` and paging is dead");
  });
});
