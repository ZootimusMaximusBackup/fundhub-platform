// COMPLIANCE REVIEW REQUIRED — funding / pre-approval amounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessAgeMultiplier,
  businessFundingDollars,
  resolveBusinessAges,
  stackedBusinessFunding,
  applyStackedBusinessFunding,
  stackedCombinedFromStored
} from "./business-funding.mjs";

test("age brackets match the live UnderwriteIQ Lite engine", () => {
  assert.equal(businessAgeMultiplier(null), 0);
  assert.equal(businessAgeMultiplier(6), 0.5);
  assert.equal(businessAgeMultiplier(11), 0.5);
  assert.equal(businessAgeMultiplier(12), 1.0);
  assert.equal(businessAgeMultiplier(23), 1.0);
  assert.equal(businessAgeMultiplier(24), 2.0);
  assert.equal(businessAgeMultiplier(30), 2.0);
});

test("two businesses produce a higher pre-approval than one, all else equal", () => {
  const card = 137500;
  const one = stackedBusinessFunding(card, [30]);
  const two = stackedBusinessFunding(card, [30, 30]);
  assert.equal(one, card * 2);
  assert.equal(two, card * 4);
  assert.ok(two > one);
});

test("three businesses beat two when the age and card funding stay the same", () => {
  const card = 50000;
  const two = stackedBusinessFunding(card, [18, 18]);
  const three = stackedBusinessFunding(card, [18, 18, 18]);
  assert.equal(two, card * 2);
  assert.equal(three, card * 3);
  assert.ok(three > two);
});

test("unknown age adds nothing — the engine already treats missing age as $0", () => {
  assert.equal(businessFundingDollars(100000, null), 0);
  assert.equal(stackedBusinessFunding(100000, [null, null]), 0);
});

test("no card dollars: extra companies stay $0 — no invented floor", () => {
  assert.equal(stackedBusinessFunding(0, [18, 18]), 0);
  const twoShops = applyStackedBusinessFunding({
    primary_bureau: "experian",
    per_bureau: { experian: { cardFunding: 0 } },
    business: { business_funding: 0, can_business_fund: false },
    totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 }
  }, [18, 18]);
  assert.equal(twoShops.totals.total_business_funding, 0);
  assert.equal(twoShops.totals.total_combined_funding, 0);
});

test("listed companies use their own age, then the client fallback", () => {
  assert.deepEqual(resolveBusinessAges({ fallbackAgeMonths: 30 }), [30]);
  assert.deepEqual(resolveBusinessAges({ businesses: [], fallbackAgeMonths: 30 }), [30]);
  assert.deepEqual(resolveBusinessAges({
    businesses: [{ age_months: 6 }, { age_months: null }],
    fallbackAgeMonths: 30
  }), [6, 30]);
  assert.deepEqual(resolveBusinessAges({
    businesses: [{ name: "A" }, { name: "B" }],
    fallbackAgeMonths: 18
  }), [18, 18]);
  assert.deepEqual(resolveBusinessAges({ businesses: [{ name: "A" }, { name: "B" }] }), [null, null]);
});

test("applyStackedBusinessFunding replaces the one-shop slice", () => {
  const oneShop = applyStackedBusinessFunding({
    primary_bureau: "experian",
    per_bureau: { experian: { cardFunding: 100000 } },
    business: { business_funding: 200000, can_business_fund: true },
    totals: { total_personal_funding: 50000, total_business_funding: 200000, total_combined_funding: 250000 }
  }, [30]);
  const twoShops = applyStackedBusinessFunding({
    primary_bureau: "experian",
    per_bureau: { experian: { cardFunding: 100000 } },
    business: { business_funding: 200000, can_business_fund: true },
    totals: { total_personal_funding: 50000, total_business_funding: 200000, total_combined_funding: 250000 }
  }, [30, 30]);
  assert.equal(oneShop.totals.total_combined_funding, 250000);
  assert.equal(twoShops.totals.total_business_funding, 400000);
  assert.equal(twoShops.totals.total_combined_funding, 450000);
  assert.ok(twoShops.totals.total_combined_funding > oneShop.totals.total_combined_funding);
});

test("stored CRS combined rises when two companies share the same business slice", () => {
  const one = stackedCombinedFromStored({
    totalPersonal: 100000,
    totalBusiness: 50000,
    totalCombined: 150000,
    businessCount: 1
  });
  const two = stackedCombinedFromStored({
    totalPersonal: 100000,
    totalBusiness: 50000,
    totalCombined: 150000,
    businessCount: 2
  });
  assert.equal(one, 150000);
  assert.equal(two, 200000);
  assert.ok(two > one);
});

test("stored combined is left alone when the business slice was never stored", () => {
  assert.equal(stackedCombinedFromStored({
    totalCombined: 127500,
    businessCount: 2
  }), 127500);
});
