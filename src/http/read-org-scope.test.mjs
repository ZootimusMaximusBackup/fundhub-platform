// Do the org-scoped read endpoints scope to the CALLER's org, or to a constant?
//
// api/read/products.mjs, api/read/agents.mjs and api/read/affiliates.mjs each
// filtered on
//
//     org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
//
// which looks like tenancy and is not. It is a hard-coded lookup of one
// particular org — the seeded default — and it ignores who is asking. With one
// org in the table the two are the same value, so nothing looked wrong. The
// moment a second org exists, its staff read the DEFAULT org's rows and none of
// their own: org A's affiliate roster served to org B's staff. The symptom that
// gets reported is "my list is empty"; the symptom that matters is the other
// direction.
//
// WHY THIS RUNS WITHOUT A DATABASE. The bug is invisible on a single-org
// database, which is every database this repo has. A behavioural test would
// need a second org, which needs DATABASE_URL, which is unset in the passes that
// would have caught it. So these drive readHandler through its injectable deps
// with a recording `db` that models no schema and holds no rows — it can only
// prove "the query issued carried these params" and "this text was or was not in
// the SQL". Everything about the DATA still belongs in a .pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";
import { run as productsRun } from "../../api/read/products.mjs";
import { run as agentsRun } from "../../api/read/agents.mjs";
import { run as affiliatesRun } from "../../api/read/affiliates.mjs";

// Not the default org. If a handler is scoping to the caller, this id has to
// reach Postgres as a bound parameter.
const CALLER_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const recorder = () => {
  const calls = [];
  return { calls, query: (sql, params) => { calls.push({ sql, params }); return Promise.resolve({ rows: [] }); } };
};

const asStaff = (role, orgId) => async () => ({
  id: "00000000-0000-4000-8000-000000000001",
  role, org_id: orgId,
  email: "recorder@example.com", name: "Recorder", status: "active"
});

async function drive(handler, { role, orgId = CALLER_ORG, query = {} } = {}) {
  const r = res();
  const fake = recorder();
  await handler({ method: "GET", query, headers: {} }, r, { db: fake, requireAuth: asStaff(role, orgId) });
  return { r, calls: fake.calls };
}

// role: one that each endpoint's own ROLE_SET admits. owner is in all of them.
const ENDPOINTS = [
  { name: "read/products", handler: productsRun, role: "owner" },
  { name: "read/agents", handler: agentsRun, role: "owner" },
  { name: "read/affiliates", handler: affiliatesRun, role: "owner" }
];

describe("org scoping on the read endpoints", () => {
  for (const { name, handler, role } of ENDPOINTS) {
    test(`${name}: filters on the caller's org, not a hard-coded default`, async () => {
      const { r, calls } = await drive(handler, { role });
      assert.strictEqual(r.code, 200, "an admitted staff caller should get 200");
      assert.strictEqual(calls.length, 1, "exactly one query should be issued");

      const { sql, params } = calls[0];
      assert.ok(
        !/is_default/.test(sql),
        `${name} still resolves its org from orgs.is_default — that is one fixed ` +
        `org, not the caller's`
      );
      assert.ok(
        params.includes(CALLER_ORG),
        `${name} did not bind the caller's org_id (${CALLER_ORG}) as a parameter; ` +
        `params were ${JSON.stringify(params)}`
      );
    });

    test(`${name}: a session with no org_id is scoped to nothing, never to everything`, async () => {
      // Fail closed. If org_id is ever missing from a session, the endpoint must
      // return an empty page — not the whole table, and not the default org's.
      const { r, calls } = await drive(handler, { role, orgId: null });
      assert.strictEqual(r.code, 200);
      assert.strictEqual(calls.length, 1);

      const { sql, params } = calls[0];
      assert.ok(!/is_default/.test(sql), `${name} fell back to the default org`);
      assert.ok(
        params.includes(null),
        `${name} dropped the org filter instead of binding null; ` +
        `params were ${JSON.stringify(params)}`
      );
    });
  }
});
