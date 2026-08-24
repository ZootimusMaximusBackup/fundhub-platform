import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { podsFromCounts, companyBarFromPods } from "./pods.mjs";

describe("pods", () => {
  it("pairs one closer with one funding advisor", () => {
    const p = podsFromCounts({ closerCount: 2, faCount: 2 });
    assert.equal(p.complete, 2);
    assert.equal(p.tandem, true);
    assert.equal(p.complete_with, null);
  });

  it("hires a funding advisor when a closer is sitting unpaired", () => {
    const p = podsFromCounts({ closerCount: 3, faCount: 2 });
    assert.equal(p.complete, 2);
    assert.equal(p.unpaired_closers, 1);
    assert.equal(p.complete_with, "funding_advisor");
    assert.equal(p.tandem, false);
  });

  it("hires a closer when a funding advisor is sitting unpaired", () => {
    const p = podsFromCounts({ closerCount: 1, faCount: 2 });
    assert.equal(p.complete_with, "closer");
    assert.equal(p.unpaired_fas, 1);
  });

  it("scales the company bar by complete pods", () => {
    assert.equal(companyBarFromPods(27, { complete: 2 }), 54);
    assert.equal(companyBarFromPods(27, { complete: 0 }), 27);
  });
});
