// Postgres-backed tests for the agent registry. Skipped without DATABASE_URL.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { list, byCode, live, setStatus, setDefinition, needsAttention } from "./registry.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("agent registry", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  // The seeded state, restored before each test so status changes do not leak.
  const SEEDED_LIVE = ["AG-04", "AG-09"];

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
  });

  beforeEach(async () => {
    await db.query(
      `UPDATE agents SET status = CASE WHEN code = ANY($2) THEN 'live' ELSE 'draft' END,
              runtime = CASE WHEN code = ANY($2) THEN 'bland' ELSE NULL END,
              runtime_ref = CASE WHEN code = ANY($2) THEN 'inquiry-removal-ai' ELSE NULL END,
              retired_at = NULL, prompt = NULL, guardrails = '{}'::jsonb
        WHERE org_id = $1`, [org, SEEDED_LIVE]);
  });

  after(async () => { await close(); });

  test("the fourteen agents from the shipped screen are registered", async () => {
    const rows = await list(db, { orgId: org });
    assert.equal(rows.length, 14);
    assert.equal(rows.filter((r) => r.agent_class === "client_facing").length, 9);
    assert.equal(rows.filter((r) => r.agent_class === "ops").length, 5);
  });

  test("only Setter Josh and the Inquiry Removal AI are live", async () => {
    const running = await live(db, { orgId: org });
    assert.deepEqual(running.map((r) => r.code).sort(), SEEDED_LIVE);
    assert.deepEqual(running.map((r) => r.name).sort(),
      ["Inquiry Removal AI", "Setter Josh"]);
    // The screen marks eleven as live; that must not have been believed.
    assert.equal((await list(db, { orgId: org, status: "draft" })).length, 12);
  });

  test("both live agents record where they actually run", async () => {
    for (const a of await live(db, { orgId: org })) {
      assert.equal(a.runtime, "bland", a.code);
      assert.equal(a.runtime_ref, "inquiry-removal-ai", a.code);
      assert.ok(a.went_live_at, `${a.code} is live with no went_live_at`);
    }
  });

  test("a live agent cannot exist with no runtime — the database refuses", async () => {
    await assert.rejects(
      () => db.query(`UPDATE agents SET runtime = NULL WHERE org_id = $1 AND code = 'AG-04'`, [org]),
      /agents_runtime_required_ck/
    );
  });

  test("setStatus refuses to promote an agent with nowhere to run", async () => {
    await assert.rejects(
      () => setStatus(db, { orgId: org, code: "AG-01", status: "live" }),
      /cannot be "live" with no runtime/
    );
    assert.equal((await byCode(db, { orgId: org, code: "AG-01" })).status, "draft");
  });

  test("shadow is a distinct state, and also needs a runtime", async () => {
    await assert.rejects(
      () => setStatus(db, { orgId: org, code: "AG-07", status: "shadow" }),
      /no runtime/);
    const r = await setStatus(db, {
      orgId: org, code: "AG-07", status: "shadow", runtime: "inngest", runtimeRef: "fn-recon" });
    assert.equal(r.status, "shadow");
    assert.equal(r.went_live_at, null, "shadow is not live — it must not stamp went_live_at");
    assert.ok((await live(db, { orgId: org })).some((a) => a.code === "AG-07"),
      "shadow agents are running and belong in the live view");
  });

  test("promoting to live stamps went_live_at once and does not move it", async () => {
    const first = await setStatus(db, {
      orgId: org, code: "AG-06", status: "live", runtime: "inngest" });
    assert.ok(first.went_live_at);
    const again = await setStatus(db, {
      orgId: org, code: "AG-06", status: "live", runtime: "inngest",
      now: new Date(Date.now() + 60_000) });
    assert.equal(again.went_live_at.getTime(), first.went_live_at.getTime());
  });

  test("retiring stamps retired_at; the row is kept, never deleted", async () => {
    const r = await setStatus(db, { orgId: org, code: "AG-04", status: "retired" });
    assert.equal(r.status, "retired");
    assert.ok(r.retired_at);
    assert.ok(await byCode(db, { orgId: org, code: "AG-04" }), "the row must survive");
    assert.ok(!(await live(db, { orgId: org })).some((a) => a.code === "AG-04"));
  });

  test("a retired status must carry retired_at (checked by the database)", async () => {
    await assert.rejects(
      () => db.query(`UPDATE agents SET status = 'retired' WHERE org_id = $1 AND code = 'AG-01'`, [org]),
      /agents_retired_ck/
    );
  });

  test("un-retiring clears retired_at", async () => {
    await setStatus(db, { orgId: org, code: "AG-04", status: "retired" });
    const back = await setStatus(db, {
      orgId: org, code: "AG-04", status: "live", runtime: "bland" });
    assert.equal(back.retired_at, null);
  });

  test("prompts and guardrails ship empty, and needsAttention says so", async () => {
    const gaps = await needsAttention(db, { orgId: org });
    assert.deepEqual(gaps.map((g) => g.code).sort(), SEEDED_LIVE,
      "both live agents should be flagged as missing their real definitions");
    assert.ok(gaps.every((g) => g.prompt_missing && g.guardrails_missing));
  });

  test("loading a real definition clears the flag", async () => {
    const r = await setDefinition(db, {
      orgId: org, code: "AG-04",
      prompt: "You are Josh, a setter for fundhub…",
      guardrails: { never: ["quote a rate", "promise approval"], maxTurns: 12 }
    });
    assert.equal(r.prompt_missing, false);
    assert.equal(r.guardrails_missing, false);

    const gaps = await needsAttention(db, { orgId: org });
    assert.deepEqual(gaps.map((g) => g.code), ["AG-09"], "only the other one should remain");

    const agent = await byCode(db, { orgId: org, code: "AG-04" });
    assert.deepEqual(agent.guardrails.never, ["quote a rate", "promise approval"]);
  });

  test("setDefinition can set one field without wiping the other", async () => {
    await setDefinition(db, { orgId: org, code: "AG-09", prompt: "p" });
    await setDefinition(db, { orgId: org, code: "AG-09", guardrails: { maxTurns: 3 } });
    const a = await byCode(db, { orgId: org, code: "AG-09" });
    assert.equal(a.prompt, "p", "setting guardrails wiped the prompt");
    assert.deepEqual(a.guardrails, { maxTurns: 3 });
  });

  test("setDefinition with nothing to set is an error, not a silent no-op", async () => {
    await assert.rejects(() => setDefinition(db, { orgId: org, code: "AG-01" }),
      /pass a prompt, guardrails, or both/);
  });

  test("codes are upper-case in the database and folded on lookup", async () => {
    const rows = await list(db, { orgId: org });
    assert.ok(rows.every((r) => r.code === r.code.toUpperCase()));
    assert.ok(await byCode(db, { orgId: org, code: " ag-04 " }), "lookup should fold");
    await assert.rejects(
      () => db.query(
        `INSERT INTO agents (org_id, code, name) VALUES ($1,'ag-99','lower')`, [org]),
      /agents_code_ck/
    );
  });

  test("unknown status values are rejected by helper and database alike", async () => {
    await assert.rejects(
      () => setStatus(db, { orgId: org, code: "AG-01", status: "paused" }),
      /status must be one of/);
    await assert.rejects(
      () => db.query(`UPDATE agents SET status = 'paused' WHERE org_id = $1 AND code = 'AG-01'`, [org]),
      /agents_status_ck/);
  });

  test("re-running the migration seeds nothing new", async () => {
    const before = (await list(db, { orgId: org })).length;
    // Re-execute the guarded seed by re-applying the file's INSERT semantics:
    // the NOT EXISTS guard is what is under test.
    await db.query(
      `INSERT INTO agents (org_id, code, name, agent_class, channel, status)
       SELECT $1, 'AG-04', 'Setter Josh', 'client_facing', 'voice', 'draft'
        WHERE NOT EXISTS (SELECT 1 FROM agents WHERE org_id = $1 AND code = 'AG-04')`,
      [org]);
    assert.equal((await list(db, { orgId: org })).length, before);
  });

  test("list rejects a bogus status filter rather than returning everything", async () => {
    await assert.rejects(() => list(db, { orgId: org, status: "nonsense" }),
      /unknown status/);
    await assert.rejects(() => list(db, {}), /orgId is required/);
  });
});
