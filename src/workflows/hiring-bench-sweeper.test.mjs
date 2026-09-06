// The hiring bench sweeper — the clock, not the rule.
//
// The bench rule itself lives in src/hiring/bench.mjs and the routing lives in
// src/hiring/owner.mjs; both are tested where they are written. What is tested
// here is what a scheduled job gets wrong:
//
//   * the schedule — daily, and at an hour that cannot straddle the UTC date
//     boundary the task dedupe key is built from;
//   * that it is actually registered, because a workflow absent from
//     src/workflows/index.mjs is a workflow that never runs, which is the exact
//     failure that file's own comments record twice;
//   * that one company's failure does not take the pass down;
//   * and that the pass writes TASKS AND NOTHING ELSE — no candidate touched, no
//     job posted, nothing transmitted.
//
// The database is a stub rather than a mock of checkBench, so the real bench
// module and the real routing resolver run inside every one of these passes.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sweep, handle, orgsWithHiringRoles, SWEEP_CRON, SOURCE_WORKFLOW,
  TASK_SOURCE_WORKFLOW, hiringBenchSweeper
} from "./hiring-bench-sweeper.mjs";
import { functions } from "./index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

/* A scripted Postgres. Needles are matched in order against the SQL text, so
   they are chosen to be unambiguous — "hiring_roles" alone would match both the
   org enumeration and the ownership lookup. */
function stubDb(script) {
  const calls = [];
  const db = {
    calls,
    inserts: () => calls.filter((c) => /INSERT INTO tasks/.test(c.sql)),
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) {
          const out = typeof reply === "function" ? reply(params, calls) : reply;
          if (out instanceof Error) throw out;
          return out;
        }
      }
      throw new Error(`stubDb: no scripted reply for: ${sql.slice(0, 100)}`);
    }
  };
  return db;
}

/** A v_hiring_bench row. bench_shortfall is what checkBench actually branches on. */
function benchRow(over = {}) {
  return {
    role_id: "role-1",
    role_key: "closer",
    role_name: "Closer",
    bench_target: 4,
    bench_count: 1,
    bench_shortfall: 3,
    open_applications: 6,
    hiring_manager_staff_id: null,
    ...over
  };
}

/* The default script: one short closer req per company, a standing rule sending
   it to the sales manager, no existing task, and a successful insert. */
function defaultScript({ bench = [benchRow()], ownerRole = "sales_manager" } = {}) {
  return [
    ["DISTINCT org_id", { rows: [{ org_id: ORG_A }, { org_id: ORG_B }] }],
    ["v_hiring_bench", { rows: bench }],
    ["manager_status", { rows: [{ hiring_manager_staff_id: null, owner_role: ownerRole, manager_status: null }] }],
    ["SELECT id FROM tasks", { rows: [] }],
    ["INSERT INTO tasks", { rows: [{ id: "task-1" }] }]
  ];
}

describe("the schedule", () => {
  test("runs once a day", () => {
    assert.equal(SWEEP_CRON, "30 13 * * *");
    const [minute, hour, dom, month, dow] = SWEEP_CRON.split(" ");
    assert.equal(dom, "*");
    assert.equal(month, "*");
    assert.equal(dow, "*");
    assert.equal(minute, "30");
    assert.equal(hour, "13", "07:30 America/Denver during MDT, 06:30 during MST");
  });

  test("the hour cannot straddle the UTC date the dedupe key is built from", () => {
    // checkBench keys its task on the UTC calendar date. A job scheduled near
    // midnight UTC would land on either side of that boundary as the clocks move,
    // and write two tasks for one working day.
    const hour = Number(SWEEP_CRON.split(" ")[1]);
    assert.ok(hour >= 2 && hour <= 21,
      `hour ${hour} is too close to the UTC date boundary for a date-keyed job`);
  });

  test("the function is registered, so it will actually fire", () => {
    assert.ok(functions.includes(hiringBenchSweeper),
      "hiringBenchSweeper is missing from src/workflows/index.mjs");
  });

  test("it has an id and a name a human can find on the Automations screen", () => {
    // `id` on an Inngest function is a METHOD (it prefixes with the app id), so
    // the configured value is read off opts.
    assert.equal(hiringBenchSweeper?.opts?.id, "hiring-bench-sweeper");
    assert.equal(typeof hiringBenchSweeper?.opts?.name, "string");
    assert.ok(hiringBenchSweeper.opts.name.length > 0);
    assert.equal(SOURCE_WORKFLOW, "hiring-bench-sweeper");
  });

  test("it is a cron job with no event trigger", () => {
    const triggers = hiringBenchSweeper?.opts?.triggers || [];
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].cron, SWEEP_CRON);
    assert.equal(triggers[0].event, undefined, "a hiring clock must not be event-driven");
  });
});

describe("one pass", () => {
  test("opens one task per short role, per company, and reports it", async () => {
    const db = stubDb(defaultScript());
    const out = await sweep(db, { now: "2026-09-05T13:30:00Z" });

    assert.equal(out.ok, true);
    assert.equal(out.orgs, 2);
    assert.equal(out.roles, 2, "one active req read per company");
    assert.equal(out.short, 2);
    assert.equal(out.tasks_created, 2);
    assert.equal(out.failed, 0);
    assert.equal(db.inserts().length, 2);
    assert.deepEqual(out.per.map((p) => p.orgId), [ORG_A, ORG_B]);
  });

  test("a role at or above target opens nothing", async () => {
    const db = stubDb(defaultScript({
      bench: [benchRow({ bench_count: 4, bench_shortfall: 0 })]
    }));
    const out = await sweep(db, { now: "2026-09-05T13:30:00Z" });

    assert.equal(out.short, 0);
    assert.equal(out.tasks_created, 0);
    assert.equal(out.roles, 2, "the role is still read — it is simply not short");
    assert.equal(db.inserts().length, 0, "a healthy bench must not create work");
  });

  test("the alert is routed by the rule, not hardcoded to one queue", async () => {
    // This is the whole reason migration 294 exists: before it every bench alert
    // for every role landed on 'admin'.
    const db = stubDb(defaultScript({ ownerRole: "sales_manager" }));
    await sweep(db, { now: "2026-09-05T13:30:00Z" });

    const params = db.inserts()[0].params;
    assert.equal(params[6], "sales_manager", "assignee_role should come from owner_role");
    assert.equal(params[7], null, "no individual is named on this fixture");

    const toOwner = stubDb(defaultScript({ ownerRole: "owner" }));
    await sweep(toOwner, { now: "2026-09-05T13:30:00Z" });
    assert.equal(toOwner.inserts()[0].params[6], "owner",
      "a non-sales req goes to the owner, not to the sales manager");
  });

  test("every company in one pass is keyed to the same day", async () => {
    // A pass that straddles midnight must not write today's task for one company
    // and tomorrow's for the next. The date is resolved once, at the top.
    const db = stubDb(defaultScript());
    await sweep(db, { now: "2026-09-05T23:59:59Z" });

    const bodies = db.inserts().map((c) => c.params[3]);
    assert.deepEqual(bodies, [
      "hiring:bench:closer:2026-09-05",
      "hiring:bench:closer:2026-09-05"
    ]);
  });

  test("the task carries the bench monitor's name, not the clock's", async () => {
    const db = stubDb(defaultScript());
    await sweep(db, { now: "2026-09-05T13:30:00Z" });
    assert.equal(db.inserts()[0].params[5], TASK_SOURCE_WORKFLOW);
    assert.notEqual(TASK_SOURCE_WORKFLOW, SOURCE_WORKFLOW);
  });

  test("a task that already exists for today is not written twice", async () => {
    const db = stubDb([
      ["DISTINCT org_id", { rows: [{ org_id: ORG_A }] }],
      ["v_hiring_bench", { rows: [benchRow()] }],
      ["manager_status", { rows: [{ hiring_manager_staff_id: null, owner_role: "sales_manager", manager_status: null }] }],
      ["SELECT id FROM tasks", { rows: [{ id: "already-there" }] }],
      ["INSERT INTO tasks", { rows: [{ id: "should-not-happen" }] }]
    ]);
    const out = await sweep(db, { now: "2026-09-05T13:30:00Z" });

    assert.equal(out.short, 1, "the shortfall is still reported");
    assert.equal(out.tasks_created, 0, "but no second task is opened");
    assert.equal(db.inserts().length, 0);
  });

  test("an orgId narrows the pass and skips the enumeration entirely", async () => {
    const db = stubDb(defaultScript());
    const out = await sweep(db, { orgId: ORG_B, now: "2026-09-05T13:30:00Z" });

    assert.equal(out.orgs, 1);
    assert.deepEqual(out.per.map((p) => p.orgId), [ORG_B]);
    assert.equal(db.calls.filter((c) => c.sql.includes("DISTINCT org_id")).length, 0);
  });

  test("reports when a shortfall reached a queue but no named person", async () => {
    const db = stubDb(defaultScript());
    const out = await sweep(db, { orgId: ORG_A, now: "2026-09-05T13:30:00Z" });
    assert.equal(out.unrouted, 1, "nobody individually owns this req");
    assert.equal(out.per[0].shortfalls[0].assignee_role, "sales_manager",
      "unrouted means no PERSON, not no destination");
  });
});

describe("it never takes itself down", () => {
  test("one company failing does not stop the others", async () => {
    let seen = 0;
    const db = stubDb([
      ["DISTINCT org_id", { rows: [{ org_id: ORG_A }, { org_id: ORG_B }] }],
      ["v_hiring_bench", (params) => {
        seen += 1;
        if (params[0] === ORG_A) return new Error("bench view exploded");
        return { rows: [benchRow()] };
      }],
      ["manager_status", { rows: [{ hiring_manager_staff_id: null, owner_role: "owner", manager_status: null }] }],
      ["SELECT id FROM tasks", { rows: [] }],
      ["INSERT INTO tasks", { rows: [{ id: "task-b" }] }]
    ]);

    const out = await sweep(db, { now: "2026-09-05T13:30:00Z" });

    assert.equal(seen, 2, "the second company is still read");
    assert.equal(out.ok, true, "a per-company failure is not a failed pass");
    assert.equal(out.failed, 1);
    assert.equal(out.tasks_created, 1);
    assert.equal(out.per[0].ok, false);
    assert.match(out.per[0].error, /bench view exploded/);
    assert.equal(out.per[1].ok, true);
  });

  test("a database that will not answer at all returns a reason instead of throwing", async () => {
    const db = stubDb([["DISTINCT org_id", new Error("connection refused")]]);
    const out = await sweep(db, {});

    assert.equal(out.ok, false);
    assert.match(out.error, /connection refused/);
    assert.equal(out.orgs, 0);
    assert.equal(out.tasks_created, 0);
  });

  test("handle() runs a pass and is what the journey runner calls", async () => {
    const db = stubDb(defaultScript());
    const steps = [];
    const out = await handle({
      db,
      step: { run: (name, fn) => { steps.push(name); return fn(); } }
    });
    assert.deepEqual(steps, ["sweep"]);
    assert.equal(out.ok, true);
    assert.equal(out.orgs, 2);
  });

  test("orgsWithHiringRoles asks only about live reqs", async () => {
    const db = stubDb([["DISTINCT org_id", { rows: [{ org_id: ORG_A }] }]]);
    assert.deepEqual(await orgsWithHiringRoles(db), [ORG_A]);
    // Matched to v_hiring_bench's own WHERE clause so the two cannot disagree.
    assert.match(db.calls[0].sql, /FROM hiring_roles WHERE active/);
  });
});

describe("what this job is not allowed to do", () => {
  const src = fs.readFileSync(path.join(HERE, "hiring-bench-sweeper.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("no candidate is ever rejected, advanced or scored by this clock", () => {
    for (const forbidden of ["reject", "advance", "scoreApplication", "candidate_applications", "hiring_decisions"]) {
      assert.doesNotMatch(code, new RegExp(forbidden),
        `the sweeper must not touch "${forbidden}" — decisions about a person are a human's`);
    }
  });

  test("it posts no job and imports nothing that transmits", () => {
    assert.doesNotMatch(code, /linkedin/i, "no job posting from a scheduled run");
    assert.doesNotMatch(code, /hire-closer/, "actOnPacked stays behind the button");
    assert.doesNotMatch(code, /messaging|sendTemplated/, "nothing is emailed or texted");
    assert.doesNotMatch(code, /fetch\(/, "outbound transmission belongs in src/messaging/providers only");
  });

  test("the header records why the packed-calendar rule was left unscheduled", () => {
    // A decision this size that is not written down gets re-litigated by the next
    // agent, who will schedule the LinkedIn poster.
    assert.match(src, /actOnPacked/, "the header must name the mechanism it rejected");
    assert.match(src, /assigneeFor/, "and the routing constraint that decided it");
  });
});
