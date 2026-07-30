// Can a signed-in principal read their OWN data, and only their own?
//
// src/partners/scope.mjs was written as the tenancy boundary, mutation-tested,
// documented as verified — and imported by ZERO production modules. That was
// recorded as a security finding, but its actual effect was the opposite of
// dangerous: no endpoint admitted a non-staff principal at all, so a client or
// partner could sign in and then read nothing. client-portal and partner-galaxy
// showed a signed-in principal a wireframe.
//
// Now that two endpoints do admit principals, these are the tests that have to
// hold. They are written adversarially: the interesting assertions are the ones
// where a principal tries to see somebody else's rows.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";
import { grant } from "../entitlements/entitlements.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CODE = "metro2-letter-pack";

describe("principal reads", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler;
  let clientA, clientB, partnerA, partnerB;
  let tokClientA, tokPartnerA, tokStaff, tokAffiliate;

  const MARK = "principalread";
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
       VALUES ($1,'Principal',$2,$3) RETURNING id`,
      [org, n, `${MARK}.${n}@example.com`.toLowerCase()])).rows[0].id;
    clientA = await mkClient("Alpha");
    clientB = await mkClient("Bravo");

    const mkPartner = async (n) => (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} ${n}`, `${MARK}-${n}`.toLowerCase()])).rows[0].id;
    partnerA = await mkPartner("Alpha");
    partnerB = await mkPartner("Bravo");

    await grant(db, { orgId: org, clientId: clientA, code: CODE });
    await grant(db, { orgId: org, clientId: clientB, code: CODE });

    // The inviter has to be a real staff row — partner accounts are invite-only
    // and accounts.invited_by is a foreign key.
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
    tokPartnerA = await acct("partner", `${MARK}.partnera@example.com`, { partnerId: partnerA });

    // An affiliate: a kind neither endpoint serves. Must be refused by BOTH.
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
      await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
      try { await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [cids]); }
      finally { await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`); }
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [cids]);
    }
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}%`]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${MARK}%`]);
  }

  after(async () => { await purge(); await close(); });

  // ── the gap this closes: a principal can now read their own data ───────────

  test("a client reads their own entitlements", async () => {
    const r = await call("/api/read/entitlements", tokClientA);
    assert.equal(r.status, 200, "a signed-in client still cannot read the portal");
    const body = await json(r);
    assert.ok(body.items.length > 0, "the client saw none of their own rows");
    assert.ok(body.items.every((i) => i.client_id === clientA));
  });

  test("a partner reads their own row", async () => {
    const r = await call("/api/read/partners", tokPartnerA);
    assert.equal(r.status, 200);
    const body = await json(r);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].id, partnerA);
  });

  // ── isolation: the assertions that matter ─────────────────────────────────

  test("a client CANNOT widen the scope by editing the query string", async () => {
    const r = await call(`/api/read/entitlements?client_id=${clientB}`, tokClientA);
    assert.equal(r.status, 200);
    const body = await json(r);
    assert.ok(body.items.every((i) => i.client_id === clientA),
      "?client_id= let a client read another client's entitlements");
    assert.ok(!body.items.some((i) => i.client_id === clientB));
  });

  test("a partner cannot see another partner, by any query string", async () => {
    for (const qs of ["", "?status=active", `?status=`, "?limit=200"]) {
      const body = await json(await call("/api/read/partners" + qs, tokPartnerA));
      assert.ok(!(body.items || []).some((p) => p.id === partnerB),
        `partner B leaked with ${qs || "(no query)"}`);
    }
  });

  test("staff still see everything", async () => {
    const parts = await json(await call("/api/read/partners?limit=200", tokStaff));
    const ids = parts.items.map((p) => p.id);
    assert.ok(ids.includes(partnerA) && ids.includes(partnerB),
      "the partner scope leaked onto staff, who should see the whole book");
  });

  // ── kinds an endpoint does not name are still refused ─────────────────────

  test("an affiliate is refused by both endpoints", async () => {
    for (const path of ["/api/read/entitlements", "/api/read/partners"]) {
      const r = await call(path, tokAffiliate);
      assert.equal(r.status, 403, `${path} admitted an affiliate`);
    }
  });

  test("a client is refused by the partner endpoint, and vice versa", async () => {
    assert.equal((await call("/api/read/partners", tokClientA)).status, 403);
    assert.equal((await call("/api/read/entitlements", tokPartnerA)).status, 403);
  });

  test("no session is still 401 on both", async () => {
    for (const path of ["/api/read/entitlements", "/api/read/partners"]) {
      assert.equal((await call(path, null)).status, 401, path);
    }
  });

  test("endpoints that named no principals still admit staff only", async () => {
    // read/commissions did not opt in; a client must not reach it.
    const r = await call("/api/read/commissions", tokClientA);
    assert.ok([401, 403].includes(r.status), `commissions admitted a client: ${r.status}`);
  });

  test("a revoked session stops working immediately", async () => {
    const { revokeAccountSession } = await import("../auth/account-session.mjs");
    const before = await call("/api/read/entitlements", tokClientA);
    assert.equal(before.status, 200);
    await revokeAccountSession(db, tokClientA);
    assert.equal((await call("/api/read/entitlements", tokClientA)).status, 401);
  });
});
