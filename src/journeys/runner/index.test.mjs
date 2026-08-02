/* The walker.
 *
 * Acceptance criteria held here:
 *   * a journey with N conditions produces 2^N walked paths, each with its own
 *     synthetic client
 *   * the workflow coverage list accounts for all 47 entries in
 *     src/workflows/index.mjs — every one either fired or explicitly listed as
 *     unreached
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { enumeratePaths, run, START_EVENT } from "./index.mjs";
import { load as loadRegistry, neverFired } from "./registry.mjs";
import { SEED_JOURNEYS } from "../seed-journeys.mjs";
import { functions } from "../../workflows/index.mjs";
import { isSyntheticRow } from "./synthetic.mjs";

const N = (id, type, cfg = {}, branches) => ({ id, type, title: id, cfg, touches: [], branches });
const cond = (id, lanes) => N(id, "condition", { field: "f", op: "is true" }, lanes);
const lane = (label, nodes) => ({ label, nodes });

// ── path enumeration ──────────────────────────────────────────────────────

test("a straight line is exactly one path", () => {
  const paths = enumeratePaths([N("a", "sms"), N("b", "stage")]);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].map((s) => s.node.id), ["a", "b"]);
});

test("ACCEPTANCE: N conditions produce 2^N paths", () => {
  // Built rather than taken from the seed, because the authored journeys top
  // out at one condition each and 2^1 would not distinguish a correct walker
  // from one that forks only at the first fork it meets.
  const build = (n) => {
    let nodes = [N("tail", "stage")];
    for (let i = n; i >= 1; i--) {
      nodes = [cond(`c${i}`, [lane("Yes", [N(`y${i}`, "sms")]), lane("No", [N(`n${i}`, "sms")])]), ...nodes];
    }
    return nodes;
  };

  for (let n = 0; n <= 4; n++) {
    assert.equal(enumeratePaths(build(n)).length, 2 ** n, `${n} conditions must yield ${2 ** n} paths`);
  }

  // Four conditions is sixteen paths, and every one is distinct.
  const paths = enumeratePaths(build(4));
  const shapes = new Set(paths.map((p) => p.map((s) => s.node.id).join(">")));
  assert.equal(shapes.size, 16, "all sixteen paths must be distinct");
});

test("both lanes of a condition are walked, and the tail is shared", () => {
  const paths = enumeratePaths([
    cond("c1", [lane("Qualified", [N("q", "stage")]), lane("Not yet", [N("d", "stage")])]),
    N("tail", "email")
  ]);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map((p) => p.map((s) => s.node.id)), [["c1", "q", "tail"], ["c1", "d", "tail"]]);
  assert.deepEqual(paths.map((p) => p[0].lane), ["Qualified", "Not yet"]);
});

test("nested conditions multiply", () => {
  const paths = enumeratePaths([
    cond("outer", [
      lane("Yes", [cond("inner", [lane("Yes", [N("a", "sms")]), lane("No", [N("b", "sms")])])]),
      lane("No", [N("c", "sms")])
    ])
  ]);
  // Yes>Yes, Yes>No, No — three, not four: the No lane has no inner fork.
  assert.equal(paths.length, 3);
});

test("the six seeded journeys walk to nine paths", () => {
  const counts = Object.fromEntries(
    Object.entries(SEED_JOURNEYS).map(([k, j]) => [k, enumeratePaths(j.nodes).length])
  );
  assert.deepEqual(counts, { client: 2, setter: 2, closer: 2, advisor: 1, affiliate: 1, partner: 1 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 9);
});

// ── the registry ──────────────────────────────────────────────────────────

/* 48 SINCE contract-chaser.mjs JOINED THE REGISTRY (2026-08-02).
   It is a CRON function with no event trigger, so no journey will ever reach it
   and it will always sit in neverFired — which is the correct outcome, not a
   coverage hole. The counts here are pinned so that registering a workflow stays
   a visible decision; see the note in src/workflows/index.test.mjs. */
test("ACCEPTANCE: the registry accounts for all 49 registered workflows", async () => {
  const reg = await loadRegistry();
  assert.equal(reg.registered, 49, "src/workflows/index.mjs registers 49 functions");
  assert.equal(
    reg.workflows.length + reg.unrunnable.length,
    49,
    "every registered workflow is either runnable or explicitly listed as unrunnable"
  );
  assert.deepEqual(reg.unrunnable, [], "no registered workflow should be unreachable by the runner");
});

test("every workflow is either fired or named in neverFired — none silently missing", async () => {
  const reg = await loadRegistry();
  const pretendFired = ["n-06-renewal-second-wave", "s-02-incomplete-survey-nudge"];
  const never = neverFired(reg, pretendFired);
  assert.equal(never.length + pretendFired.length, 49);
  const all = new Set([...never.map((w) => w.id), ...pretendFired]);
  assert.equal(all.size, 49);
  for (const fn of functions) assert.ok(all.has(fn.id()), `${fn.id()} is unaccounted for`);
});

// ── a full walk ───────────────────────────────────────────────────────────

/* A Postgres stand-in wide enough to let the real bus and the real workflow
   bodies run. Reads answer empty, which is the honest shape of a fresh
   database: no templates, no funding rounds, no prior state. Writes are
   recorded so the walk can be inspected. */
function fakeDb() {
  const clients = [];
  const events = [];
  const inserted = [];
  let seq = 0;
  return {
    clients,
    events,
    inserted,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      inserted.push(s.slice(0, 60));

      if (/^INSERT INTO clients/i.test(s)) {
        const row = {
          id: `cl-${++seq}`,
          org_id: params[0],
          first_name: params[1],
          last_name: params[2],
          email: params[3],
          phone: params[4],
          custom_fields: JSON.parse(params[5])
        };
        clients.push(row);
        return { rows: [row] };
      }
      if (/^INSERT INTO events/i.test(s)) {
        const row = { id: `ev-${++seq}` };
        events.push({ name: params[1] ?? null });
        return { rows: [row], rowCount: 1 };
      }
      // Everything else: no rows. No templates means sendTemplated returns
      // template_pending, which is exactly what a fresh database does.
      return { rows: [], rowCount: 0 };
    }
  };
}

test("ACCEPTANCE: every walked path gets its own synthetic client", async () => {
  const db = fakeDb();
  const report = await run(db, {
    journeys: SEED_JOURNEYS,
    orgId: "org-1",
    runId: "t1",
    env: {}
  });

  assert.equal(report.paths.length, 9, "nine paths across the six seeded journeys");

  const ids = report.paths.map((p) => p.clientId);
  assert.equal(new Set(ids).size, 9, "each path forks its own client — no sharing");

  for (const row of db.clients) {
    assert.ok(isSyntheticRow(row), "every minted client carries the synthetic marker");
    assert.match(row.email, /@runner\.fundhub\.invalid$/, "and an unroutable address");
  }
});

test("a walk records branches, steps and virtual time", async () => {
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t2", env: {}, only: "client" });

  assert.equal(report.paths.length, 2);
  const [yes, no] = report.paths;
  assert.deepEqual(yes.branches.map((b) => b.lane), ["Yes"]);
  assert.deepEqual(no.branches.map((b) => b.lane), ["No"]);
  assert.equal(yes.branches[0].field, "survey_complete");

  // The client journey holds a two-day wait, so virtual time must have moved
  // by at least that much.
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  assert.ok(yes.virtualElapsedMs >= twoDays, `expected >= ${twoDays}, got ${yes.virtualElapsedMs}`);
  assert.ok(yes.steps.some((s) => s.type === "wait" && s.waitedMs === twoDays));
  assert.equal(yes.terminal, "complete");
});

test("the coverage report names every unreached workflow explicitly", async () => {
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t3", env: {} });
  const c = report.workflowCoverage;
  assert.equal(c.registered, 49);
  assert.equal(
    c.fired.length + c.neverFired.length,
    49,
    "fired + neverFired must account for all 49 — a workflow missing from both is a silent coverage hole"
  );
});

test("a journey with no canonical start event is reported, not invented", async () => {
  assert.equal(START_EVENT.partner, null);
  const db = fakeDb();
  const report = await run(db, { journeys: SEED_JOURNEYS, orgId: "org-1", runId: "t4", env: {} });
  assert.deepEqual(report.journeysWithoutStartEvent, ["partner"]);
  const partnerPath = report.paths.find((p) => p.pathId.startsWith("partner#"));
  assert.deepEqual(partnerPath.events, [], "no event may be fabricated for it");
});
