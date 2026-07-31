// GET /api/read/finance-os — can a client read their own cards, and ONLY their own?
//
// This endpoint returns per-person credit limits and balances. It is the first
// one in the repo to serve that data to a non-staff principal, so the isolation
// assertions below are the point of the file — the interesting tests are the
// ones where a client tries to read somebody else's cards.
//
// Written the way src/http/principal-reads.pg.test.mjs is written, and against
// the REAL netlify/functions/api.mjs handler rather than the module, so a
// handler that is not registered in ROUTES fails here too. A file under api/ is
// not a route; that has shipped broken twice.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("read/finance-os", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler;
  let clientA, clientB;
  let tokClientA, tokStaff, tokAffiliate;

  const MARK = "financeosread";
  const call = async (path, token) =>
    handler(new Request("https://x" + path, {
      headers: token ? { authorization: "Bearer " + token, host: "x" } : { host: "x" }
    }), {});
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    const mkClient = async (n) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'FinanceOs',$2,$3) RETURNING id`,
      [org, n, `${MARK}.${n}@example.com`.toLowerCase()])).rows[0].id;
    clientA = await mkClient("Alpha");
    clientB = await mkClient("Bravo");

    // Alpha's book covers every case the view module has to survive: a normal
    // card, an unknown limit, an unknown balance, a zero limit, a real zero
    // balance, an over-limit card, and a closed line that must not appear.
    await db.query(
      `INSERT INTO tradelines
         (org_id, client_id, lender, kind, credit_limit_cents, balance_cents, apr, source, closed_at)
       VALUES
         ($1,$2,'Alpha Normal',    'revolving', 1500000, 300000, 0.1899,'crs',   NULL),
         ($1,$2,'Alpha No Limit',  'revolving',    NULL, 425000, 0.2249,'crs',   NULL),
         ($1,$2,'Alpha No Balance','revolving',  800000,   NULL, NULL,  'manual',NULL),
         ($1,$2,'Alpha Zero Limit','revolving',       0,      0, NULL,  'manual',NULL),
         ($1,$2,'Alpha Zero Bal',  'revolving',  500000,      0, 0.1599,'crs',   NULL),
         ($1,$2,'Alpha Over',      'revolving',  200000, 236000, 0.2699,'crs',   NULL),
         ($1,$2,'Alpha Closed',    'revolving',  100000,      0, 0.1000,'crs',   now())`,
      [org, clientA]
    );
    // Bravo's card exists only so that a leak is detectable by name.
    await db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, kind, credit_limit_cents, balance_cents, source)
       VALUES ($1,$2,'BRAVO SECRET CARD','revolving',9900000,1234500,'crs')`,
      [org, clientB]
    );

    const s = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org])).rows[0];
    tokStaff = (await createSession(db, { staffId: s.id, orgId: s.org_id })).token;

    const acct = async (kind, email, subject) => {
      const a = await createAccount(db, {
        orgId: org, kind, email, password: "a-long-enough-password-1",
        invitedBy: s.id, ...subject
      });
      return (await createAccountSession(db, { accountId: a.id, orgId: org })).token;
    };
    tokClientA = await acct("client", `${MARK}.clienta@example.com`, { clientId: clientA });

    const aff = (await db.query(
      `INSERT INTO affiliates (org_id, name, tracking_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} aff`, `${MARK}-aff`])).rows[0].id;
    tokAffiliate = await acct("affiliate", `${MARK}.aff@example.com`, { affiliateId: aff });
  });

  async function purge() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const cids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    if (cids.length) {
      await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [cids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [cids]);
    }
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}%`]);
  }

  after(async () => { await purge(); await close(); });

  /* ── the endpoint is reachable at all ─────────────────────────────────────
     A handler absent from the ROUTES map in netlify/functions/api.mjs 404s
     with error:"not_found" both locally and deployed. */

  test("the handler is registered in ROUTES — it is not a 404", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokStaff);
    assert.notEqual(r.status, 404, "read/finance-os is missing from the ROUTES map");
    assert.equal(r.status, 200);
  });

  /* ── the gap this closes ──────────────────────────────────────────────────
     api/read/tradelines.mjs is staff-only, so a signed-in client on the
     Finance OS screen saw "your account is not permitted to view your cards". */

  test("a client reads their OWN cards", async () => {
    const r = await call("/api/read/finance-os", tokClientA);
    assert.equal(r.status, 200, "a signed-in client still cannot read their own cards");
    const body = await json(r);
    assert.ok(body.items.length > 0, "the client saw none of their own rows");
    assert.ok(body.items.every((i) => i.client_id === clientA));
  });

  /* ── isolation: the assertions that matter ───────────────────────────────── */

  test("a client CANNOT read another client's cards by naming them in the query", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientB}`, tokClientA);
    assert.equal(r.status, 200);
    const body = await json(r);
    assert.ok(body.items.every((i) => i.client_id === clientA),
      "?client_id= widened a client's scope to somebody else's credit balances");
    const leaked = body.items.some((i) => String(i.lender).includes("BRAVO SECRET"));
    assert.equal(leaked, false, "another client's card leaked through the query string");
  });

  test("an anonymous caller reads nothing", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`);
    assert.ok(r.status === 401 || r.status === 403, "expected a refusal, got " + r.status);
  });

  test("an affiliate — a kind this endpoint does not serve — is refused", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokAffiliate);
    assert.ok(r.status === 401 || r.status === 403, "expected a refusal, got " + r.status);
  });

  /* ── the payload the screen depends on ───────────────────────────────────── */

  test("staff must name a client — this is not a firehose of everybody's balances", async () => {
    const r = await call("/api/read/finance-os", tokStaff);
    assert.equal(r.status, 400);
  });

  test("closed lines are excluded — the screen answers 'what am I using now'", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokStaff);
    const body = await json(r);
    assert.equal(body.items.some((i) => i.lender === "Alpha Closed"), false);
    assert.equal(body.items.length, 6);
  });

  test("NULL limit and NULL balance survive the wire as null, not as 0", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokStaff);
    const body = await json(r);
    const noLimit = body.items.find((i) => i.lender === "Alpha No Limit");
    const noBalance = body.items.find((i) => i.lender === "Alpha No Balance");
    assert.equal(noLimit.credit_limit_cents, null, "an unknown limit arrived as something other than null");
    assert.equal(noBalance.balance_cents, null, "an unknown balance arrived as something other than null");
    // and a real zero is still a real zero on the other side of the wire
    const zeroBal = body.items.find((i) => i.lender === "Alpha Zero Bal");
    assert.equal(Number(zeroBal.balance_cents), 0);
    assert.notEqual(zeroBal.balance_cents, null);
  });

  test("the four §8 fields are present on every row", async () => {
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokStaff);
    const body = await json(r);
    body.items.forEach((i) => {
      ["lender", "credit_limit_cents", "balance_cents"].forEach((k) => {
        assert.ok(k in i, "missing " + k + " — the screen renders it");
      });
    });
  });

  test("the view module turns this exact payload into the right screen", async () => {
    // The endpoint and the view module are tested apart everywhere else. This
    // is the one place they meet, against real Postgres rows.
    const { buildCards } = await import("./finance-os-view.mjs");
    const r = await call(`/api/read/finance-os?client_id=${clientA}`, tokStaff);
    const out = buildCards({ status: r.status, body: await json(r) });

    assert.equal(out.state.live, true);
    assert.equal(out.cards.length, 6);

    const by = (n) => out.cards.find((c) => c.issuer === n);
    assert.equal(by("Alpha No Limit").utilizationText, "—");
    assert.equal(by("Alpha No Limit").whyUnknown, "no credit limit on file");
    assert.equal(by("Alpha No Balance").utilizationText, "—");
    assert.equal(by("Alpha Zero Limit").whyUnknown, "credit limit is zero");
    assert.equal(by("Alpha Zero Bal").utilizationText, "0%", "a real zero must not be blanked");
    assert.equal(by("Alpha Over").utilizationText, "118%");
    assert.equal(by("Alpha Over").overLimit, true);
    assert.equal(by("Alpha Normal").utilizationText, "20%");

    // Totals exclude the three uncountable cards AND say so.
    assert.equal(out.totals.countedCount, 3);
    assert.equal(out.totals.excludedCount, 3);
    assert.match(out.totals.caveat, /3 of 6 cards left out/);
  });
});
