import { test } from "node:test";
import assert from "node:assert";
import { isFundingPath, isRepairOnlyPath, clientOutcomeTier, resolveOutcomeTier } from "./product-path.mjs";

// Fake db returning whatever clients.outcome_tier we want, and counting reads so the
// payload-preferred path can be shown to skip the query entirely.
function fakeDb(outcomeTier, counter = {}) {
  counter.reads = 0;
  return {
    query(sql, params) {
      if (/SELECT outcome_tier FROM clients WHERE id/.test(sql)) {
        counter.reads += 1;
        return { rows: params[0] === "cl-1" ? [{ outcome_tier: outcomeTier }] : [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test("isFundingPath: the three funding tiers only", () => {
  assert.equal(isFundingPath("FUNDING_PLUS_REPAIR"), true);
  assert.equal(isFundingPath("FULL_FUNDING"), true);
  assert.equal(isFundingPath("PREMIUM_STACK"), true);
  assert.equal(isFundingPath("REPAIR_ONLY"), false);
  assert.equal(isFundingPath("MANUAL_REVIEW"), false);
});

test("isFundingPath / isRepairOnlyPath: null and unrecognized fail closed", () => {
  for (const bad of [null, undefined, "", "NOT_A_TIER"]) {
    assert.equal(isFundingPath(bad), false, `isFundingPath(${bad})`);
    assert.equal(isRepairOnlyPath(bad), false, `isRepairOnlyPath(${bad})`);
  }
});

test("clientOutcomeTier: reads the column, null for unknown client", async () => {
  assert.equal(await clientOutcomeTier(fakeDb("PREMIUM_STACK"), "cl-1"), "PREMIUM_STACK");
  assert.equal(await clientOutcomeTier(fakeDb("PREMIUM_STACK"), "cl-missing"), null);
  assert.equal(await clientOutcomeTier(fakeDb("PREMIUM_STACK"), null), null);
});

// --- resolveOutcomeTier ------------------------------------------------------
// The regression this exists for: a workflow triggered by analysis.completed runs
// BEFORE decision.rendered writes clients.outcome_tier, so the column is null on a
// first pull. The tier is on its own payload — prefer it.

test("resolveOutcomeTier: payload tier wins over a null column (the analysis-time case)", async () => {
  const counter = {};
  const tier = await resolveOutcomeTier(fakeDb(null, counter), "cl-1", { outcomeTier: "FULL_FUNDING", source: "crs" });
  assert.equal(tier, "FULL_FUNDING");
  assert.equal(counter.reads, 0, "should not need the column at all");
});

test("resolveOutcomeTier: payload tier wins over a STALE column (the re-pull case)", async () => {
  const tier = await resolveOutcomeTier(fakeDb("REPAIR_ONLY"), "cl-1", { outcomeTier: "FULL_FUNDING" });
  assert.equal(tier, "FULL_FUNDING");
});

test("resolveOutcomeTier: falls back to the column when the payload has no tier", async () => {
  const counter = {};
  const db = fakeDb("REPAIR_ONLY", counter);
  assert.equal(await resolveOutcomeTier(db, "cl-1", { source: "crs" }), "REPAIR_ONLY");
  assert.equal(await resolveOutcomeTier(db, "cl-1", undefined), "REPAIR_ONLY");
  assert.equal(counter.reads, 2);
});

test("resolveOutcomeTier: null when neither payload nor column has a tier", async () => {
  assert.equal(await resolveOutcomeTier(fakeDb(null), "cl-1", {}), null);
});
