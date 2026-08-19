// POST /api/social/generate — the failure paths, checked against the tables.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running.
//
// WHAT IT IS FOR. Social Studio's "Write 3 posts for me" button used to sit on
// "Writing…" for ever and leave nothing behind. Two things caused it: the model
// call was made with a database transaction held open, so a killed function
// rolled every row back, and the call had no time limit of its own. The endpoint
// now does three short steps with nothing held across the network call, and it
// bounds the call itself.
//
// So the assertions here are about REFUSALS, not about writing posts. A happy
// path would need a real model call, and no test in this repo may send one.
// Every case below asserts what the tables hold afterwards, not what the JSON
// said — a refusal that answers 403 and writes anyway is exactly the failure
// worth catching, and only the table can see it.
//
// NO OUTBOUND REQUEST IS MADE BY THIS FILE. ANTHROPIC_API_KEY is removed from the
// environment in before() and restored in after(), which sends src/agents/model.mjs
// down its keyless path before it ever reaches a fetch. The timeout test stubs
// globalThis.fetch with a request that never answers.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "social-gen-test-";
const STAFF_EMAIL = "socialgen_pg_test@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("POST /api/social/generate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, callModelBounded, org, staffId, token, partnerId;
  let hadKey = false, savedKey;

  /* The handler runs the real requirePrincipal against the real sessions table,
     so every call carries a token minted for a real staff row. There is no
     injection seam, deliberately. A staff caller must name a partner_id, which
     is what lets one fixture partner stand in for the screen. */
  const call = async (method, { body, query, token: tok } = {}) => {
    const r = res();
    await handler({
      method,
      query: query || {},
      body,
      headers: tok === null ? {} : { authorization: "Bearer " + (tok || token) }
    }, r);
    return r;
  };

  /* What the tables actually hold. Read in a staff scope: both tables carry the
     partner policy, and a bare db.query() sees nothing through it when the suite
     connects as the unprivileged app role — which would make every "nothing was
     written" assertion below pass for the wrong reason. */
  const queueRows = async () => asStaff((tx) => tx.query(
    `SELECT id, status FROM marketing_content_queue WHERE partner_id = $1`, [partnerId]
  ).then((r) => r.rows));

  const usageRows = async () => asStaff((tx) => tx.query(
    `SELECT id, input_tokens, output_tokens FROM partner_ai_usage WHERE partner_id = $1`,
    [partnerId]
  ).then((r) => r.rows));

  before(async () => {
    // Belt and braces against a live call: the key is gone for this process.
    hadKey = Object.prototype.hasOwnProperty.call(process.env, "ANTHROPIC_API_KEY");
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    ({ default: handler, callModelBounded } = await import("../../api/social/generate.mjs"));

    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Socialgen Pgtest','owner',$2,'active') RETURNING id`,
      [org, STAFF_EMAIL])).rows[0].id;
    token = (await createSession(db, { staffId, orgId: org })).token;

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,'Socialgen Fixture',$2,'active',now()) RETURNING id`,
      [org, `${SLUG}owner`])).rows[0].id;
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,false)`, [org, partnerId]));
  });

  after(async () => {
    await cleanup();
    if (hadKey) process.env.ANTHROPIC_API_KEY = savedKey;
    await close();
  });

  test("only POST is accepted", async () => {
    const r = await call("GET", { query: { partner_id: partnerId } });
    assert.strictEqual(r.code, 405);
    assert.strictEqual(r.getHeader("allow"), "POST");
  });

  test("a staff caller must name a partner", async () => {
    const r = await call("POST", { body: {} });
    assert.strictEqual(r.code, 400);
    assert.strictEqual(r.body.error, "partner_id_required");
  });

  test("no session is refused before anything is read", async () => {
    const r = await call("POST", { body: { partner_id: partnerId }, token: null });
    assert.strictEqual(r.code, 401);
    assert.deepStrictEqual(await queueRows(), []);
  });

  test("a partner whose suite is off gets a plain refusal and nothing is written", async () => {
    const r = await call("POST", { body: { partner_id: partnerId, count: 3 } });
    assert.strictEqual(r.code, 403);
    assert.strictEqual(r.body.error, "suite_off");
    assert.match(r.body.message, /owner has not turned this on/i,
      "the refusal has to say what to do next, in words");
    assert.deepStrictEqual(await queueRows(), [],
      "a refused request must leave no posts behind");
    assert.deepStrictEqual(await usageRows(), [],
      "a request that never called the model must not record a cost");
  });

  test("with no writing robot set up, nothing is saved and the reason says so", async () => {
    await asStaff((tx) => tx.query(
      `UPDATE partner_module_settings SET marketing_suite_enabled = true WHERE partner_id = $1`,
      [partnerId]));
    const r = await call("POST", { body: { partner_id: partnerId, count: 3 } });
    assert.strictEqual(r.code, 503);
    assert.strictEqual(r.body.error, "no_model");
    assert.deepStrictEqual(await queueRows(), [],
      "a failed write must leave no half-written posts behind");
    // Step three of the endpoint records the cost before it decides whether it
    // has anything to save. With no key the cost is nothing, but the row proves
    // the recording no longer rolls back with the refusal.
    const usage = await usageRows();
    assert.strictEqual(usage.length, 1, "the attempt must be written down");
    assert.strictEqual(usage[0].input_tokens, 0);
    assert.strictEqual(usage[0].output_tokens, 0);
  });

  // ------------------------------------------------------------ the time limit

  test("a model call that never answers is stopped by us, not by the platform", async () => {
    // No network: a stub fetch that only ever settles when the abort fires.
    const realFetch = globalThis.fetch;
    let sawSignal = null;
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      sawSignal = init && init.signal;
      if (!sawSignal) return reject(new Error("no abort signal was attached"));
      sawSignal.addEventListener("abort", () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
    try {
      const started = Date.now();
      const out = await callModelBounded({
        system: "s", user: "u",
        env: { ANTHROPIC_API_KEY: "not-a-real-key-never-sent" }
      }, 60);
      const took = Date.now() - started;
      assert.strictEqual(out.timedOut, true, "the caller must know it ran out of time");
      assert.strictEqual(out.text, null, "there is no answer to use");
      assert.ok(out.error, "callModel reports the abort as an error");
      assert.ok(took < 5000, `it must give up on its own, took ${took}ms`);
      assert.ok(sawSignal && sawSignal.aborted, "the request itself must be cancelled");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a model call that answers in time is not marked as timed out", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: '["one","two"]' }],
        usage: { input_tokens: 5, output_tokens: 7 }
      })
    });
    try {
      const out = await callModelBounded({
        system: "s", user: "u",
        env: { ANTHROPIC_API_KEY: "not-a-real-key-never-sent" }
      }, 5000);
      assert.strictEqual(out.timedOut, false);
      assert.strictEqual(out.text, '["one","two"]');
      assert.strictEqual(out.usage.output_tokens, 7);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ------------------------------------------------------------------- fixture

  /* The fixture rows only. The three partner tables carry the partner policy, so
     the tidy-up runs in a staff scope — a bare db.query() matches no rows when
     the suite connects as the unprivileged app role, and the partner delete then
     trips its foreign key. */
  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (ids.length) {
      await asStaff(async (tx) => {
        await tx.query(`DELETE FROM marketing_content_queue WHERE partner_id = ANY($1)`, [ids]);
        await tx.query(`DELETE FROM partner_ai_usage WHERE partner_id = ANY($1)`, [ids]);
        await tx.query(`DELETE FROM partner_module_settings WHERE partner_id = ANY($1)`, [ids]);
      });
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    }
    const staff = (await db.query(
      `SELECT id FROM staff WHERE email = $1`, [STAFF_EMAIL])).rows.map((r) => r.id);
    if (staff.length) {
      await db.query(`DELETE FROM sessions WHERE staff_id = ANY($1)`, [staff]);
      await db.query(`DELETE FROM staff WHERE id = ANY($1)`, [staff]);
    }
  }
});
