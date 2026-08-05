import { test } from "node:test";
import assert from "node:assert";
import { daysForPeriod, formatCents, formatRate } from "./kpis.mjs";

test("daysForPeriod: known windows", () => {
  assert.equal(daysForPeriod("today"), 1);
  assert.equal(daysForPeriod("7d"), 7);
  assert.equal(daysForPeriod("30d"), 30);
  assert.ok(daysForPeriod("qtd") >= 1);
  assert.equal(daysForPeriod("unknown"), 7);
});

test("formatCents: null is em dash, not zero", () => {
  assert.equal(formatCents(null), "—");
  assert.equal(formatCents(0), "$0");
  assert.equal(formatCents(3200), "$32");
  assert.equal(formatCents(19840000), "$198k");
});

test("formatRate: null is em dash", () => {
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(0.5), "50%");
  assert.equal(formatRate(0), "0%");
});
