// The monthly production-floor job.
//
// The decisions live in src/partners/floors.mjs and are tested there. What is
// tested here is the thing a scheduled job gets wrong: the clock, the fact that it
// never throws, and that it is actually registered — a workflow absent from
// src/workflows/index.mjs is a workflow that never runs, which is the exact
// failure the index's own comments record twice.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  review, handle, REVIEW_CRON, SOURCE_WORKFLOW, partnerProductionFloorReview
} from "./partner-production-floor.mjs";
import { functions } from "./index.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

function stubDb(script) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) return typeof reply === "function" ? reply(params) : reply;
      }
      throw new Error(`stubDb: no scripted reply for: ${sql.slice(0, 90)}`);
    }
  };
}

describe("the schedule", () => {
  test("runs on the 1st of every month", () => {
    assert.equal(REVIEW_CRON, "0 14 1 * *");
    const [minute, hour, dom, month, dow] = REVIEW_CRON.split(" ");
    assert.equal(dom, "1", "day-of-month must be the 1st — W1 §6 cadence");
    assert.equal(month, "*");
    assert.equal(dow, "*");
    assert.equal(minute, "0");
    assert.equal(hour, "14", "08:00 America/Denver during MDT, matching daily-pulse");
  });

  test("the function is registered, so it will actually fire", () => {
    assert.ok(functions.includes(partnerProductionFloorReview),
      "partnerProductionFloorReview is missing from src/workflows/index.mjs");
  });

  test("it has an id and a name a human can find on the Automations screen", () => {
    // `id` on an Inngest function is a METHOD (it prefixes with the app id), so
    // the configured value is read off opts — reading `.id` returns the function
    // source and would pass a sloppy substring check on any function at all.
    const id = partnerProductionFloorReview?.opts?.id;
    assert.equal(id, "partner-production-floor", `unexpected id: ${id}`);
    assert.equal(SOURCE_WORKFLOW, "partner-production-floor");
  });
});

describe("review — one pass", () => {
  test("reports what it did, per outcome", async () => {
    const P = "22222222-2222-4222-8222-222222222222";
    const db = stubDb([
      ["WHERE status = 'active'", { rows: [{ id: P, org_id: ORG }] }],
      ["FROM partners\n   WHERE id = $1", {
        rows: [{
          id: P, org_id: ORG, name: "Alpha", brand_name: null, status: "active",
          revenue_share_pct: "50", activated_at: "2025-01-01T00:00:00.000Z"
        }]
      }],
      ["WITH surviving", { rows: [{ funding_clients: 45 }] }],
      ["window_end <", { rows: [] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-1" }] }]
    ]);
    const r = await review(db, { asOf: "2026-09-01T14:00:00.000Z" });
    assert.equal(r.ok, true);
    assert.equal(r.considered, 1);
    assert.equal(r.evaluated, 1);
    assert.equal(r.good_standing, 1);
    assert.equal(r.downgraded_shares, 0);
  });

  test("a pass that fails outright returns the error rather than throwing", async () => {
    const db = {
      async query() { throw new Error("connection terminated unexpectedly"); }
    };
    const r = await review(db);
    assert.equal(r.ok, false);
    assert.equal(r.evaluated, 0);
    assert.equal(r.downgraded_shares, 0);
    assert.match(r.error, /connection terminated/);
  });

  test("apply:false is a real dry run — nothing is written", async () => {
    const P = "22222222-2222-4222-8222-222222222222";
    const db = stubDb([
      ["WHERE status = 'active'", { rows: [{ id: P, org_id: ORG }] }],
      ["FROM partners\n   WHERE id = $1", {
        rows: [{
          id: P, org_id: ORG, name: "Alpha", brand_name: null, status: "active",
          revenue_share_pct: "50", activated_at: "2025-01-01T00:00:00.000Z"
        }]
      }],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }]
    ]);
    const r = await review(db, { asOf: "2026-09-01T14:00:00.000Z", apply: false });
    assert.equal(r.ok, true);
    assert.equal(r.evaluated, 0);
    assert.equal(r.skipped, 1);
    assert.ok(!db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)),
      "a dry run that writes is not a dry run");
  });

  test("handle() is callable with and without a step runner", async () => {
    const db = stubDb([["WHERE status = 'active'", { rows: [] }]]);
    const direct = await handle({ db });
    assert.equal(direct.ok, true);

    let named = null;
    const stepped = await handle({
      db, step: { run: async (name, fn) => { named = name; return fn(); } }
    });
    assert.equal(named, "review");
    assert.equal(stepped.ok, true);
  });
});
