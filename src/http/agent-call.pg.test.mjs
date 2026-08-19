// Postgres-backed tests for POST /api/agent-call — the seam that lets a
// registry agent start a phone call.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is src/** and scripts/** only; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12).
//
// WHAT THESE ARE FOR. Every test below is a REFUSAL. That is deliberate and it
// is the whole point of the file: this route can put a robot on the phone to a
// real person, so what has to be proven is the set of circumstances in which it
// will not. The one path that actually transmits is covered by
// src/messaging/providers/bland-voice.test.mjs with an injected transport, and
// is never exercised against a database.
//
// Run it against a scratch database — NEVER production, and never fundhub_ci:
//   DATABASE_URL="postgres://…/fundhub_t13_scratch" node --test src/http/agent-call.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const SLUG = "agentcall-pgtest";
const EMAIL_LIKE = "agentcall_pg_test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/agent-call", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, org, tokenCloser, tokenAdvisor, clientOk, clientDnd, clientNoPhone;

  const post = async (body, tok = tokenCloser) => {
    const r = res();
    await handler({
      method: "POST", body, query: {},
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  const mkAgent = async (code, over = {}) => {
    const a = {
      name: code, agent_class: "client_facing", channel: "voice",
      status: "draft", runtime: "bland", runtime_ref: "test",
      prompt: "A prompt long enough to be a real script for the test agent.",
      ...over
    };
    await db.query(
      `INSERT INTO agents (org_id, code, name, agent_class, channel, status,
                           runtime, runtime_ref, prompt, went_live_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $6='live' THEN now() END)
       ON CONFLICT (org_id, code) DO UPDATE SET
         status=EXCLUDED.status, runtime=EXCLUDED.runtime, channel=EXCLUDED.channel,
         agent_class=EXCLUDED.agent_class, prompt=EXCLUDED.prompt`,
      [org, code, a.name, a.agent_class, a.channel, a.status, a.runtime,
       a.runtime_ref, a.prompt]
    );
    return code;
  };

  async function purge() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG])).rows.map((r) => r.id);
    if (!orgs.length) return;
    await db.query(`DELETE FROM outbound_calls WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM opt_outs WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM agents  WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM staff   WHERE email LIKE $1`, [EMAIL_LIKE]);
  }

  /* The handler reads process.env at call time. A key is set here so the
     "ready" path can be reached at all; the test below unsets it again to prove
     the unconfigured answer. Never a real key — nothing in this file transmits. */
  const REAL_KEY = process.env.BLAND_API_KEY;

  before(async () => {
    ({ default: handler } = await import("../../api/agent-call.mjs"));
    process.env.BLAND_API_KEY = "test-key-not-a-real-credential";
    await purge();

    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Agent Call Pgtest')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG])).rows[0].id;

    const mkStaff = async (role, email) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`, [org, role, role, email])).rows[0].id;

    tokenCloser = (await createSession(db, {
      staffId: await mkStaff("closer", "agentcall_pg_test_closer@example.com"), orgId: org
    })).token;
    /* funding_advisor is inside ROLE_SETS.STAFF but deliberately outside
       CALL_ROLES — the funding desk does not cold-call. */
    tokenAdvisor = (await createSession(db, {
      staffId: await mkStaff("funding_advisor", "agentcall_pg_test_advisor@example.com"), orgId: org
    })).token;

    const mkClient = async (first, over = {}) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, phone, dnd_voice)
       VALUES ($1,$2,'Tester',$3,$4,$5) RETURNING id`,
      [org, first, `agentcall_pg_test_${first.toLowerCase()}@example.com`,
       over.phone === undefined ? "+15551230000" : over.phone,
       over.dnd_voice === true]
    )).rows[0].id;

    clientOk      = await mkClient("Callable");
    clientDnd     = await mkClient("Donotcall", { dnd_voice: true });
    clientNoPhone = await mkClient("Nophone", { phone: null });
  });

  after(async () => {
    if (REAL_KEY === undefined) delete process.env.BLAND_API_KEY;
    else process.env.BLAND_API_KEY = REAL_KEY;
    await purge();
    await close();
  });

  /* ── who may ask ─────────────────────────────────────────────────────── */

  test("a signed-out request cannot start a call", async () => {
    const r = await post({ action: "check", agent_code: "AG-04" }, null);
    assert.equal(r.code, 401);
  });

  test("a role outside the client-contact desks is refused", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const r = await post({ action: "check", agent_code: "TC-LIVE" }, tokenAdvisor);
    assert.equal(r.code, 403);
    assert.equal(r.body.placed, undefined, "a 403 must not carry a placement result");
  });

  test("only POST is accepted", async () => {
    const r = res();
    await handler({ method: "GET", query: {}, headers: { authorization: "Bearer " + tokenCloser } }, r);
    assert.equal(r.code, 405);
  });

  /* ── which agent ─────────────────────────────────────────────────────── */

  test("an unknown agent code is a plain not-found, not a call", async () => {
    const r = await post({ action: "check", agent_code: "NOPE-99" });
    assert.equal(r.code, 404);
    assert.equal(r.body.placed, false);
  });

  test("a draft agent cannot call anyone — the promotion gate is the review step", async () => {
    await mkAgent("TC-DRAFT", { status: "draft" });
    const r = await post({ action: "check", agent_code: "TC-DRAFT", client_id: clientOk });
    assert.equal(r.code, 409);
    assert.equal(r.body.reason, "not_live");
    assert.equal(r.body.placed, false);
  });

  test("an agent that does not run on the phone system cannot call", async () => {
    await mkAgent("TC-INT", { status: "live", runtime: "internal", channel: "sms" });
    const r = await post({ action: "check", agent_code: "TC-INT", client_id: clientOk });
    assert.equal(r.code, 409);
    assert.equal(r.body.reason, "not_a_voice_runtime");
  });

  test("an internal ops agent may never contact a client", async () => {
    await mkAgent("TC-OPS", { status: "live", agent_class: "ops" });
    const r = await post({ action: "check", agent_code: "TC-OPS", client_id: clientOk });
    assert.equal(r.code, 409);
    assert.equal(r.body.reason, "not_client_facing");
  });

  /* ── which person ────────────────────────────────────────────────────── */

  test("a person with no phone number cannot be called", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const r = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientNoPhone });
    assert.equal(r.code, 409);
    assert.equal(r.body.reason, "no_phone");
  });

  test("a person marked do-not-call by voice is refused", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const r = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientDnd });
    assert.equal(r.code, 409);
    assert.equal(r.body.reason, "dnd_voice");
    assert.match(r.body.message, /do not call/i);
  });

  test("a person who opted out of voice is refused", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    await db.query(
      `INSERT INTO opt_outs (client_id, org_id, channel, source)
       VALUES ($1,$2,'voice','test')
       ON CONFLICT (client_id, channel) DO UPDATE SET opted_out_at = now(), opted_in_at = NULL`,
      [clientOk, org]
    );
    try {
      const r = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientOk });
      assert.equal(r.code, 409);
      assert.equal(r.body.reason, "opted_out");
    } finally {
      await db.query(`DELETE FROM opt_outs WHERE client_id = $1`, [clientOk]);
    }
  });

  test("one company's staff cannot dial another company's client", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const otherClient = (await db.query(
      `SELECT id FROM clients WHERE org_id <> $1 LIMIT 1`, [org])).rows[0];
    if (!otherClient) return;   // a database with only this org proves nothing here
    const r = await post({ action: "check", agent_code: "TC-LIVE", client_id: otherClient.id });
    assert.equal(r.code, 404);
    assert.equal(r.body.reason, "client_not_found");
  });

  /* ── check never dials ───────────────────────────────────────────────── */

  test("with no phone system connected, check says so — and only after consent passed", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const key = process.env.BLAND_API_KEY;
    delete process.env.BLAND_API_KEY;
    try {
      const ok = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientOk });
      assert.equal(ok.code, 503);
      assert.equal(ok.body.reason, "not_configured");

      /* THE ORDERING THIS FILE EXISTS TO PIN. A person marked do-not-call must
         be refused for BEING do-not-call, never for a missing setting — an
         operator who reads "not connected" fixes the setting and tries again. */
      const dnd = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientDnd });
      assert.equal(dnd.body.reason, "dnd_voice",
        "consent is answered before configuration");
    } finally {
      process.env.BLAND_API_KEY = key;
    }
  });

  test("a successful check places no call and records no dispatch", async () => {
    await mkAgent("TC-LIVE", { status: "live" });
    const before = (await db.query(
      `SELECT count(*)::int n FROM outbound_calls WHERE org_id = $1`, [org])).rows[0].n;
    const r = await post({ action: "check", agent_code: "TC-LIVE", client_id: clientOk });
    assert.equal(r.code, 200);
    assert.equal(r.body.placed, false, "check must never report a placement");
    assert.equal(r.body.ready, true);
    const after = (await db.query(
      `SELECT count(*)::int n FROM outbound_calls WHERE org_id = $1`, [org])).rows[0].n;
    assert.equal(after, before, "check must not write an outbound_calls row");
  });
});
