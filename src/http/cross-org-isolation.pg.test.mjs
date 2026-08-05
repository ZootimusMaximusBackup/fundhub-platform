// Runtime cross-org isolation for every auto-discovered client-id endpoint.
//
// SKIPS unless DATABASE_URL is set.
//
// Seeds a client (+ task) in org A. For each probe from buildRuntimeProbes(),
// a session in org B must receive 404 or 403 — never the record.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { buildRuntimeProbes, discoverIdEndpoints } from "./cross-org-guard.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

let orgA = null, orgB = null;
let clientOfA = null, taskOfA = null;
let tokenA = null, tokenB = null;
let staffBId = null;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; }
  };
}

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
    `INSERT INTO orgs (slug, name) VALUES ('xorg-a', 'XOrg A')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
  orgB = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('xorg-b', 'XOrg B')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;

  clientOfA = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone)
     VALUES ($1, 'Secret', 'Person', 'secret-xorg@example.test', '+15550001111')
     RETURNING id`, [orgA])).rows[0].id;

  await db.query(
    `INSERT INTO bank_accounts (org_id, client_id, name, account_type, current_balance_cents)
     VALUES ($1, $2, 'XOrg Secret Checking', 'depository', 424242)`, [orgA, clientOfA]);

  taskOfA = (await db.query(
    `INSERT INTO tasks (org_id, client_id, title, body, assignee_role, done)
     VALUES ($1, $2, 'XOrg secret task', 'do not leak', 'closer', false)
     RETURNING id`, [orgA, clientOfA])).rows[0].id;

  const staffA = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'xorg-a@example.test', 'XA', 'owner', 'active') RETURNING id`, [orgA])).rows[0];
  const staffB = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'xorg-b@example.test', 'XB', 'owner', 'active') RETURNING id`, [orgB])).rows[0];
  staffBId = staffB.id;

  tokenA = (await createSession(db, { staffId: staffA.id, orgId: orgA })).token;
  tokenB = (await createSession(db, { staffId: staffB.id, orgId: orgB })).token;
});

after(async () => {
  if (!HAS_DB) return;
  for (const [k, v] of Object.entries(savedPlaidEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (clientOfA) {
    await db.query(`DELETE FROM tasks WHERE client_id = $1`, [clientOfA]);
    await db.query(`DELETE FROM bank_accounts WHERE client_id = $1`, [clientOfA]);
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientOfA]);
  }
  await db.query(`DELETE FROM staff WHERE email IN ('xorg-a@example.test','xorg-b@example.test')`);
  await db.query(`DELETE FROM orgs WHERE slug IN ('xorg-a','xorg-b')`);
  await close();
});

function assertDenied(res, name) {
  assert.ok([403, 404].includes(res.statusCode),
    `${name}: expected 403/404, got ${res.statusCode} body=${JSON.stringify(res.body)}`);
  const blob = JSON.stringify(res.body || {});
  assert.equal(blob.includes("Secret"), false, `${name}: leaked first name`);
  assert.equal(blob.includes("secret-xorg@example.test"), false, `${name}: leaked email`);
  assert.equal(blob.includes("424242"), false, `${name}: leaked balance`);
  assert.equal(blob.includes("XOrg secret task"), false, `${name}: leaked task`);
  if (clientOfA) {
    // Body may include the uuid only as an echo of the request in an error —
    // refuse if it returned a client object carrying that id as a found row.
    if (res.body && res.body.client && res.body.client.id === clientOfA) {
      assert.fail(`${name}: returned the foreign client record`);
    }
    if (Array.isArray(res.body?.clients) &&
        res.body.clients.some((c) => c.id === clientOfA)) {
      assert.fail(`${name}: list included the foreign client`);
    }
    if (Array.isArray(res.body?.tasks) &&
        res.body.tasks.some((t) => t.id === taskOfA || t.client_id === clientOfA)) {
      assert.fail(`${name}: returned a foreign task`);
    }
  }
}

const probes = buildRuntimeProbes();

test("runtime probe set is non-empty and covers the P0 client endpoint", () => {
  assert.ok(probes.length >= 4, `got ${probes.length} probes`);
  assert.ok(probes.some((p) => p.name === "dashboard/client"));
  // Discovery must still see the fixed surfaces as scoped.
  const scoped = discoverIdEndpoints().filter((e) => e.scoped);
  assert.ok(scoped.length >= 10);
});

for (const probe of probes) {
  test(`cross-org deny: ${probe.name}`, { skip: !HAS_DB }, async () => {
    const mod = await import(probe.importPath);
    const handler = mod.default;
    const res = makeRes();
    const headers = { authorization: "Bearer " + tokenB };

    if (probe.kind === "client_query") {
      await handler({ method: "GET", headers, query: { id: clientOfA } }, res);
      assertDenied(res, probe.name);
      return;
    }
    if (probe.kind === "clients_list") {
      await handler({ method: "GET", headers, query: { limit: "500" } }, res);
      // Own-org list is 200 but must not contain org A's client.
      assert.ok([200, 403, 404].includes(res.statusCode),
        `${probe.name}: unexpected ${res.statusCode}`);
      if (res.statusCode === 200) {
        const ids = (res.body.clients || []).map((c) => c.id);
        assert.equal(ids.includes(clientOfA), false,
          "clients list leaked another org's client");
      }
      return;
    }
    if (probe.kind === "task_get") {
      await handler({
        method: "GET", headers, query: { client_id: clientOfA, done: "all" }
      }, res);
      // Org-scoped empty list (200 + []) or 404/403 are all acceptable.
      if (res.statusCode === 200) {
        assert.equal((res.body.tasks || []).length, 0,
          "tasks GET returned foreign tasks");
      } else {
        assertDenied(res, probe.name);
      }
      return;
    }
    if (probe.kind === "task_patch") {
      await handler({
        method: "PATCH",
        headers,
        query: {},
        body: { id: taskOfA, done: true }
      }, res);
      // Shift gate may 403 before org check — still must not return the task.
      assert.ok([403, 404].includes(res.statusCode),
        `${probe.name}: expected 403/404, got ${res.statusCode}`);
      if (res.body?.task) {
        assert.notEqual(res.body.task.id, taskOfA);
      }
      // Task must remain undone in org A.
      const cur = await db.query(`SELECT done FROM tasks WHERE id = $1`, [taskOfA]);
      assert.equal(cur.rows[0].done, false, "foreign PATCH must not mutate the task");
      return;
    }
    if (probe.kind === "client_id_q") {
      await handler({
        method: "GET",
        headers,
        query: { client_id: clientOfA }
      }, res);
      // Feature flags / wrong method / missing companion params may answer
      // 400/405/403/503 before ownership — still never the record.
      if (res.statusCode === 200) {
        const blob = JSON.stringify(res.body || {});
        assert.equal(blob.includes("424242"), false, `${probe.name}: leaked balance`);
        assert.equal(blob.includes("secret-xorg@example.test"), false);
        if (res.body?.client?.id) {
          assert.notEqual(res.body.client.id, clientOfA);
        }
      } else {
        assert.ok([400, 401, 403, 404, 405, 503].includes(res.statusCode),
          `${probe.name}: unexpected ${res.statusCode} ${JSON.stringify(res.body)}`);
        const blob = JSON.stringify(res.body || {});
        assert.equal(blob.includes("Secret"), false, `${probe.name}: leaked first name`);
        assert.equal(blob.includes("secret-xorg@example.test"), false, `${probe.name}: leaked email`);
        assert.equal(blob.includes("424242"), false, `${probe.name}: leaked balance`);
        assert.equal(blob.includes("XOrg secret task"), false, `${probe.name}: leaked task`);
        if (res.body && res.body.client && res.body.client.id === clientOfA) {
          assert.fail(`${probe.name}: returned the foreign client record`);
        }
      }
      return;
    }
    assert.fail(`unknown probe kind ${probe.kind}`);
  });
}

test("own org still reads dashboard/client", { skip: !HAS_DB }, async () => {
  const handler = (await import("../../api/dashboard/client.mjs")).default;
  const res = makeRes();
  await handler({
    method: "GET",
    headers: { authorization: "Bearer " + tokenA },
    query: { id: clientOfA }
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.client.id, clientOfA);
  assert.equal(res.body.client.email, "secret-xorg@example.test");
});

// Silence unused — staffBId reserved for future claim probes.
void staffBId;
