// The cross-org read hole in api/read/tradelines.mjs and api/read/finance-os.mjs,
// as a regression test.
//
// WHAT THE BUG WAS. Both endpoints gate correctly on ROLE_SETS.STAFF, and both
// took `client_id` off the query string and passed it to listTradelines(), which
// filtered on client_id ALONE. There was no tenant check anywhere between the
// request and the rows. Any authenticated staff session in any org could read
// any client's credit limits, balances and APRs by knowing the uuid.
//
// This is the same shape as the requireAuth `roles` hole (src/http/auth-gate.test.mjs):
// a guard that reads like it is doing something and is not. Both endpoints looked
// gated, and were — on ROLE, not on ORG.
//
// WHY THE FIX IS A THROW AND NOT A REMEMBERED ARGUMENT. listTradelines() now
// REFUSES to run without an org rather than defaulting to unscoped, so a future
// caller cannot reintroduce this by forgetting a parameter. The first test below
// is the one that matters most: it asserts the refusal, not just the current
// callers' behaviour.
//
// ⚠️ UNDER src/ ON PURPOSE. npm test's glob is "src/**" and "scripts/**" only;
// a test next to the handlers under api/ silently never runs.

import { test, describe } from "node:test";
import assert from "node:assert";

import tradelinesHandler from "../../api/read/tradelines.mjs";
import financeOsHandler from "../../api/read/finance-os.mjs";
import { listTradelines } from "../tradelines/store.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    end() { return res; }
  };
  return res;
}

/* Rows belonging to ORG. The stub returns them ONLY when the query carries the
   matching org, which is how a real Postgres would behave with the new WHERE
   clause — so a handler that stopped passing the org would read as empty here
   and the assertions below would catch it. */
const ROWS = [{
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  org_id: ORG, client_id: CLIENT,
  lender: "Chase", kind: "revolving",
  credit_limit_cents: 2_000_000, balance_cents: 500_000,
  apr: "0.1899", closed_at: null, account_ref: "A1"
}];

/* WHICH PLACEHOLDER HOLDS WHAT, READ OUT OF THE SQL.
   Two branches wrote this scope independently and bound the parameters in
   opposite orders — the audit branch org-first, UnderwriteIQ client-first. Both
   are correctly scoped; only the bind position differs, and this file used to
   hardcode one of them in three places. A test that pins a position fails on the
   other branch's perfectly good query and says "the org must be in the WHERE
   clause" about a query whose WHERE clause contains the org.

   So the position is derived instead. What this file is here to prove is that
   the org REACHES the query as a bound parameter and comes from the SESSION —
   neither of which has anything to do with whether it is $1 or $2. */
function bindIndex(sql, column) {
  const m = new RegExp(`${column}\\s*=\\s*\\$(\\d+)`).exec(sql);
  assert.ok(m, `the query does not compare ${column} to a bound parameter:\n${sql}`);
  return Number(m[1]) - 1;
}

function makeDb({ session = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE sessions")) {
        if (session === null) return { rows: [] };
        return {
          rows: [{
            session_id: "sess", expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1", org_id: ORG, role: "closer",
            email: "c@example.com", name: "A Closer", status: "active",
            active_flag: "true",
            ...session
          }]
        };
      }
      if (sql.includes("FROM tradelines")) {
        // Positions read out of the SQL, not assumed — see bindIndex above.
        const clientId = params[bindIndex(sql, "client_id")];
        const orgId = params[bindIndex(sql, "org_id")];
        const match = clientId === CLIENT && orgId === ORG;
        return { rows: match ? ROWS : [] };
      }
      throw new Error("stub db: unexpected query:\n" + sql);
    }
  };
}

const req = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer test-token" },
  query: { client_id: CLIENT },
  ...over
});

const ENDPOINTS = [
  { name: "read/tradelines", handler: tradelinesHandler },
  { name: "read/finance-os", handler: financeOsHandler }
];

/* ───────────── the store refuses to run unscoped ───────────── */

describe("listTradelines refuses an unscoped read", () => {
  test("a missing org throws rather than returning every org's rows", async () => {
    const db = { async query() { throw new Error("must not reach the database"); } };
    for (const opts of [{ clientId: CLIENT }, { clientId: CLIENT, orgId: null }, { clientId: CLIENT, orgId: "" }]) {
      await assert.rejects(
        () => listTradelines(db, opts),
        /orgId is required/,
        `listTradelines(${JSON.stringify(opts)}) must refuse, not read unscoped`
      );
    }
  });

  test("a missing client id still throws", async () => {
    const db = { async query() { throw new Error("must not reach the database"); } };
    await assert.rejects(() => listTradelines(db, { orgId: ORG }), /clientId is required/);
  });

  test("with both, the org reaches the query as a real parameter", async () => {
    const seen = [];
    const db = { async query(sql, params) { seen.push({ sql, params }); return { rows: [] }; } };
    await listTradelines(db, { clientId: CLIENT, orgId: ORG });
    assert.match(seen[0].sql, /org_id\s*=\s*\$\d+/, "the org must be in the WHERE clause, not just accepted");
    assert.equal(seen[0].params[bindIndex(seen[0].sql, "org_id")], ORG,
      "org_id appears in the WHERE clause but the value bound to it is not the org");
  });
});

/* ───────────── both endpoints, same rules ───────────── */

for (const { name, handler } of ENDPOINTS) {
  describe(`${name} — org scoping`, () => {

    test("a staff session in the owning org still reads its own client", async () => {
      const res = makeRes();
      await handler(req(), res, { db: makeDb() });
      assert.equal(res.statusCode, 200, "the fix must not break the legitimate read");
      // MUST assert the data actually arrived. A 200 alone would also pass if the
      // handler stopped passing the org at all — the stub would return [] and the
      // "no rows" test below would still be green. This is the assertion that
      // makes the pair meaningful rather than mutually satisfiable by a bug.
      assert.ok(JSON.stringify(res.body).includes("Chase"),
        `${name} returned no rows for the client's OWN org — the scope is too tight, not too loose`);
    });

    test("THE HOLE: a session in another org gets no rows", async () => {
      const res = makeRes();
      await handler(req(), res, { db: makeDb({ session: { org_id: OTHER_ORG } }) });
      assert.equal(res.statusCode, 200);
      // No credit data crosses the boundary. Empty rather than 404 on purpose:
      // a 404 would confirm the uuid names a real client somewhere.
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes("Chase"), `${name} leaked another org's lender`);
      assert.ok(!body.includes("2000000") && !body.includes("20000.00"),
        `${name} leaked another org's credit limit`);
    });

    test("a session with no org is refused before any data query runs", async () => {
      for (const org_id of [null, undefined, "", "not-a-uuid"]) {
        const res = makeRes();
        const db = makeDb({ session: { org_id } });
        await handler(req(), res, { db });
        assert.equal(res.statusCode, 403,
          `${name}: org_id ${JSON.stringify(org_id)} must fail closed`);
        assert.ok(!db.calls.some((c) => c.sql.includes("FROM tradelines")),
          `${name}: an unscoped session must never reach the tradelines query`);
      }
    });

    test("the org comes from the session, never from the query string", async () => {
      const res = makeRes();
      const db = makeDb();
      await handler(req({ query: { client_id: CLIENT, org_id: OTHER_ORG } }), res, { db });
      assert.equal(res.statusCode, 200);
      const call = db.calls.find((c) => c.sql.includes("FROM tradelines"));
      assert.equal(call.params[bindIndex(call.sql, "org_id")], ORG,
        `${name}: a caller-supplied org must be ignored — it is not a scope, it is a request to be trusted`);
    });

    test("the role gate still runs and still refuses a non-staff role", async () => {
      const res = makeRes();
      await handler(req(), res, { db: makeDb({ session: { role: "partner" } }) });
      assert.equal(res.statusCode, 403);
    });

    test("an unauthenticated caller is still 401", async () => {
      const res = makeRes();
      await handler(req({ headers: {} }), res, { db: makeDb({ session: null }) });
      assert.equal(res.statusCode, 401);
    });
  });
}
