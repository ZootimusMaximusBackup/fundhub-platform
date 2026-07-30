// Adversarial tests for the Meta targeting validator.
//
// Same discipline as screen.test.mjs: for each banned option, a payload that must
// be rejected and a near-miss that must be accepted. The near-misses matter more
// here than anywhere else in the module, because a validator that rejects legal
// targeting silently pushes people toward turning it off.
//
// The radius cases are the ones worth reading. 15 miles is the floor, so 15 must
// pass and 14.9 must fail — and 20 KILOMETRES must fail, because it is 12.4 miles
// and a validator comparing raw numbers would wave it through.

import { test, describe } from "node:test";
import assert from "node:assert";
import { screenTargeting, buildTargeting, TARGETING_LIMITS } from "./targeting.mjs";

const ok = (t) => screenTargeting(t, { platform: "meta" });
const codes = (res) => res.reasons.map((r) => r.code);

// A payload that satisfies every rule, used as the base each test mutates. If this
// ever stops passing, every "rejects X" test below becomes vacuous.
const CLEAN = {
  age_min: 18, age_max: 65, genders: [1, 2],
  geo_locations: { countries: ["US"] },
  targeting_automation: { detailed_targeting_expansion: 0 }
};

describe("the clean baseline", () => {
  test("a compliant payload passes", () => {
    const res = ok(CLEAN);
    assert.strictEqual(res.ok, true, `baseline should pass, got ${JSON.stringify(codes(res))}`);
  });
});

describe("geography", () => {
  test("rejects ZIP targeting", () => {
    const res = ok({ ...CLEAN, zips: ["90210"] });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("zip_targeting"));
  });

  test("rejects ZIPs nested under geo_locations", () => {
    // The same option by its real Meta path. A validator that only checked the
    // top-level key would miss every payload the API actually accepts.
    const res = ok({ ...CLEAN, geo_locations: { countries: ["US"], zips: [{ key: "US:90210" }] } });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("zip_targeting"));
  });

  test("accepts city/region targeting — the near miss", () => {
    const res = ok({ ...CLEAN, geo_locations: { cities: [{ key: "2418779" }], regions: [{ key: "3847" }] } });
    assert.strictEqual(res.ok, true, JSON.stringify(codes(res)));
  });

  test("rejects a radius under 15 miles", () => {
    const res = ok({ ...CLEAN, radius: 10, distance_unit: "mile" });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("radius_too_small"));
  });

  test("accepts exactly 15 miles — the boundary is inclusive", () => {
    const res = ok({ ...CLEAN, radius: 15, distance_unit: "mile" });
    assert.strictEqual(res.ok, true, JSON.stringify(codes(res)));
  });

  test("rejects 14.9 miles", () => {
    const res = ok({ ...CLEAN, radius: 14.9, distance_unit: "mile" });
    assert.strictEqual(res.ok, false);
  });

  test("rejects 20 KILOMETRES — 12.4 miles, which a raw numeric check would pass", () => {
    const res = ok({ ...CLEAN, radius: 20, distance_unit: "kilometer" });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("radius_too_small"));
  });

  test("accepts 25 kilometres — 15.5 miles, over the floor", () => {
    const res = ok({ ...CLEAN, radius: 25, distance_unit: "kilometer" });
    assert.strictEqual(res.ok, true, JSON.stringify(codes(res)));
  });

  test("rejects a small radius nested in custom_locations", () => {
    const res = ok({
      ...CLEAN,
      geo_locations: { custom_locations: [{ latitude: 1, longitude: 2, radius: 5, distance_unit: "mile" }] }
    });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("radius_too_small"));
  });

  test("rejects location exclusions", () => {
    const res = ok({ ...CLEAN, excluded_geo_locations: { regions: [{ key: "3847" }] } });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("location_exclusion"));
  });

  test("an empty exclusions array is not an exclusion", () => {
    const res = ok({ ...CLEAN, exclusions: [] });
    assert.strictEqual(res.ok, true, JSON.stringify(codes(res)));
  });
});

describe("age", () => {
  test("rejects age_min above 18", () => {
    const res = ok({ ...CLEAN, age_min: 25 });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("age_range"));
  });

  test("rejects age_max below 65", () => {
    const res = ok({ ...CLEAN, age_max: 45 });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("age_range"));
  });

  test("accepts 18 with an absent age_max — Meta's other spelling of 65+", () => {
    const t = { ...CLEAN };
    delete t.age_max;
    assert.strictEqual(ok(t).ok, true);
  });

  test("rejects a narrowed range even when it sits inside 18-65", () => {
    const res = ok({ ...CLEAN, age_min: 21, age_max: 60 });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(codes(res).filter((c) => c === "age_range").length, 2);
  });
});

describe("gender", () => {
  test("rejects a single-gender restriction", () => {
    const res = ok({ ...CLEAN, genders: [1] });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("gender_restriction"));
  });

  test("accepts both genders", () => {
    assert.strictEqual(ok({ ...CLEAN, genders: [1, 2] }).ok, true);
  });

  test("accepts an absent genders key — Meta's 'all'", () => {
    const t = { ...CLEAN };
    delete t.genders;
    assert.strictEqual(ok(t).ok, true);
  });
});

describe("audiences", () => {
  test("rejects lookalike audiences", () => {
    const res = ok({ ...CLEAN, lookalike_audiences: ["123"] });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("lookalike_audience"));
  });

  test("rejects a lookalike hiding in custom_audiences by subtype", () => {
    // The realistic evasion: lookalikes arrive as custom audiences with a subtype.
    const res = ok({ ...CLEAN, custom_audiences: [{ id: "1", subtype: "LOOKALIKE" }] });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("lookalike_audience"));
  });

  test("accepts an ordinary custom audience — the near miss", () => {
    const res = ok({ ...CLEAN, custom_audiences: [{ id: "1", subtype: "CUSTOM" }] });
    assert.strictEqual(res.ok, true, JSON.stringify(codes(res)));
  });
});

describe("detailed targeting expansion", () => {
  test("rejects expansion when on", () => {
    const res = ok({ ...CLEAN, targeting_automation: { detailed_targeting_expansion: 1 } });
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("detailed_targeting_expansion"));
  });

  test("rejects advantage_audience, the same switch by another name", () => {
    const res = ok({ ...CLEAN, targeting_automation: { advantage_audience: 1 } });
    assert.strictEqual(res.ok, false);
  });

  test("accepts expansion explicitly off", () => {
    assert.strictEqual(ok({ ...CLEAN, targeting_automation: { detailed_targeting_expansion: 0 } }).ok, true);
  });
});

describe("fails closed", () => {
  test("missing targeting is rejected, not treated as unrestricted", () => {
    const res = ok(undefined);
    assert.strictEqual(res.ok, false);
    assert.ok(codes(res).includes("targeting_missing"));
  });

  test("a non-object payload is rejected", () => {
    assert.strictEqual(ok("everyone").ok, false);
    assert.strictEqual(ok([]).ok, false);
  });

  test("unknown keys are ignored rather than rejected", () => {
    // Meta ships new surfaces regularly; failing on an unrecognised key would
    // break every campaign the week they do.
    assert.strictEqual(ok({ ...CLEAN, some_new_meta_key: "whatever" }).ok, true);
  });

  test("TikTok payloads are not judged by Meta's rules", () => {
    const res = screenTargeting({ age_min: 25, genders: [1] }, { platform: "tiktok" });
    assert.strictEqual(res.ok, true);
  });
});

describe("buildTargeting", () => {
  test("forces the mandated age, gender and expansion values", () => {
    const built = buildTargeting({ geo_locations: { countries: ["US"] } });
    assert.strictEqual(built.age_min, TARGETING_LIMITS.REQUIRED_AGE_MIN);
    assert.strictEqual(built.age_max, TARGETING_LIMITS.REQUIRED_AGE_MAX);
    assert.deepStrictEqual(built.genders, [1, 2]);
    assert.strictEqual(built.targeting_automation.detailed_targeting_expansion, 0);
  });

  test("overwrites a caller's non-compliant age and gender rather than failing", () => {
    // These have exactly one legal value each, so there is no partner intent to
    // preserve — forcing them is safe and avoids a pointless rejection.
    const built = buildTargeting({ age_min: 25, age_max: 40, genders: [2] });
    assert.strictEqual(built.age_min, 18);
    assert.deepStrictEqual(built.genders, [1, 2]);
  });

  test("throws rather than silently widening a too-small radius", () => {
    // A radius has many legal values, so correcting it would be us spending the
    // partner's money on targeting they did not choose.
    assert.throws(() => buildTargeting({ radius: 5, distance_unit: "mile" }), /targeting rejected/);
  });

  test("the thrown error carries every reason, not just the first", () => {
    try {
      buildTargeting({ zips: ["90210"], radius: 2, distance_unit: "mile", lookalike_audiences: ["1"] });
      assert.fail("should have thrown");
    } catch (e) {
      assert.strictEqual(e.code, "TARGETING_REJECTED");
      const c = e.reasons.map((r) => r.code);
      assert.ok(c.includes("zip_targeting"));
      assert.ok(c.includes("radius_too_small"));
      assert.ok(c.includes("lookalike_audience"));
    }
  });
});
