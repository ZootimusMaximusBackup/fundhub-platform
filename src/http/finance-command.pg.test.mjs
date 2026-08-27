/* Postgres-backed tests for /api/read/finance-command.
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/read/finance-command.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const STAFF_EMAIL_LIKE = "fc_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "fc.http.test.%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/read/finance-command", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let orgId, client, owner;

  const call = async ({ query = {}, token } = {}) => {
    const r = res();
    await handler({ method: "GET", query, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE])).rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM entities WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    /* resolveDefaultOrg returns the id STRING (src/auth/org.mjs:14 caches
       r.rows[0].id), not a row. This read `org.id`, which was undefined, so
       every INSERT here passed NULL for org_id and the whole file died in
       before() on the staff not-null constraint - 0 tests ever ran. */
    orgId = await resolveDefaultOrg(db);
    await purge();
    const staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status) VALUES ($1,'Owner','owner',$2,'active') RETURNING id`,
      [orgId, "fc_http_test_owner@example.com"]
    )).rows[0].id;
    owner = { id: staffId, token: (await createSession(db, { staffId, orgId: orgId })).token };

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1,'FC','Test',$2) RETURNING id`,
      [orgId, "fc.http.test.one@example.com"]
    )).rows[0].id;

    await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, name, account_type, current_balance_cents)
       VALUES ($1,$2,'Checking','depository',150000)`,
      [orgId, client]
    );
    await db.query(
      `INSERT INTO tradelines (org_id, client_id, lender, kind, credit_limit_cents, balance_cents)
       VALUES ($1,$2,'Chase','revolving',100000,25000)`,
      [orgId, client]
    );
  });

  after(async () => { await purge(); await close(); });

  test("aggregates cash and credit for a client", async () => {
    const r = await call({ token: owner.token, query: { client_id: client } });
    assert.equal(r.code, 200);
    assert.equal(r.body.totals.cash_cents, 150000);
    assert.equal(r.body.totals.credit_available_cents, 100000);
    assert.equal(r.body.totals.credit_owed_cents, 25000);
    assert.equal(r.body.totals.utilization_overall, 0.25);
  });

  test("an entity that does not belong to the given client is refused", async () => {
    const ent = (await db.query(
      `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1,$2,'personal','Me') RETURNING id`,
      [orgId, client]
    )).rows[0].id;
    const otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, email) VALUES ($1,'Other',$2) RETURNING id`,
      [orgId, "fc.http.test.other@example.com"]
    )).rows[0].id;
    const r = await call({ token: owner.token, query: { client_id: otherClient, entity_id: ent } });
    assert.equal(r.code, 400);
    await db.query(`DELETE FROM clients WHERE id = $1`, [otherClient]);
    await db.query(`DELETE FROM entities WHERE id = $1`, [ent]);
  });

  test("an invalid days value is rejected", async () => {
    const r = await call({ token: owner.token, query: { days: "0" } });
    assert.equal(r.code, 400);
  });
});
