/* Postgres-backed tests for /api/finance/entities (106_entities.sql).
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/finance/entities.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const STAFF_EMAIL_LIKE = "entities_http_test_%@example.com";
const CLIENT_EMAIL_LIKE = "entities.http.test.%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/entities", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, owner;

  const call = async ({ method = "POST", body, query = {}, token } = {}) => {
    const r = res();
    await handler({ method, query, body, headers: token ? { authorization: "Bearer " + token } : {} }, r);
    return r;
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM entities WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    const staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Owner','owner',$2,'active') RETURNING id`,
      [org.id, `entities_http_test_owner@example.com`]
    )).rows[0].id;
    owner = { id: staffId, token: (await createSession(db, { staffId, orgId: org.id })).token };

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Ent','Test',$2) RETURNING id`,
      [org.id, `entities.http.test.one@example.com`]
    )).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  test("create adds a row scoped to the client and org", async () => {
    const r = await call({
      token: owner.token,
      body: { action: "create", client_id: client, kind: "business", name: "Acme LLC" }
    });
    assert.equal(r.code, 201);
    assert.equal(r.body.ok, true);
    const row = (await db.query(`SELECT * FROM entities WHERE id = $1`, [r.body.entity_id])).rows[0];
    assert.equal(row.client_id, client);
    assert.equal(row.kind, "business");
    assert.equal(row.name, "Acme LLC");
  });

  test("rejects an invalid kind", async () => {
    const r = await call({
      token: owner.token,
      body: { action: "create", client_id: client, kind: "trust", name: "Nope" }
    });
    assert.equal(r.code, 400);
  });

  test("archive is idempotent and keeps the row", async () => {
    const created = await call({
      token: owner.token,
      body: { action: "create", client_id: client, kind: "personal", name: "Personal" }
    });
    const id = created.body.entity_id;
    const first = await call({ token: owner.token, body: { action: "archive", entity_id: id } });
    const second = await call({ token: owner.token, body: { action: "archive", entity_id: id } });
    assert.equal(first.code, 200);
    assert.equal(second.code, 200);
    const row = (await db.query(`SELECT archived_at FROM entities WHERE id = $1`, [id])).rows[0];
    assert.ok(row.archived_at);
  });

  test("GET lists entities for the client, archived first", async () => {
    const r = await call({ method: "GET", token: owner.token, query: { client_id: client } });
    assert.equal(r.code, 200);
    assert.ok(Array.isArray(r.body.entities));
    assert.ok(r.body.entities.length >= 2);
  });
});
