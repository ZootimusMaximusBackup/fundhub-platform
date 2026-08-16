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

// Matrix (exact CRS strings only — no trim, no case-fold, no aliases):
//   tier                  isFundingPath  isRepairOnlyPath
//   FULL_FUNDING          true           false
//   FUNDING_PLUS_REPAIR   true           false
//   PREMIUM_STACK         true           false
//   REPAIR_ONLY           false          true
//   MANUAL_REVIEW         false          false
//   FRAUD_HOLD            false          false
//   null / undefined / "" false          false
//   typo / lower / spaces false          false

test("isFundingPath: FULL_FUNDING, FUNDING_PLUS_REPAIR, PREMIUM_STACK only", () => {
  assert.equal(isFundingPath("FULL_FUNDING"), true);
  assert.equal(isFundingPath("FUNDING_PLUS_REPAIR"), true);
  assert.equal(isFundingPath("PREMIUM_STACK"), true);
});

test("isFundingPath: MANUAL_REVIEW is not funding (review silence)", () => {
  assert.equal(isFundingPath("MANUAL_REVIEW"), false);
});

test("isFundingPath: REPAIR_ONLY and FRAUD_HOLD are not funding", () => {
  assert.equal(isFundingPath("REPAIR_ONLY"), false);
  assert.equal(isFundingPath("FRAUD_HOLD"), false);
});

test("isRepairOnlyPath: REPAIR_ONLY only", () => {
  assert.equal(isRepairOnlyPath("REPAIR_ONLY"), true);
  assert.equal(isRepairOnlyPath("FULL_FUNDING"), false);
  assert.equal(isRepairOnlyPath("FUNDING_PLUS_REPAIR"), false);
  assert.equal(isRepairOnlyPath("PREMIUM_STACK"), false);
  assert.equal(isRepairOnlyPath("MANUAL_REVIEW"), false);
  assert.equal(isRepairOnlyPath("FRAUD_HOLD"), false);
});

test("isFundingPath / isRepairOnlyPath: null, undefined, empty string fail closed", () => {
  for (const bad of [null, undefined, ""]) {
    assert.equal(isFundingPath(bad), false, `isFundingPath(${JSON.stringify(bad)})`);
    assert.equal(isRepairOnlyPath(bad), false, `isRepairOnlyPath(${JSON.stringify(bad)})`);
  }
});

test("isFundingPath / isRepairOnlyPath: unknown tier names fail closed", () => {
  for (const bad of ["NOT_A_TIER", "FUNDING", "REVIEW", "DENIED"]) {
    assert.equal(isFundingPath(bad), false, `isFundingPath(${bad})`);
    assert.equal(isRepairOnlyPath(bad), false, `isRepairOnlyPath(${bad})`);
  }
});

test("typos / lowercase / extra spaces: exact match only — no normalize", () => {
  // Documented behavior: helpers do not trim or case-fold. Wrong shape ≠ a known tier.
  const noisy = [
    "full_funding",
    "Full_Funding",
    "FULL_FUNDING ",
    " FULL_FUNDING",
    "FULL FUNDING",
    "repair_only",
    "REPAIR_ONLY ",
    " manual_review",
    "MANUAL_REVIEW\n",
    "PREMIUM_STACK\t",
  ];
  for (const bad of noisy) {
    assert.equal(isFundingPath(bad), false, `isFundingPath(${JSON.stringify(bad)})`);
    assert.equal(isRepairOnlyPath(bad), false, `isRepairOnlyPath(${JSON.stringify(bad)})`);
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

test("resolveOutcomeTier: MANUAL_REVIEW from payload is not funding when helpers run", async () => {
  const tier = await resolveOutcomeTier(fakeDb("FULL_FUNDING"), "cl-1", { outcomeTier: "MANUAL_REVIEW" });
  assert.equal(tier, "MANUAL_REVIEW");
  assert.equal(isFundingPath(tier), false);
  assert.equal(isRepairOnlyPath(tier), false);
});
