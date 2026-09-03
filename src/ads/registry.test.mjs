// src/ads/registry.test.mjs — the registry file is well-formed and the seeding
// rules the owner set on 2026-09-03 hold for every ad it lists. No database.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import {
  loadRegistry, parseRegistry, resolveAd, adsWithTag, laneOf, adIdOf, variantOf, UNKNOWN_AD, _resetRegistry
} from "./registry.mjs";

const RULES = {
  funding600: { gate: "600", entry: "direct", primary_offer: "funding_dfy" },
  premium: { gate: "720", entry: "direct", primary_offer: "funding_dfy" },
  sorting: { gate: "none", entry: "sorting", secondary_offers: "all" },
  uwiq: { gate: "none", entry: "sorting", primary_offer: "capital_blueprint", secondary_offers: "all" },
  wl: { gate: "none", entry: "direct", primary_offer: "white_label" }
};

describe("docs/ads/registry.json", () => {
  beforeEach(() => _resetRegistry());

  test("loads, and every ad obeys its lane's seeding rule", () => {
    const reg = loadRegistry({ reload: true });
    assert.ok(reg.ads.length >= 24, "the owner named 24 ad ids on 2026-09-03");
    for (const ad of reg.ads) {
      const rule = RULES[ad.lane];
      assert.ok(rule, `ad ${ad.id} lane ${ad.lane}`);
      for (const [k, v] of Object.entries(rule)) {
        assert.equal(ad[k], v, `ad ${ad.id} (${ad.lane}) ${k}`);
      }
      if (ad.entry === "sorting") assert.equal(ad.secondary_offers, "all", `ad ${ad.id} sorting means every road is open`);
    }
  });

  test("the owner's named ids resolve to the right lane", () => {
    const want = {
      16: "funding600",
      26: "uwiq", 27: "uwiq", 28: "uwiq", 29: "uwiq", 30: "uwiq", 31: "uwiq",
      42: "funding600", 43: "sorting", 44: "funding600", 45: "sorting", 46: "sorting",
      72: "wl", 73: "wl", 74: "wl", 75: "wl", 76: "wl",
      77: "funding600", 78: "sorting", 79: "sorting", 80: "premium", 81: "funding600",
      82: "premium", 83: "sorting"
    };
    for (const [id, lane] of Object.entries(want)) {
      const ad = resolveAd(id);
      assert.equal(ad.known, true, `ad ${id} is in the registry`);
      assert.equal(ad.lane, lane, `ad ${id} lane`);
    }
    // Slam ads 43/45/46 are sorting rules WITH a primary of funding_dfy.
    for (const id of ["43", "45", "46"]) assert.equal(resolveAd(id).primary_offer, "funding_dfy");
    // Sedona sorting ads and the objection sorting ad have no primary.
    for (const id of ["78", "79", "83"]) assert.equal(resolveAd(id).primary_offer, "none");
    assert.equal(resolveAd("42").title, "ringlights");
    assert.equal(resolveAd("26").title, "underwriter");
    assert.equal(resolveAd("16").title, "phase");
  });

  test("an unknown ad id resolves to the sorting default and is logged once", () => {
    const seen = [];
    const log = { warn: (m) => seen.push(m) };
    const a = resolveAd("999", { log });
    assert.equal(a.known, false);
    assert.equal(a.id, "999");
    assert.equal(a.gate, "none");
    assert.equal(a.entry, "sorting");
    assert.equal(a.primary_offer, "none");
    assert.equal(a.secondary_offers, "all");
    resolveAd("999", { log });
    assert.equal(seen.length, 1, "warned once per id, not per call");
    assert.match(seen[0], /unknown ad_id 999/);
    assert.strictEqual(resolveAd(null, { log }), UNKNOWN_AD);
  });

  test("adsWithTag answers the tag questions the books endpoint groups on", () => {
    const g600 = adsWithTag("gate", "600").map((a) => a.id);
    assert.ok(g600.includes("42") && g600.includes("16") && !g600.includes("43"));
    const wl = adsWithTag("primary_offer", "white_label").map((a) => a.id);
    assert.deepEqual(wl, ["72", "73", "74", "75", "76"]);
    // A sorting ad's "all" counts under every real offer, never under none.
    assert.ok(adsWithTag("secondary_offer", "capital_academy").some((a) => a.id === "78"));
    assert.ok(!adsWithTag("secondary_offer", "none").some((a) => a.id === "78"));
  });

  test("parseRegistry refuses a bad entry loudly", () => {
    const good = { id: "1", lane: "premium", gate: "720", entry: "direct", primary_offer: "funding_dfy", secondary_offers: [], variants: [] };
    assert.doesNotThrow(() => parseRegistry({ ads: [good] }));
    assert.throws(() => parseRegistry({ ads: [{ ...good, gate: "650" }] }), /gate must be one of/);
    assert.throws(() => parseRegistry({ ads: [{ ...good, lane: "meta" }] }), /lane must be one of/);
    assert.throws(() => parseRegistry({ ads: [{ ...good, entry: "sorting" }] }), /every road is open/);
    assert.throws(() => parseRegistry({ ads: [good, good] }), /listed twice/);
    assert.throws(() => parseRegistry({ ads: [{ ...good, secondary_offers: ["nope"] }] }), /secondary_offers contains/);
  });

  test("JS mirrors of the SQL derivations agree with 286", () => {
    assert.equal(laneOf(" Funding600 "), "funding600");
    assert.equal(laneOf("meta"), "unknown");
    assert.equal(laneOf(null), "unknown");
    assert.equal(adIdOf("16-phase"), "16");
    assert.equal(adIdOf("42"), "42");
    assert.equal(adIdOf("26_underwriter"), "26");
    assert.equal(adIdOf("oVid: 3"), null);
    assert.equal(adIdOf(""), null);
    assert.equal(variantOf(" No Sun! "), "no-sun");
    assert.equal(variantOf("sedona"), "sedona");
    assert.equal(variantOf(""), null);
  });
});
