/* GET /api/inquiries?recent=letters — the role gate, against a real database.
 *
 * src/http/inquiries-recent-letters.test.mjs proves the same gate with a stub
 * session row and no Postgres. This file proves the part a stub cannot: that a
 * REAL session, minted for a REAL staff row with a REAL role, is refused — and
 * that the refusal is a refusal and not an empty table. The specialist reads the
 * very same letter row back in the same run, so a 403 that happened to coincide
 * with "there was nothing to see" cannot pass here.
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs. The handler is
 * imported inside before() so the skip is a real skip.
 *
 * ⚠️ UNDER src/ ON PURPOSE. npm test's glob is "src/**" and "scripts/**" only.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinels. Everything this file creates carries one, and the purge runs in
// before() as well as after(): a crashed previous run must not collide with
// idx_staff_email_org.
const STAFF_EMAIL_LIKE = "inqletters_pg_test%@example.com";
const CLIENT_EMAIL = "inqletters.pg.test@example.com";
const CLIENT_EMAIL_LIKE = "inqletters.pg.test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("GET /api/inquiries?recent=letters — the role gate, on Postgres",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {

  let handler, org, clientId, inquiryId;
  const tokens = {};

  // Every role that can reach public/app/inquiry-remover.html from the shared
  // staff sidebar, plus the four the desk belongs to.
  const ROLES = ["inquiry_specialist", "funding_advisor", "admin", "owner", "setter", "closer", "sales_manager"];
  const ALLOWED = new Set(["inquiry_specialist", "funding_advisor", "admin", "owner"]);

  const call = async (tok, query) => {
    const r = res();
    await handler({
      method: "GET",
      query: query,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
    if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/inquiries.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    let sender = null;
    for (const role of ROLES) {
      const staffId = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, "Inqletters " + role, role, `inqletters_pg_test_${role}@example.com`]
      )).rows[0].id;
      tokens[role] = (await createSession(db, { staffId, orgId: org })).token;
      if (role === "inquiry_specialist") sender = staffId;
    }

    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Inqletters','Pgtest',$2) RETURNING id`,
      [org, CLIENT_EMAIL])).rows[0].id;

    inquiryId = (await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status, call_attempts)
       VALUES ($1,$2,'EQ','Synchrony inqletters','New',0) RETURNING id`,
      [org, clientId])).rows[0].id;

    // The row the block renders: a letter that actually went out.
    await db.query(
      `INSERT INTO inquiry_attempts (org_id, inquiry_id, staff_id, kind, outcome)
       VALUES ($1,$2,$3,'letter','queued_for_delivery')`,
      [org, inquiryId, sender]);
  });

  after(async () => {
    await purge();
    await close();
  });

  test("the specialist reads the letter — so the row is really there", async () => {
    const r = await call(tokens.inquiry_specialist, { recent: "letters" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const mine = r.body.letters.filter((l) => l.client_name === "Inqletters Pgtest");
    assert.equal(mine.length, 1, "the fixture letter did not come back");
    assert.equal(mine[0].bureau, "EQ");
    assert.equal(mine[0].kind, "letter");
  });

  for (const role of ROLES.filter((r) => !ALLOWED.has(r))) {
    test(`a ${role} with a real session is refused that same row`, async () => {
      const r = await call(tokens[role], { recent: "letters" });
      assert.equal(r.code, 403,
        `a ${role} was served the company's dispute letters: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.letters, undefined);
      assert.equal(JSON.stringify(r.body).includes("Inqletters Pgtest"), false,
        `a ${role} was told a client's name in the refusal`);
    });

    test(`a ${role} can still expand one row's history — no over-gating`, async () => {
      const r = await call(tokens[role], { inquiry_id: inquiryId });
      assert.equal(r.code, 200, `the untouched GET branch was gated for a ${role}`);
      assert.ok(Array.isArray(r.body.attempts));
    });
  }

  for (const role of ROLES.filter((r) => ALLOWED.has(r))) {
    test(`a ${role} works this desk and is served`, async () => {
      const r = await call(tokens[role], { recent: "letters" });
      assert.equal(r.code, 200, `a ${role} was refused: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.letters));
    });
  }

  test("no session is a 401, not a 403 — sign in and not-allowed are different answers", async () => {
    const r = await call(null, { recent: "letters" });
    assert.equal(r.code, 401);
  });
});
