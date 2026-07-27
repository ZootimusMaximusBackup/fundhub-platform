import { test } from "node:test";
import assert from "node:assert";
import {
  ruleSpecificity, isEffective, matchesScope, selectBaseRule, selectBonusRules, selectRules
} from "./rules.mjs";

const PRODUCT = "prod-card-stacking";
const OTHER_PRODUCT = "prod-repair";
const STAFF = "staff-jess";

// A rule is just a row. Nothing in these tests hard-codes a real rate — the
// numbers are arbitrary fixtures, exactly as they would arrive from the DB.
const rule = (over = {}) => ({
  id: over.id || "r-" + Math.random().toString(36).slice(2, 8),
  name: "fixture",
  basis: "front_end",
  stacking: "base",
  product_id: null,
  role: null,
  staff_id: null,
  calc_method: "percent",
  percent: 5,
  amount_basis: "deposit_collected",
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  active: true,
  ...over
});

const CTX = { basis: "front_end", product_id: PRODUCT, role: "closer", staff_id: STAFF };
const JULY = "2026-07-15T00:00:00Z";

test("ruleSpecificity: person beats product beats role beats global", () => {
  const global = rule();
  const byRole = rule({ role: "closer" });
  const byProduct = rule({ product_id: PRODUCT });
  const byProductRole = rule({ product_id: PRODUCT, role: "closer" });
  const byStaff = rule({ staff_id: STAFF });
  const byStaffProduct = rule({ staff_id: STAFF, product_id: PRODUCT });

  const ordered = [byStaffProduct, byStaff, byProductRole, byProduct, byRole, global];
  const scores = ordered.map(ruleSpecificity);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] > scores[i], `expected strictly descending, got ${scores}`);
  }
});

test("ruleSpecificity: naming a person outranks naming a product and a role together", () => {
  assert.ok(ruleSpecificity(rule({ staff_id: STAFF })) >
            ruleSpecificity(rule({ product_id: PRODUCT, role: "closer" })));
});

test("isEffective: window is [from, to) — no gap, no overlap at a handover", () => {
  const r = rule({ effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-07-01T00:00:00Z" });
  assert.equal(isEffective(r, "2025-12-31T23:59:59Z"), false);
  assert.equal(isEffective(r, "2026-01-01T00:00:00Z"), true, "from is inclusive");
  assert.equal(isEffective(r, "2026-06-30T23:59:59Z"), true);
  assert.equal(isEffective(r, "2026-07-01T00:00:00Z"), false, "to is exclusive");
});

test("isEffective: an open-ended rule is in force forever forward", () => {
  assert.equal(isEffective(rule(), "2099-01-01T00:00:00Z"), true);
});

test("isEffective: inactive is never in force, whatever the dates say", () => {
  assert.equal(isEffective(rule({ active: false }), JULY), false);
});

test("matchesScope: NULL means 'all' and matches anything", () => {
  assert.equal(matchesScope(rule(), CTX), true);
  assert.equal(matchesScope(rule({ product_id: PRODUCT }), CTX), true);
  assert.equal(matchesScope(rule({ product_id: OTHER_PRODUCT }), CTX), false);
  assert.equal(matchesScope(rule({ role: "funding_advisor" }), CTX), false);
  assert.equal(matchesScope(rule({ staff_id: "staff-someone-else" }), CTX), false);
});

test("selectBaseRule: the most specific rule wins", () => {
  const global = rule({ id: "global", percent: 1 });
  const byRole = rule({ id: "role", role: "closer", percent: 2 });
  const byProduct = rule({ id: "product", product_id: PRODUCT, percent: 3 });
  const override = rule({ id: "override", staff_id: STAFF, percent: 9 });

  assert.equal(selectBaseRule([global], CTX, JULY).id, "global");
  assert.equal(selectBaseRule([global, byRole], CTX, JULY).id, "role");
  assert.equal(selectBaseRule([global, byRole, byProduct], CTX, JULY).id, "product");
  assert.equal(selectBaseRule([global, byRole, byProduct, override], CTX, JULY).id, "override",
    "a per-person override beats everything");
});

test("selectBaseRule: a rule for another basis is never considered", () => {
  const backEnd = rule({ id: "back", basis: "back_end", amount_basis: "amount_funded" });
  assert.equal(selectBaseRule([backEnd], CTX, JULY), null);
});

test("selectBaseRule: no configured rate returns null — nothing is invented", () => {
  assert.equal(selectBaseRule([], CTX, JULY), null);
  assert.equal(selectBaseRule([rule({ product_id: OTHER_PRODUCT })], CTX, JULY), null);
});

test("selectBaseRule: changing a rate does not reach backwards — the old date gets the old rule", () => {
  const oldRate = rule({ id: "v1", percent: 5,
    effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-07-01T00:00:00Z" });
  const newRate = rule({ id: "v2", percent: 8,
    effective_from: "2026-07-01T00:00:00Z", effective_to: null });
  const both = [oldRate, newRate];

  assert.equal(selectBaseRule(both, CTX, "2026-03-01T00:00:00Z").id, "v1");
  assert.equal(selectBaseRule(both, CTX, "2026-09-01T00:00:00Z").id, "v2");
  assert.equal(selectBaseRule(both, CTX, "2026-07-01T00:00:00Z").id, "v2",
    "handover instant belongs to the new rule");
});

test("selectBonusRules: bonuses stack — every match is returned, not just the best", () => {
  const base = rule({ id: "base" });
  const b1 = rule({ id: "bonus-role", stacking: "bonus", role: "closer" });
  const b2 = rule({ id: "bonus-product", stacking: "bonus", product_id: PRODUCT });
  const b3 = rule({ id: "bonus-other", stacking: "bonus", product_id: OTHER_PRODUCT });

  const got = selectBonusRules([base, b1, b2, b3], CTX, JULY).map((r) => r.id);
  assert.equal(got.length, 2);
  assert.ok(got.includes("bonus-role") && got.includes("bonus-product"));
  assert.ok(!got.includes("base"), "a base rule is never returned as a bonus");
});

test("selectBonusRules: an expired bonus stops stacking", () => {
  const expired = rule({ id: "old-bonus", stacking: "bonus",
    effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-06-01T00:00:00Z" });
  assert.deepEqual(selectBonusRules([expired], CTX, JULY), []);
});

test("selectRules: base first, then bonuses, in application order", () => {
  const base = rule({ id: "base" });
  const bonus = rule({ id: "bonus", stacking: "bonus" });
  const { applied } = selectRules([bonus, base], CTX, JULY);
  assert.deepEqual(applied.map((r) => r.id), ["base", "bonus"]);
});

test("selectRules: bonuses still apply when no base rate is configured, and the gap is visible", () => {
  const bonus = rule({ id: "bonus", stacking: "bonus" });
  const { base, applied } = selectRules([bonus], CTX, JULY);
  assert.equal(base, null);
  assert.deepEqual(applied.map((r) => r.id), ["bonus"]);
});

test("compareRules is deterministic when two rules somehow tie", () => {
  const a = rule({ id: "aaa", role: "closer" });
  const b = rule({ id: "bbb", role: "closer" });
  assert.equal(selectBaseRule([a, b], CTX, JULY).id, selectBaseRule([b, a], CTX, JULY).id);
});
