// The org boundary on the four endpoints that serve ONE named client's money.
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.
//
// *** WHAT WAS WRONG. ***
//
// api/read/banking-surface.mjs, api/read/finance-os.mjs and
// api/read/tradelines.mjs each took a client_id from the query string and read
// that client's financial detail with no check on which company the caller
// belonged to. (api/banking/accounts.mjs is the fourth endpoint here; it always
// scoped at the table level, and is covered so all four answer identically.) All three are gated on ROLE_SETS.STAFF, so the effective rule was:
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
import bankingAccounts from "../../api/banking/accounts.mjs";
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

/* THE BANKING SURFACE HAS A SECOND GATE IN FRONT OF THE ONE THIS FILE TESTS.
   api/read/banking-surface.mjs refuses with 403 unless isPlaidEnabled() finds
   well-formed PLAID_* credentials (audit M9 — bank connections were switched on
   for every staff role before they were approved). That gate runs BEFORE the
   ownership check, so with the variables unset all three banking-surface cases
   below fail on the feature flag and never reach the boundary they exist to
   prove. The values are test constants and unlock nothing; the key is 32 bytes
   of base64 only so it parses. Restored in after() so no other suite inherits
   them. Same pattern as src/http/banking-surface-gate.test.mjs. */
const PLAID_ENV = {
  PLAID_CLIENT_ID: "test-client-id",
  PLAID_SECRET: "test-secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox"
};
const savedPlaidEnv = {};

before(async () => {
  if (!HAS_DB) return;

  for (const [k, v] of Object.entries(PLAID_ENV)) {
    savedPlaidEnv[k] = process.env[k];
    process.env[k] = v;
  }

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
  for (const [k, v] of Object.entries(savedPlaidEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (clientOfA) await db.query(`DELETE FROM clients WHERE id = $1`, [clientOfA]);
  await db.query(`DELETE FROM staff WHERE email IN ('scope-a@example.test','scope-b@example.test')`);
  await db.query(`DELETE FROM orgs WHERE slug IN ('scope-a','scope-b')`);
  await close();
});

const ENDPOINTS = [
  ["read/banking-surface", bankingSurface],
  ["read/finance-os", financeOs],
  ["read/tradelines", tradelines],
  // banking/accounts scopes at the table level too, so a cross-org caller would
  // get empty lists rather than data even without the check. It is in this list
  // anyway: it must answer 404 like its three neighbours, because inconsistent
  // security behaviour between adjacent endpoints is how a gap reappears later.
  ["banking/accounts", bankingAccounts]
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

test("banking/accounts refuses a cross-org WRITE, not only a read",
  { skip: !HAS_DB }, async () => {
    // The read gate and the write gate are separate branches in that handler. A
    // fix that closed only the read would leave a caller from another company
    // able to CREATE accounts against someone else's client.
    const res = makeRes();
    await bankingAccounts({
      method: "POST",
      headers: { authorization: "Bearer " + tokenB },
      query: {},
      body: { client_id: clientOfA, action: "create_account", name: "should not exist" }
    }, res);

    assert.equal(res.statusCode, 404);
    const landed = await db.query(
      `SELECT count(*)::int AS n FROM bank_accounts WHERE name = 'should not exist'`);
    assert.equal(landed.rows[0].n, 0, "the write must not have landed anywhere");
  });
