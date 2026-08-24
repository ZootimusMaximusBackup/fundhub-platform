import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  specialAdCategoryRule,
  costPerBooked,
  marketingSnapshot
} from "./meta-marketing.mjs";
import { MIN_N_RATE } from "./discoveries.mjs";

describe("specialAdCategoryRule", () => {
  it("is mandatory and fail-closed", () => {
    const rule = specialAdCategoryRule();
    assert.equal(rule.required, true);
    assert.equal(rule.fail_closed, true);
    assert.equal(rule.source, "ad_platform_category_map");
  });
});

describe("costPerBooked", () => {
  it("is INSUFFICIENT when booked n is under 10", () => {
    const out = costPerBooked({ spendCents: 100000, bookedN: MIN_N_RATE - 1 });
    assert.equal(out.status, "INSUFFICIENT");
    assert.equal(out.cost_cents, null);
    assert.equal(out.n, 9);
    assert.match(out.note, /Do not invent/);
  });

  it("computes spend per booked call when n is 10 or more", () => {
    const out = costPerBooked({ spendCents: 100000, bookedN: MIN_N_RATE });
    assert.equal(out.status, "MEASURED");
    assert.equal(out.cost_cents, 10000);
    assert.equal(out.n, 10);
  });

  it("does not invent a cost when spend is missing", () => {
    const out = costPerBooked({ spendCents: null, bookedN: 12 });
    assert.equal(out.status, "INSUFFICIENT");
    assert.equal(out.cost_cents, null);
  });
});

describe("marketingSnapshot", () => {
  it("carries spend, cost per booked, and the category rule", () => {
    const out = marketingSnapshot({
      ads: { status: "ok", spend_cents: 50000 },
      bookedN: 10
    });
    assert.equal(out.spend_cents, 50000);
    assert.equal(out.spend_status, "ok");
    assert.equal(out.cost_per_booked.status, "MEASURED");
    assert.equal(out.special_ad_category.required, true);
    assert.match(out.note, /does not buy/);
  });

  it("does not export a campaign write", async () => {
    const mod = await import("./meta-marketing.mjs");
    assert.equal(mod.createCampaign, undefined);
    assert.equal(mod.pauseAd, undefined);
  });
});
