// The org boundary on the three endpoints that serve ONE named client's money.
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.
//
// *** WHAT WAS WRONG. ***
//
// api/read/banking-surface.mjs, api/read/finance-os.mjs and
// api/read/tradelines.mjs each took a client_id from the query string and read
// that client's financial detail with no check on which company the caller
// belonged to. All three are gated on ROLE_SETS.STAFF, so the effective rule was:
// any authenticated employee of ANY company could read ANY client's bank
// balances, credit limits, utilisation and APRs, given only that client's id.
//
// The role gate looked like the control. It answers "are you staff" and never
// "are they yours" — the same shape as the `roles` key requireAuth silently
// drops, which is the bug api/read/tradelines.mjs already shipped once.
//
// *** WHY THIS TEST NEEDS A REAL DATABASE. ***
//
// The fix is a query against `clients`, so the thing being asserted is that a row
// in one org is genuinely unreachable from a session in another. A stub would be
// asserting that my own fake returned what I told it to.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import bankingSurface from "../../api/read/banking-surface.mjs";
import financeOs from "../../api/read/finance-os.mjs";
import tradelines from "../../api/read/tradelines.mjs";
import { createSession } from "../auth/session.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

let orgA = null, orgB = null;
let clientOfA = null;
let tokenA = null, tokenB = null;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const asStaff = (token, clientId) => ({
  method: "GET",
  headers: { authorization: "Bearer " + token },
  query: { client_id: clientId }
});

before(async () => {
  if (!HAS_DB) return;

  orgA = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('scope-a', 'Org A')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
  orgB = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('scope-b', 'Org B')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;

  clientOfA = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name)
     VALUES ($1, 'Scope', 'Target') RETURNING id`, [orgA])).rows[0].id;

  // A real bank account, so a leak would return actual money rather than [].
  await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, name, account_type, current_balance_cents)
     VALUES ($1, $2, 'Secret Checking', 'depository', 999900)`, [orgA, clientOfA]);

  const staffA = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'scope-a@example.test', 'A', 'owner', 'active') RETURNING id`, [orgA])).rows[0].id;
  const staffB = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'scope-b@example.test', 'B', 'owner', 'active') RETURNING id`, [orgB])).rows[0].id;

  tokenA = (await createSession(db, { staffId: staffA, orgId: orgA })).token;
  tokenB = (await createSession(db, { staffId: staffB, orgId: orgB })).token;
});

after(async () => {
  if (!HAS_DB) return;
  if (clientOfA) await db.query(`DELETE FROM clients WHERE id = $1`, [clientOfA]);
  await db.query(`DELETE FROM staff WHERE email IN ('scope-a@example.test','scope-b@example.test')`);
  await db.query(`DELETE FROM orgs WHERE slug IN ('scope-a','scope-b')`);
  await close();
});

const ENDPOINTS = [
  ["read/banking-surface", bankingSurface],
  ["read/finance-os", financeOs],
  ["read/tradelines", tradelines]
];

for (const [name, handler] of ENDPOINTS) {
  test(`${name}: a staff session from ANOTHER org cannot read this client`,
    { skip: !HAS_DB }, async () => {
      const res = makeRes();
      await handler(asStaff(tokenB, clientOfA), res);

      assert.equal(res.statusCode, 404,
        "another org's caller must get 'no such client', not the data");
      // 404 and not 403: 403 confirms the client is real and merely not yours,
      // which turns the endpoint into an oracle for enumerating a competitor's
      // client list from status codes alone.
      assert.equal(res.body.error, "not_found");

      // And, belt and braces, no money in the body under any key.
      assert.equal(JSON.stringify(res.body).includes("999900"), false,
        "no balance may appear in a refusal");
    });

  test(`${name}: the client's OWN org still reads normally`,
    { skip: !HAS_DB }, async () => {
      // The fix must close the hole without closing the endpoint. A gate that
      // refuses everybody passes the test above and breaks the product.
      const res = makeRes();
      await handler(asStaff(tokenA, clientOfA), res);
      assert.equal(res.statusCode, 200, `${name} must still work for its own org`);
      assert.equal(res.body.ok, true);
    });
}

test("read/banking-surface actually returns the balance to the right org",
  { skip: !HAS_DB }, async () => {
    // Proves the 200 above is a real read and not an empty success that would
    // make the cross-org test pass for the wrong reason.
    const res = makeRes();
    await bankingSurface(asStaff(tokenA, clientOfA), res);
    assert.equal(JSON.stringify(res.body).includes("999900"), true,
      "the owning org must see the money, or this suite proves nothing");
  });

test("a session whose org is missing is refused, not silently empty",
  { skip: !HAS_DB }, async () => {
    const res = makeRes();
    const { requireClientInOrg } = await import("./client-scope.mjs");
    const ok = await requireClientInOrg(res, db, { id: "x", org_id: null }, clientOfA);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "no_org_on_session");
  });
