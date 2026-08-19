// The demo-client endpoint, end to end: POST /api/demo/simulate creates one,
// DELETE removes it.
//
// WHY THIS FILE EXISTS. The delete half of this endpoint returned a server
// error on live and left the client behind. There was no test on it at all —
// the handler had never been exercised against a real database, so the only
// thing standing between the bug and production was someone pressing the
// button by hand.
//
// A note on where this lives: `npm test` only walks src/ and scripts/. A test
// placed under api/ is never collected and silently never runs, so endpoint
// tests live here and import the api/ handler.

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/demo/simulate.mjs";

const hasDb = !!process.env.DATABASE_URL;
const SLUG = "t16-demo-endpoint-suite";

let orgId = null;
const tokens = {};

// A response object shaped like the one the real function passes in.
// setHeader is required — the 405 branch calls it.
const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const call = async (method, { body, query = {}, token } = {}) => {
  const r = res();
  await handler(
    { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} },
    r
  );
  return r;
};

async function purge() {
  const { rows } = await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG]);
  if (!rows.length) return;
  const oid = rows[0].id;
  const kids = await db.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'client_id'`);
  const ids = await db.query(`SELECT id FROM clients WHERE org_id = $1`, [oid]);
  for (const c of ids.rows) {
    for (const k of kids.rows) {
      await db.query(`DELETE FROM "${k.table_name}" WHERE client_id = $1`, [c.id]).catch(() => null);
    }
  }
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [oid]).catch(() => null);
  await db.query(`DELETE FROM sessions WHERE org_id = $1`, [oid]).catch(() => null);
  await db.query(`DELETE FROM staff WHERE org_id = $1`, [oid]).catch(() => null);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [oid]).catch(() => null);
}

async function makeStaff(role, email) {
  const s = await db.query(
    `INSERT INTO staff (org_id, name, role, email, status)
     VALUES ($1,$2,$3,$4,'active') RETURNING id`,
    [orgId, `T16 ${role}`, role, email]);
  const { token } = await createSession(db, { staffId: s.rows[0].id, orgId });
  return token;
}

async function rowsLeft(clientId) {
  const kids = await db.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'client_id' ORDER BY table_name`);
  const left = {};
  for (const k of kids.rows) {
    const r = await db.query(
      `SELECT count(*)::int n FROM "${k.table_name}" WHERE client_id = $1`, [clientId]
    ).catch(() => null);
    if (r && r.rows[0].n > 0) left[k.table_name] = r.rows[0].n;
  }
  const c = await db.query(`SELECT count(*)::int n FROM clients WHERE id = $1`, [clientId]);
  if (c.rows[0].n > 0) left.clients = c.rows[0].n;
  return left;
}

describe("POST/DELETE /api/demo/simulate", { skip: !hasDb ? "no DATABASE_URL" : false }, () => {
  before(async () => {
    await purge();
    const r = await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'T16 Demo Endpoint Suite') RETURNING id`, [SLUG]);
    orgId = r.rows[0].id;
    tokens.owner = await makeStaff("owner", "t16-owner@example.invalid");
    tokens.closer = await makeStaff("closer", "t16-closer@example.invalid");
  });

  after(async () => { await purge(); await close(); });

  test("a signed-out caller gets nothing", async () => {
    const r = await call("POST", { body: {} });
    assert.ok(r.code === 401 || r.code === 403, `expected a refusal, got ${r.code}`);
  });

  test("a closer cannot load or wipe demo data", async () => {
    const r = await call("POST", { body: {}, token: tokens.closer });
    assert.equal(r.code, 403, JSON.stringify(r.body));
  });

  test("an owner can create a demo client and then delete it cleanly", async () => {
    const made = await call("POST", { body: {}, token: tokens.owner });
    assert.equal(made.code, 200, JSON.stringify(made.body));
    const clientId = made.body.client_id;
    assert.ok(clientId, "the endpoint should hand back the new client id");

    // Dirty it the way real use does — these are the rows that used to make
    // the delete fail with a 500 while destroying the client's other data.
    await db.query(
      `INSERT INTO events (org_id, name, client_id, payload)
       VALUES ($1,'contract.signed',$2,'{}'::jsonb)`, [orgId, clientId]);

    const gone = await call("DELETE", { body: { client_id: clientId }, token: tokens.owner });
    assert.equal(gone.code, 200, JSON.stringify(gone.body));
    assert.equal(gone.body.ok, true);
    assert.equal(gone.body.count, 1);

    assert.deepEqual(await rowsLeft(clientId), {},
      "the endpoint reported success but the client's rows are still there");
  });

  test("deleting a client id that is not a demo client removes nothing", async () => {
    const r = await db.query(
      `INSERT INTO clients (org_id, first_name, email, is_demo)
       VALUES ($1,'Real','t16-real-endpoint@example.invalid',false) RETURNING id`, [orgId]);
    const realId = r.rows[0].id;

    const out = await call("DELETE", { body: { client_id: realId }, token: tokens.owner });
    assert.equal(out.code, 200, JSON.stringify(out.body));
    assert.equal(out.body.count, 0, "a real client must never be removed through the demo endpoint");

    const still = await db.query(`SELECT count(*)::int n FROM clients WHERE id = $1`, [realId]);
    assert.equal(still.rows[0].n, 1);
  });

  test("an unsupported method is refused and says what is allowed", async () => {
    const r = await call("PUT", { token: tokens.owner });
    assert.equal(r.code, 405);
    assert.match(String(r.headers.allow || ""), /DELETE/);
  });
});
