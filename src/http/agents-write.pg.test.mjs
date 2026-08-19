// Postgres-backed tests for POST /api/agents — the Agent Editor's Save button,
// against a real database rather than a stubbed one.
//
// WHY THIS EXISTS ALONGSIDE src/http/agents-write.test.mjs. That file stubs the
// database and proves the handler's branching. It cannot prove the two things
// this thread turned on, because both are facts about a stored row:
//   T13-10 — Save now records WHERE an agent runs (runtime / runtime_ref).
//            Until this, a saved agent could never be pointed at a real call.
//   T13-01 — a live agent must have a prompt. Migration 177 puts that in the
//            database, so it holds even for a writer that skips the handler.
//
// Skipped without DATABASE_URL. Run against a scratch database, NEVER production
// and never fundhub_ci:
//   DATABASE_URL="postgres://…/fh_t13" node --test src/http/agents-write.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const SLUG = "agentswrite-pgtest";
const EMAIL_LIKE = "agentswrite_pg_test%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/agents against Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, org, token;

  const post = async (body) => {
    const r = res();
    await handler({ method: "POST", body, query: {}, headers: { authorization: "Bearer " + token } }, r);
    return r;
  };

  const row = async (code) => (await db.query(
    `SELECT * FROM agents WHERE org_id = $1 AND code = $2`, [org, code])).rows[0];

  const seed = async (code, over = {}) => {
    const a = { status: "draft", runtime: null, runtime_ref: null, prompt: null, ...over };
    await db.query(
      `INSERT INTO agents (org_id, code, name, agent_class, channel, status, runtime, runtime_ref, prompt)
       VALUES ($1,$2,$2,'client_facing','sms',$3,$4,$5,$6)
       ON CONFLICT (org_id, code) DO UPDATE SET
         status=EXCLUDED.status, runtime=EXCLUDED.runtime,
         runtime_ref=EXCLUDED.runtime_ref, prompt=EXCLUDED.prompt`,
      [org, code, a.status, a.runtime, a.runtime_ref, a.prompt]
    );
    /* Backdate the fixture. `now()` twice in the same second stringifies to the
       same text (String(Date) carries no milliseconds), so a same-second save
       looked like no save at all. A fixed past stamp makes "it moved" exact. */
    await db.query(
      `UPDATE agents SET created_at = timestamptz '2026-01-01 00:00:00+00',
                         updated_at = timestamptz '2026-01-01 00:00:00+00'
        WHERE org_id = $1 AND code = $2`, [org, code]);
  };

  async function purge() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [SLUG])).rows.map((r) => r.id);
    if (!orgs.length) return;
    await db.query(`DELETE FROM agent_triggers WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM agents WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM staff  WHERE email LIKE $1`, [EMAIL_LIKE]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/agents.mjs"));
    await purge();
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Agents Write Pgtest')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG])).rows[0].id;
    const staff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Owner','owner',$2,'active') RETURNING id`,
      [org, "agentswrite_pg_test_owner@example.com"])).rows[0].id;
    token = (await createSession(db, { staffId: staff, orgId: org })).token;
  });

  after(async () => { await purge(); await close(); });

  /* ── T13-13: Save really does write. Keep it working. ─────────────────── */

  test("Save stores the prompt and guardrails, and a reload would show them", async () => {
    await seed("PG-01");
    const r = await post({
      action: "save", code: "PG-01", prompt: "x".repeat(80),
      guardrails: { block: "y".repeat(30), triggers: ["message.inbound"] }
    });
    assert.equal(r.code, 200);
    const stored = await row("PG-01");
    assert.equal(stored.prompt, "x".repeat(80));
    assert.equal(stored.guardrails.block, "y".repeat(30));
    assert.deepEqual(stored.guardrails.triggers, ["message.inbound"]);
    assert.ok(
      new Date(stored.updated_at).getTime() > new Date(stored.created_at).getTime(),
      "Save must move updated_at — that is how anyone can tell it was saved. " +
      "AG-04 and AG-09 still have updated_at = created_at from the July seed, " +
      "which is how we know nobody has ever edited them.");
  });

  /* ── T13-10: Save now records where the agent runs ────────────────────── */

  test("Save records which system runs the agent, and which flow it maps to", async () => {
    await seed("PG-02");
    assert.equal((await row("PG-02")).runtime, null, "starts with nowhere to run");

    const r = await post({
      action: "save", code: "PG-02", prompt: "z".repeat(80),
      guardrails: { block: "w".repeat(30) },
      runtime: "bland", runtime_ref: "AG-PG-02-flow"
    });
    assert.equal(r.code, 200);

    const stored = await row("PG-02");
    assert.equal(stored.runtime, "bland",
      "without this a saved agent can never be pointed at a real call");
    assert.equal(stored.runtime_ref, "AG-PG-02-flow");
    assert.equal(r.body.agent.runtime, "bland", "and the screen is told what was stored");
  });

  test("leaving runtime out of the request does not wipe it", async () => {
    await seed("PG-03", { runtime: "bland", runtime_ref: "keep-me" });
    await post({ action: "save", code: "PG-03", prompt: "a".repeat(80) });
    const stored = await row("PG-03");
    assert.equal(stored.runtime, "bland", "an absent key means leave it alone, never clear it");
    assert.equal(stored.runtime_ref, "keep-me");
  });

  test("a runtime we cannot run an agent on is refused in plain words", async () => {
    await seed("PG-04");
    const r = await post({ action: "save", code: "PG-04", runtime: "carrier-pigeon" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_runtime");
    assert.match(r.body.message, /bland/i);
    assert.equal((await row("PG-04")).runtime, null, "a refused save stores nothing");
  });

  test("a running agent cannot have its runtime cleared out from under it", async () => {
    // 037's agents_runtime_required_ck refuses it in the database; this proves
    // the person gets a sentence rather than a raw database error.
    await seed("PG-05", { status: "live", runtime: "bland", prompt: "q".repeat(80) });
    const r = await post({ action: "save", code: "PG-05", runtime: "" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "runtime_required");
    assert.equal((await row("PG-05")).runtime, "bland");
  });

  /* ── T13-01 / T13-07: the invariant 037 was missing ───────────────────── */

  test("the database itself refuses a live agent with no prompt", async () => {
    await seed("PG-06", { runtime: "bland" });
    await assert.rejects(
      () => db.query(
        `UPDATE agents SET status = 'live' WHERE org_id = $1 AND code = 'PG-06'`, [org]),
      /agents_live_needs_prompt_ck/,
      "this is the exact shape 037 seeded onto AG-04 and AG-09 in July"
    );
  });

  test("promotion is still refused by the handler before the database sees it", async () => {
    await seed("PG-07", { runtime: "bland" });
    const r = await post({ action: "promote", code: "PG-07" });
    assert.equal(r.code, 409);
    assert.equal(r.body.error, "promotion_blocked");
    assert.equal((await row("PG-07")).status, "draft");
  });

  test("an agent with a real prompt and guardrails can still be promoted", async () => {
    await seed("PG-08", { runtime: "bland" });
    await post({
      action: "save", code: "PG-08", prompt: "p".repeat(80),
      guardrails: { block: "g".repeat(30) }
    });
    const r = await post({ action: "promote", code: "PG-08" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const stored = await row("PG-08");
    assert.equal(stored.status, "live");
    assert.ok(stored.went_live_at, "a live agent records when it went live");
  });

  /* ── retired stays retired ────────────────────────────────────────────── */

  test("a retired agent cannot be edited or promoted", async () => {
    await seed("PG-09");
    await db.query(
      `UPDATE agents SET status='retired', retired_at=now() WHERE org_id=$1 AND code='PG-09'`, [org]);
    for (const action of ["save", "promote", "demote"]) {
      const r = await post({ action, code: "PG-09", prompt: "nope" });
      assert.equal(r.code, 409, action);
      assert.equal(r.body.error, "retired", action);
    }
    assert.equal((await row("PG-09")).prompt, null);
  });
});
