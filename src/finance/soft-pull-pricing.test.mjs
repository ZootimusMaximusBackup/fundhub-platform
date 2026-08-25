import { test } from "node:test";
import assert from "node:assert/strict";
import {
  softPullBaseCents,
  softPullTotalCents,
  softPullPricingPublic,
  SOFT_PULL_BUSINESS_ADDON_CENTS,
  SOFT_PULL_MAX_BUSINESSES
} from "./soft-pull-pricing.mjs";

test("base soft-pull is $32 (3200 cents)", () => {
  assert.equal(softPullBaseCents(), 3200);
});

test("business addon is $10 each", () => {
  assert.equal(SOFT_PULL_BUSINESS_ADDON_CENTS, 1000);
  assert.equal(SOFT_PULL_MAX_BUSINESSES, 20);
});

test("total = 32 + 10×n for 0–20 businesses", () => {
  assert.equal(softPullTotalCents(0), 3200);
  assert.equal(softPullTotalCents(1), 4200);
  assert.equal(softPullTotalCents(2), 5200);
  assert.equal(softPullTotalCents(3), 6200);
  assert.equal(softPullTotalCents(4), 7200);
  assert.equal(softPullTotalCents(5), 8200);
  assert.equal(softPullTotalCents(6), 9200);
  assert.equal(softPullTotalCents(20), 23200);
});

test("rejects business counts outside 0–20", () => {
  assert.throws(() => softPullTotalCents(-1), /0–20/);
  assert.throws(() => softPullTotalCents(21), /0–20/);
  assert.throws(() => softPullTotalCents(1.5), /0–20/);
  assert.throws(() => softPullTotalCents("2"), /0–20/);
});

test("public pricing payload matches math", () => {
  const p = softPullPricingPublic();
  assert.equal(p.base_cents, 3200);
  assert.equal(p.business_addon_cents, 1000);
  assert.equal(p.max_businesses, 20);
  assert.equal(p.base_display, "$32");
  assert.equal(p.business_addon_display, "$10");
});
