// Postgres-backed tests for POST /api/public/education-enroll.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running (CLAUDE.md §12). The
// handler is imported from here instead.
//
// WHAT THESE ASSERT AGAINST. The claim that matters is "a row exists", so the
// happy path reads education_enrollments back. The whole reason this endpoint
// was written is that the page used to report success while storing nothing —
// a response body is only the endpoint's account of itself, and that account
// was a lie for months. The refusals are checked the same way: the row count
// must not move.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handler is
// imported inside before() rather than at module scope so the skip is a real
// skip — a top-level import runs even when the suite does not.
//
// Run it against a scratch database:
//   DATABASE_URL="postgres://…/fundhub_scratch" node --test src/http/education-enroll.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinel address. Everything this file creates carries it, and the purge runs
// before() as well as after() so a crashed previous run cannot collide.
const EMAIL = "edu.enroll.pg.test@example.com";
const EMAIL_LIKE = "edu.enroll.pg.test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("POST /api/public/education-enroll", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler;

  const call = async (body, method = "POST") => {
    const r = res();
    await handler({ method, query: {}, body, headers: {} }, r);
    return r;
  };

  const rows = async () => (await db.query(
    `SELECT * FROM education_enrollments WHERE lower(email) LIKE $1 ORDER BY created_at ASC`,
    [EMAIL_LIKE]
  )).rows;

  const salesCards = async () => (await db.query(
    `SELECT ps.key AS stage_key
       FROM cards cd
       JOIN clients c ON c.id = cd.client_id
       JOIN pipelines p ON p.id = cd.pipeline_id
       JOIN pipeline_stages ps ON ps.id = cd.stage_id
      WHERE lower(c.email) LIKE $1 AND p.key = 'sales'`,
    [EMAIL_LIKE]
  )).rows;

  async function purge() {
    await db.query(
      `DELETE FROM cards WHERE client_id IN (SELECT id FROM clients WHERE lower(email) LIKE $1)`,
      [EMAIL_LIKE]
    );
    await db.query(`DELETE FROM education_enrollments WHERE lower(email) LIKE $1`, [EMAIL_LIKE]);
    await db.query(`DELETE FROM clients WHERE lower(email) LIKE $1`, [EMAIL_LIKE]);
  }

  before(async () => {
    handler = (await import("../../api/public/education-enroll.mjs")).default;
    await purge();
  });

  after(async () => {
    await purge();
    await close();
  });

  test("happy path stores a row", async () => {
    const r = await call({
      program: "credit-mastery",
      full_name: "Edu Test",
      email: EMAIL,
      phone: "5555550123",
      sms_consent: true,
      page_url: "https://fundhub.ai/education/enroll/"
    });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);

    const found = await rows();
    assert.equal(found.length, 1);
    assert.equal(found[0].program, "credit-mastery");
    assert.equal(found[0].email, EMAIL);
    assert.equal(found[0].full_name, "Edu Test");
    assert.equal(found[0].sms_consent, true);
    // A request is not a payment. Nothing here may report otherwise.
    assert.equal(found[0].status, "pending_payment");
    assert.ok(found[0].org_id, "org_id must be stamped");
  });

  // Hole 6: the row existed for months while the Sales board stayed empty, so
  // nobody worked the lead. The card is the claim, not the response body.
  test("the enrollment puts a card on the Sales board", async () => {
    const cards = await salesCards();
    assert.equal(cards.length, 1, "one Sales card for the enrolled person");
    assert.equal(cards[0].stage_key, "new_lead");
  });

  test("an unknown program is refused and stores nothing", async () => {
    const before_ = (await rows()).length;
    const r = await call({
      program: "not-a-real-program",
      full_name: "Edu Test",
      email: EMAIL
    });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "unknown_program");
    assert.equal((await rows()).length, before_, "a refused request must not write");
  });

  test("a missing email is refused and stores nothing", async () => {
    const before_ = (await rows()).length;
    const r = await call({ program: "capital-strategy", full_name: "Edu Test" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "email_required");
    assert.equal((await rows()).length, before_, "a refused request must not write");
  });

  test("anything but POST is 405", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const r = await call({}, method);
      assert.equal(r.code, 405, method + " must not be accepted");
      assert.equal(r.headers.allow, "POST");
    }
  });
});
