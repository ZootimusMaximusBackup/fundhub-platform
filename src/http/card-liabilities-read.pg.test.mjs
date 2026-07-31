// GET /api/read/card-liabilities — the endpoint, driven end to end against real
// Postgres with real staff sessions of real roles.
//
// THIS FILE LIVES UNDER src/http/ DELIBERATELY. npm test's glob is "src/**" and
// "scripts/**" only, so a test placed next to the handler under api/ silently
// never runs — the trap that let a whole feature ship unverified twice.
//
// WHAT IT PROVES THAT src/card-liabilities/store.pg.test.mjs CANNOT:
//
//   * the role gate is a real gate. api/read/tradelines.mjs shipped
//     `requireAuth(req, res, { roles: ROLE_SETS.STAFF })`, which reads exactly
//     like one and is not one — requireAuth forwards opts to authenticate(),
//     which reads only { db, env }, so the key is dropped. The effective rule
//     was "any authenticated session, any role" on a response carrying a named
//     client's credit limits. src/http/auth-gate.test.mjs catches that shape in
//     the source; this catches it in behaviour, with a session whose role is
//     outside the set.
//   * NULL survives all the way to the wire. A card with no known limit must
//     arrive at the browser with utilisation null, not 0.
//   * money crosses the wire as integer cents, not as floats.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import handler from "../../api/read/card-liabilities.mjs";
import { upsertCardLiability } from "../card-liabilities/store.mjs";
import { coerceLiabilityRow } from "../card-liabilities/index.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "card_liabilities_http_test@example.com";
const STAFF_EMAIL = "card_liabilities_http_staff@example.com";
const OUTSIDER_ORG_SLUG = "card-liabilities-http-test-org";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

async function call(query, token) {
  const r = res();
  await handler({
    method: "GET",
    query,
    headers: token ? { authorization: "Bearer " + token } : {}
  }, r);
  return r;
}

describe("GET /api/read/card-liabilities", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId, clientId, closerToken, outsiderToken, outsiderStaffId, outsiderOrgId;

  before(async () => {
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Http','Card') RETURNING id`,
      [orgId, EMAIL])).rows[0].id;

    const { createSession } = await import("../auth/session.mjs");

    // An in-set role. `closer` is in ROLE_SETS.STAFF and is NOT a super role, so
    // a passing result here means the set was actually consulted.
    const closer = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id=$1 AND role='closer' AND status='active' LIMIT 1`,
      [orgId])).rows[0];
    assert.ok(closer, "no active closer — run scripts/seed-staff.mjs");
    closerToken = (await createSession(db, { staffId: closer.id, orgId: closer.org_id })).token;

    // An OUT-of-set role. staff.role is nullable with no CHECK against the role
    // catalog, and 036_partner_role.sql seeds a 'partner' role into it, so this
    // is a real session shape rather than a theoretical one.
    //
    // IT LIVES IN ITS OWN NON-DEFAULT ORG, AND THAT IS NOT TIDINESS. Three other
    // suites — campaign-endpoints, conversations-read and inquiries — pick their
    // staff fixture with
    //     SELECT id, org_id FROM staff WHERE org_id = $1 AND status='active' LIMIT 1
    // with no ORDER BY. An extra active staff row in the DEFAULT org is a row
    // any of them can pick up instead of the one they meant, and a session with
    // role='partner' makes their staff-path assertions fail. That is exactly
    // what an earlier draft of this file did: it turned
    // "a staff session without partner_id is refused 400, not 500" red, in a
    // suite this change does not touch, on first runs only. Scoping the fixture
    // to its own org makes it invisible to every org-filtered scan. The org is
    // NOT is_default, so the `WHERE is_default` and `WHERE slug=` lookups the
    // rest of the suite uses cannot see it either.
    await db.query(`DELETE FROM staff WHERE email=$1`, [STAFF_EMAIL]);
    await db.query(`DELETE FROM orgs WHERE slug=$1`, [OUTSIDER_ORG_SLUG]);
    outsiderOrgId = (await db.query(
      `INSERT INTO orgs (slug, name, is_default) VALUES ($1,'Card Liabilities Test Org',false) RETURNING id`,
      [OUTSIDER_ORG_SLUG])).rows[0].id;
    outsiderStaffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,'Outsider','partner','active') RETURNING id`,
      [outsiderOrgId, STAFF_EMAIL])).rows[0].id;
    outsiderToken = (await createSession(db, { staffId: outsiderStaffId, orgId: outsiderOrgId })).token;

    await upsertCardLiability(db, {
      orgId, clientId, accountRef: "http-acct-1",
      row: coerceLiabilityRow({
        accountRef: "http-acct-1", issuer: "Chase Ink Business Preferred", last4: "1004",
        isBusiness: true, creditLimit: 25000, balance: 4137.42,
        statementBalance: 3900, minimumPayment: 117,
        aprPurchase: 18.99, paymentDueDate: "2026-08-15"
      })
    });
    // A card whose limit nobody knows — the row the whole null rule is about.
    await upsertCardLiability(db, {
      orgId, clientId, accountRef: "http-acct-2",
      row: coerceLiabilityRow({ accountRef: "http-acct-2", issuer: "Store Card", balance: 812.5 })
    });
  });

  after(async () => {
    await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
    await db.query(`DELETE FROM sessions WHERE staff_id=$1`, [outsiderStaffId]);
    await db.query(`DELETE FROM staff WHERE email=$1`, [STAFF_EMAIL]);
    await db.query(`DELETE FROM orgs WHERE slug=$1`, [OUTSIDER_ORG_SLUG]);
    await close();
  });

  test("no session is 401", async () => {
    const r = await call({ client_id: clientId }, null);
    assert.equal(r.code, 401);
  });

  test("a session whose role is outside the set is 403 — the gate is real, not a dropped key", async () => {
    const r = await call({ client_id: clientId }, outsiderToken);
    assert.equal(r.code, 403, "an authenticated non-staff-set role must not read a client's card balances");
    assert.equal(r.body.error, "forbidden");
  });

  test("a closer gets the cards", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.length, 2);
  });

  test("client_id is required and must be a uuid", async () => {
    assert.equal((await call({}, closerToken)).code, 400);
    assert.equal((await call({ client_id: "not-a-uuid" }, closerToken)).code, 400);
  });

  test("a non-GET method is refused", async () => {
    const r = res();
    await handler({ method: "POST", query: { client_id: clientId }, headers: {} }, r);
    assert.equal(r.code, 405);
  });

  test("money crosses the wire as integer cents, never as a float", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    const card = r.body.data.find((c) => c.account_ref === "http-acct-1");
    assert.strictEqual(card.credit_limit_cents, 2500000);
    assert.strictEqual(card.balance_cents, 413742);
    assert.strictEqual(card.statement_balance_cents, 390000);
    assert.strictEqual(card.minimum_payment_cents, 11700);
    for (const k of ["credit_limit_cents", "balance_cents", "statement_balance_cents", "minimum_payment_cents"]) {
      assert.ok(Number.isInteger(card[k]), `${k} must be an integer, not a pg string and not a float`);
    }
    assert.strictEqual(card.apr_purchase, 0.1899, "and the APR is a fraction, not a percentage");
  });

  test("a card with an unknown limit reaches the browser as null, NOT 0", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    const card = r.body.data.find((c) => c.account_ref === "http-acct-2");
    assert.strictEqual(card.credit_limit_cents, null);
    assert.strictEqual(card.utilisation, null);
    assert.strictEqual(card.available_cents, null);
    assert.notStrictEqual(card.utilisation, 0, "0% utilised is a different fact from unknown");
  });

  test("a card with a known limit reports its utilisation as a fraction", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    const card = r.body.data.find((c) => c.account_ref === "http-acct-1");
    assert.equal(card.utilisation, 0.1655);
    assert.equal(card.available_cents, 2086258);
  });

  test("the summary refuses a blended utilisation while any card's limit is unknown", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    assert.strictEqual(r.body.summary.all.utilisation, null);
    assert.equal(r.body.summary.all.limitUnknownCount, 1, "and says how many cards it could not count");
    assert.equal(r.body.summary.business.count, 1);
    assert.equal(r.body.summary.unclassified.count, 1, "unclassified is its own bucket, not folded into personal");
    assert.equal(r.body.summary.personal.count, 0);
  });

  test("the three-state classification survives to the wire", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    assert.strictEqual(r.body.data.find((c) => c.account_ref === "http-acct-1").is_business, true);
    assert.strictEqual(r.body.data.find((c) => c.account_ref === "http-acct-2").is_business, null);
  });

  test("a closed card is hidden unless asked for", async () => {
    await db.query(`UPDATE card_liabilities SET closed_at=now() WHERE client_id=$1 AND account_ref=$2`,
      [clientId, "http-acct-2"]);
    assert.equal((await call({ client_id: clientId }, closerToken)).body.data.length, 1);
    assert.equal((await call({ client_id: clientId, include_closed: "true" }, closerToken)).body.data.length, 2);
    await db.query(`UPDATE card_liabilities SET closed_at=NULL WHERE client_id=$1 AND account_ref=$2`,
      [clientId, "http-acct-2"]);
  });

  test("an unlinked card merges to itself, so `merged` means the same thing on every row", async () => {
    const r = await call({ client_id: clientId }, closerToken);
    const card = r.body.data.find((c) => c.account_ref === "http-acct-1");
    assert.ok(card.merged, "every row carries the merged view, linked or not");
    assert.equal(card.merged.creditLimitCents, 2500000);
    assert.equal(card.merged.provenance.creditLimitCents, "bank");
    assert.strictEqual(card.merged.kind, null, "no bureau row, so no bureau-only field");
  });

  test("a LINKED card resolves to one answer, and the bank wins the fields it reported", async () => {
    const tl = (await db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, kind, credit_limit_cents, balance_cents, apr, source)
       VALUES ($1,$2,'CHASE INK','revolving',1800000,999999,0.2499,'crs') RETURNING id`,
      [orgId, clientId])).rows[0];
    await db.query(`UPDATE card_liabilities SET tradeline_id=$1 WHERE client_id=$2 AND account_ref=$3`,
      [tl.id, clientId, "http-acct-1"]);

    const r = await call({ client_id: clientId }, closerToken);
    const m = r.body.data.find((c) => c.account_ref === "http-acct-1").merged;

    // The bureau says the limit is $18,000 at 24.99% and the balance is
    // $9,999.99. The bank says $25,000 at 18.99% and $4,137.42. There is one
    // answer, and it is the bank's.
    assert.equal(m.creditLimitCents, 2500000);
    assert.equal(m.balanceCents, 413742);
    assert.equal(m.aprPurchase, 0.1899);
    assert.equal(m.provenance.balanceCents, "bank");

    // And the bureau still supplies what only the bureau has.
    assert.equal(m.kind, "revolving");
    assert.equal(m.provenance.kind, "crs");
    assert.equal(m.tradelineId, tl.id);

    // Crucially: ONE row, not two. This is the double-count the separate table
    // would otherwise have created.
    assert.equal(r.body.data.length, 2, "two cards, not three — the bureau line is merged, not appended");

    await db.query(`UPDATE card_liabilities SET tradeline_id=NULL WHERE client_id=$1 AND account_ref=$2`,
      [clientId, "http-acct-1"]);
    await db.query(`DELETE FROM tradelines WHERE id=$1`, [tl.id]);
  });

  test("a client with no cards gets an empty list and a null utilisation, not a zero one", async () => {
    // CREATES ITS OWN CLIENT rather than borrowing whichever one is nearest.
    // An earlier draft did `SELECT id FROM clients WHERE id <> $1 LIMIT 1`, and
    // it passed alone and failed whenever src/card-liabilities/store.pg.test.mjs
    // ran alongside it — the row it picked up was that suite's client, which has
    // cards. This repo already carries five order-dependent suites that pass on
    // a second run (see CLAUDE.md §12), and adding a sixth to save four lines is
    // not a trade worth making.
    const emptyEmail = "card_liabilities_http_empty@example.com";
    await db.query(`DELETE FROM clients WHERE email=$1`, [emptyEmail]);
    const empty = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'No','Cards') RETURNING id`,
      [orgId, emptyEmail])).rows[0].id;

    const r = await call({ client_id: empty }, closerToken);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.data, []);
    assert.strictEqual(r.body.summary.all.utilisation, null, "no cards is not 0% utilised");
    assert.equal(r.body.summary.all.count, 0);

    await db.query(`DELETE FROM clients WHERE email=$1`, [emptyEmail]);
  });
});
