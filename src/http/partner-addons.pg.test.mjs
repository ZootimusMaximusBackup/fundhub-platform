// Postgres-backed tests for /api/partner-addons.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing. This
// endpoint asks a partner for money and puts them on a monthly cycle.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12). The handler is imported
// from here instead, inside before() so the skip is a real skip.
//
// WHAT IT ASSERTS. The gate, the org boundary, and the fact that "buy" writes an
// ASK and not an arrangement. The purchase mechanics themselves are proved in
// src/subscriptions/partner-addons.pg.test.mjs; repeating them here would be a
// second copy of the same claim.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG_A = "addons-http-test-a";
const SLUG_B = "addons-http-test-b";
const ENV = { COMMAS_CHECKOUT_BASE_URL: "https://pay.example.test/checkout" };

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/partner-addons", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, orgA, orgB, partnerA, partnerB, ownerToken, closerToken;

  const call = async (method, payload, token = ownerToken) => {
    const r = res();
    const req = {
      method,
      headers: token ? { authorization: "Bearer " + token } : {},
      query: method === "GET" ? payload : {},
      body: method === "POST" ? payload : {}
    };
    await handler(req, r, { env: ENV });
    return r;
  };

  const mkOrg = async (slug, name) => {
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [slug]).catch(() => {});
    return (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name, slug]
    )).rows[0].id;
  };

  before(async () => {
    if (!HAVE_DB) return;
    handler = (await import("../../api/partner-addons.mjs")).default;

    /* orgA IS THE DEFAULT ORG, ON PURPOSE AND AS A FINDING. 271 seeded the three
       add-ons into `products` only `WHERE o.is_default`, so an org without those
       rows cannot buy one at all — createPaymentLink refuses a product code that
       is not in the org, which is correct (a link built off a dangling code
       cannot be matched back to anything) and means partner add-ons are, today,
       a default-org feature. Testing against a made-up org would have hidden
       that behind a fixture. Recorded, not worked around. */
    orgA = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
    assert.ok(orgA, "no default org — the add-on products are seeded there");
    orgB = await mkOrg("addons-http-org-b", "Add-ons HTTP B");

    for (const [org, slug] of [[orgA, SLUG_A], [orgB, SLUG_B]]) {
      await db.query(`DELETE FROM subscriptions WHERE partner_id IN (SELECT id FROM partners WHERE slug = $1 AND org_id = $2)`, [slug, org]);
      await db.query(`DELETE FROM payment_links WHERE partner_id IN (SELECT id FROM partners WHERE slug = $1 AND org_id = $2)`, [slug, org]);
      await db.query(`DELETE FROM partners WHERE slug = $1 AND org_id = $2`, [slug, org]);
    }
    partnerA = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status) VALUES ($1,'A partner',$2,'active') RETURNING id`,
      [orgA, SLUG_A]
    )).rows[0].id;
    partnerB = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status) VALUES ($1,'B partner',$2,'active') RETURNING id`,
      [orgB, SLUG_B]
    )).rows[0].id;

    /* Reuse the row if a previous run left one. staff carries a unique index on
       (org_id, lower(email)), and a plain INSERT makes the second run of this
       file fail in before() — where the failure reads as "every test was
       cancelled" rather than as "the fixture already exists". */
    const mkStaff = async (org, role, email) => {
      const found = await db.query(
        `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`, [org, email]
      );
      if (found.rows[0]) {
        await db.query(`UPDATE staff SET role = $2, status = 'active' WHERE id = $1`, [found.rows[0].id, role]);
        return found.rows[0].id;
      }
      return (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `addons ${role}`, role, email]
      )).rows[0].id;
    };
    const ownerId = await mkStaff(orgA, "owner", "addons_http_owner@example.com");
    const closerId = await mkStaff(orgA, "closer", "addons_http_closer@example.com");
    ownerToken = (await createSession(db, { staffId: ownerId, orgId: orgA })).token;
    closerToken = (await createSession(db, { staffId: closerId, orgId: orgA })).token;
  });

  after(async () => {
    if (!HAVE_DB) return;
    for (const p of [partnerA, partnerB].filter(Boolean)) {
      await db.query(`DELETE FROM subscriptions WHERE partner_id = $1`, [p]);
      await db.query(`DELETE FROM payment_links WHERE partner_id = $1`, [p]);
      await db.query(`DELETE FROM partners WHERE id = $1`, [p]);
    }
    await close();
  });

  test("a closer cannot reach it — this is not a client sale", async () => {
    const r = await call("GET", { partner_id: partnerA }, closerToken);
    assert.equal(r.code, 403);
  });

  test("signed out is refused", async () => {
    const r = await call("GET", { partner_id: partnerA }, null);
    assert.ok(r.code === 401 || r.code === 403, `expected a refusal, got ${r.code}`);
  });

  test("another org's partner is invisible, not a 404 fishing hole", async () => {
    const r = await call("GET", { partner_id: partnerB });
    assert.equal(r.code, 403);
  });

  test("the menu comes back with three add-ons and formatted prices", async () => {
    const r = await call("GET", { partner_id: partnerA });
    assert.equal(r.code, 200);
    assert.equal(r.body.catalog.length, 3);
    const ci = r.body.catalog.find((c) => c.code === "creative-intelligence");
    // A STRING, not a float: 19.90 as a JavaScript number is not 19.90.
    assert.equal(ci.price_display, "297.00");
    assert.equal(ci.status, "available");
  });

  test("buy writes an ask and says out loud that nothing was charged", async () => {
    const r = await call("POST", {
      partner_id: partnerA, action: "buy", add_on: "creative-intelligence"
    });
    assert.equal(r.code, 200);
    assert.equal(r.body.link.partner_id, partnerA);
    assert.equal(r.body.link.client_id, null);
    assert.equal(r.body.amount_display, "297.00");
    assert.match(r.body.note, /Nothing is charged yet/);
    // And no arrangement exists yet.
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM subscriptions WHERE partner_id = $1`, [partnerA]
    )).rows[0].n;
    assert.equal(n, 0);
  });

  test("activate refuses an ask that has not been paid", async () => {
    const link = (await db.query(
      `SELECT id FROM payment_links WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 1`, [partnerA]
    )).rows[0];
    const r = await call("POST", {
      partner_id: partnerA, action: "activate", payment_link_id: link.id
    });
    assert.equal(r.code, 409);
    assert.equal(r.body.error, "not_paid");
  });

  test("activate reconciles a paid ask a missing webhook left behind", async () => {
    const link = (await db.query(
      `SELECT id FROM payment_links WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 1`, [partnerA]
    )).rows[0];
    await db.query(
      `UPDATE payment_links SET status = 'paid', paid_at = now() WHERE id = $1`, [link.id]
    );
    const r = await call("POST", {
      partner_id: partnerA, action: "activate", payment_link_id: link.id
    });
    assert.equal(r.code, 200);
    assert.equal(r.body.activated, true);
    assert.equal(r.body.subscription.tier, "creative-intelligence");
    assert.equal(r.body.subscription.price_display, "297.00");
  });

  test("buying the same add-on twice is a 409, not a second monthly bill", async () => {
    const r = await call("POST", {
      partner_id: partnerA, action: "buy", add_on: "creative-intelligence"
    });
    assert.equal(r.code, 409);
  });

  test("Lead Flow without a unit count is refused, and 0 units is not an ask for $0", async () => {
    const none = await call("POST", { partner_id: partnerA, action: "buy", add_on: "lead-flow" });
    assert.equal(none.code, 400);
    const zero = await call("POST", { partner_id: partnerA, action: "buy", add_on: "lead-flow", units: 0 });
    assert.equal(zero.code, 400);
  });

  test("cancel names the add-on, and a partner not on it gets a 404", async () => {
    const missing = await call("POST", {
      partner_id: partnerA, action: "cancel", add_on: "dfy-marketing"
    });
    assert.equal(missing.code, 404);

    const done = await call("POST", {
      partner_id: partnerA, action: "cancel", add_on: "creative-intelligence"
    });
    assert.equal(done.code, 200);
    assert.ok(done.body.subscription.cancelled_at);
    assert.ok(done.body.subscription.effective_to, "a cancelled row must close");
  });

  test("a body cannot choose the org", async () => {
    const r = await call("POST", {
      partner_id: partnerA, action: "buy", add_on: "dfy-marketing", org_id: orgB
    });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
  });

  test("an unknown action and a bad method are both named", async () => {
    const bad = await call("POST", { partner_id: partnerA, action: "refund" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.error, "invalid_action");

    const r = res();
    await handler({ method: "DELETE", headers: { authorization: "Bearer " + ownerToken }, query: {}, body: {} }, r, { env: ENV });
    assert.equal(r.code, 405);
  });
});
