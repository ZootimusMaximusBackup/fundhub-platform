/* T10 unit B — a partner's brand must come back out the way it went in.
 *
 * THE DEFECT THIS PINS. partner_brand.entity_address has existed since
 * db/migrations/043_partner_brand.sql and "entity_address" has always been in
 * WRITABLE in api/partner-brand.mjs. But v_partner_brand_effective — the only
 * thing either branch of that handler selects from — never listed the column.
 * So a partner could save their business address, get a 200 back, and never see
 * that address again on any screen or from any read. Write-only storage, with
 * no error anywhere to say so.
 *
 * db/migrations/236_partner_brand_effective_address.sql adds the column to the
 * view. THE FIRST TEST BELOW FAILS WITHOUT 236 AND PASSES WITH IT — it reads the
 * address back through the real handler, not through the table.
 *
 * The second group is the gate, re-asserted here because the round-trip is the
 * thing that would tempt someone to widen it: a partner reaches their OWN brand
 * and nobody else's.
 *
 * WHY THIS FILE LIVES UNDER src/http/. package.json's test glob is "src/**" and
 * "scripts/**" only; a test under api/ is silently never collected. Same reason
 * src/http/partner-brand-read-gate.test.mjs sits here.
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs.
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createAccount, loginAccount } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/partner-brand.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "brand-roundtrip";
const PW = "brand-roundtrip-password-for-tests";
const ADDRESS = "1200 Main St Suite 400, Phoenix, AZ 85004";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/partner-brand round-trip", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId, ownerToken, partnerA, partnerB, tokenA;

  const call = async ({ method, body, query = {}, token } = {}) => {
    const r = res();
    await handler(
      { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} },
      r
    );
    return r;
  };

  async function wipe() {
    await db.query(
      `DELETE FROM account_sessions WHERE account_id IN
         (SELECT id FROM accounts WHERE email LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(
      `DELETE FROM partner_brand WHERE partner_id IN
         (SELECT id FROM partners WHERE slug LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${TAG}%`]);
  }

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await wipe();
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}%`]);

    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Roundtrip Owner','owner','active') RETURNING id`,
      [org, `${TAG}-owner@example.com`])).rows[0].id;
    ownerToken = (await createSession(db, { staffId, orgId: org })).token;

    const mkPartner = async (n) => (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${TAG} ${n}`, `${TAG}-${n}`])).rows[0].id;
    partnerA = await mkPartner("a");
    partnerB = await mkPartner("b");

    // A real partner PRINCIPAL — an account row plus a login, not a staff token.
    // 044's signup policy makes 'partner' invite-only, so this is created the
    // way seed-role-accounts.mjs creates one: invited by a staff id.
    await createAccount(db, {
      orgId: org, kind: "partner", email: `${TAG}-a@example.com`, password: PW,
      partnerId: partnerA, invitedBy: staffId
    });
    tokenA = (await loginAccount(db, { email: `${TAG}-a@example.com`, password: PW })).token;
  });

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}%`]);
    await close();
  });

  // ── the round-trip ──────────────────────────────────────────────────────

  test("a partner saves a business address and reads the same address back", async () => {
    const put = await call({
      method: "PUT", token: tokenA,
      body: { partner_id: partnerA, entity_name: "Roundtrip Co", entity_address: ADDRESS }
    });
    assert.equal(put.code, 200, JSON.stringify(put.body));
    assert.equal(put.body.ok, true);

    // The PUT's own answer must already carry it. Before 236 this key was simply
    // absent from the view's row, so the screen had nothing to repaint with even
    // immediately after a successful save.
    assert.equal(put.body.brand.entity_address, ADDRESS,
      "the save's own response dropped the address — the view is not selecting entity_address");

    // And a fresh read — what a reload of Brand Studio actually does.
    const get = await call({ method: "GET", token: tokenA, query: { partner_id: partnerA } });
    assert.equal(get.code, 200, JSON.stringify(get.body));
    assert.equal(get.body.brand.entity_address, ADDRESS,
      "the address went in and did not come back — entity_address is write-only again");
  });

  test("the stored row and the effective view agree on the address", async () => {
    await call({
      method: "PUT", token: tokenA,
      body: { partner_id: partnerA, entity_address: ADDRESS }
    });
    const stored = (await db.query(
      `SELECT entity_address FROM partner_brand WHERE partner_id = $1`, [partnerA])).rows[0];
    const view = (await db.query(
      `SELECT entity_address FROM v_partner_brand_effective WHERE partner_id = $1`,
      [partnerA])).rows[0];
    assert.equal(stored.entity_address, ADDRESS);
    assert.equal(view.entity_address, ADDRESS,
      "v_partner_brand_effective is missing entity_address — migration 236 has not run");
  });

  test("every writable field the endpoint accepts is readable back", async () => {
    /* The general form of the bug. A name added to WRITABLE but not to the view
       is write-only storage, and nothing errors when that happens. partner_id is
       the addressing key, not a brand field, so it is excluded. */
    const sent = {
      partner_id: partnerA,
      wordmark_url: "https://example.com/mark.svg",
      ink: "#123456", paper: "#ABCDEF",
      ramp: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
      display_face: "Inter", mono_face: "JetBrains Mono",
      voice: "plain",
      entity_name: "Roundtrip Co", entity_address: ADDRESS,
      support_email: "hello@example.com", domain: "brand.example.com",
      selected_funnels: ["apply"]
    };
    const put = await call({ method: "PUT", token: tokenA, body: sent });
    assert.equal(put.code, 200, JSON.stringify(put.body));

    const got = (await call({ method: "GET", token: tokenA, query: { partner_id: partnerA } }))
      .body.brand;
    const missing = Object.keys(sent)
      .filter((k) => k !== "partner_id")
      .filter((k) => !(k in got));
    assert.deepEqual(missing, [],
      "these fields can be written but never read: " + missing.join(", "));
  });

  test("a partner with no brand row still reads, with no address on file", async () => {
    /* NULL means "we do not have one" and must survive as NULL, all the way to
       the screen: an empty box a partner can fill, never a made-up address and
       never a blank that hides a real one. (Migration 043 says this field is
       INTENDED for the BS-05 disclosure template. Nothing injects it there
       today, so do not describe it as feeding any disclosure.) */
    const r = await call({ method: "GET", token: ownerToken, query: { partner_id: partnerB } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.ok("entity_address" in r.body.brand, "the key must be present even when empty");
    assert.equal(r.body.brand.entity_address, null);
  });

  // ── the gate, re-asserted around the round-trip ─────────────────────────

  test("a partner reaches their OWN brand and no other partner's", async () => {
    const mine = await call({ method: "GET", token: tokenA, query: { partner_id: partnerA } });
    assert.equal(mine.code, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.brand.partner_id, partnerA);

    const theirs = await call({ method: "GET", token: tokenA, query: { partner_id: partnerB } });
    assert.equal(theirs.code, 403, "a partner read a rival partner's brand");
    assert.equal(theirs.body.error, "forbidden");
  });

  test("a partner cannot WRITE another partner's brand either", async () => {
    const r = await call({
      method: "PUT", token: tokenA,
      body: { partner_id: partnerB, entity_address: "999 Not Mine Ave" }
    });
    assert.equal(r.code, 403, "a partner wrote a rival partner's address");
    const row = (await db.query(
      `SELECT count(*)::int AS n FROM partner_brand WHERE partner_id = $1`, [partnerB])).rows[0];
    assert.equal(row.n, 0, "the refused write still created a row");
  });

  test("an unsigned caller gets 401, not a brand", async () => {
    const r = await call({ method: "GET", query: { partner_id: partnerA } });
    assert.equal(r.code, 401);
  });
});
