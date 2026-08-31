// The taxonomy, the content hash, and the vendor adapter contract.
//
// Three small modules with one thing in common: everything downstream assumes
// they behave, and none of the assumptions are checked anywhere else.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  TAXONOMY_VERSION, AXES, AXIS_KEYS, ANGLES, COMPLIANCE_RISKS, DO_NOT_COPY_RISKS,
  validateClassification, taxonomyPromptBlock
} from "./taxonomy.mjs";
import { contentHash, normaliseText, stripTracking, destinationDomain } from "./hash.mjs";
import {
  resolve, assertAdapter, VENDOR_CATALOG, VENDOR_KEYS, estimateMonthlyCostCents, MODULES
} from "./vendors/index.mjs";
import { toObservation } from "./vendors/observation.mjs";

describe("taxonomy", () => {
  test("the version is an integer somebody chose", () => {
    assert.ok(Number.isInteger(TAXONOMY_VERSION) && TAXONOMY_VERSION >= 1);
  });

  test("five axes, every one a closed list with no duplicates", () => {
    assert.equal(AXIS_KEYS.length, 5);
    for (const key of AXIS_KEYS) {
      const list = AXES[key];
      assert.ok(list.length > 0, `${key} is empty`);
      assert.equal(new Set(list).size, list.length, `${key} has a duplicate`);
      assert.ok(Object.isFrozen(list), `${key} is not frozen — a caller could push a value into the taxonomy`);
    }
  });

  test("the do-not-copy risks are real members of the compliance axis", () => {
    // A typo here would silently stop the badge from ever appearing, and the
    // badge is what keeps a partner from copying a banned claim.
    for (const risk of DO_NOT_COPY_RISKS) {
      assert.ok(COMPLIANCE_RISKS.includes(risk), `${risk} is not a compliance_risk value`);
    }
  });

  test("a well-formed classification validates", () => {
    const ok = validateClassification({
      angle: "speed_of_money", ad_format: "talking_head_ugc",
      promise_shape: "specific_timeframe", compliance_risk: "clean",
      funnel: "call_booking", hook_line: "Need $50,000?"
    });
    assert.deepEqual(ok, { ok: true, errors: [] });
  });

  test("an off-taxonomy value is REJECTED, never coerced to a default", () => {
    // A silently defaulted angle puts a creative in the wrong cell of the
    // saturation map and nothing anywhere reports it.
    const bad = validateClassification({
      angle: "money_fast_lol", ad_format: "talking_head_ugc",
      promise_shape: "specific_timeframe", compliance_risk: "clean", funnel: "call_booking"
    });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /angle/);
  });

  test("a missing axis is an error, not an empty string", () => {
    const bad = validateClassification({ angle: "speed_of_money" });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 4);
  });

  test("the prompt block is generated from the lists, not written out twice", () => {
    const block = taxonomyPromptBlock();
    for (const angle of ANGLES) assert.ok(block.includes(angle), `${angle} missing from the prompt`);
  });
});

describe("content hash", () => {
  test("whitespace and case differences do not make a new creative", () => {
    const a = contentHash({ bodyText: "Get  Funded FAST", headline: "Now", mediaUrl: "https://c.test/1.jpg" });
    const b = contentHash({ bodyText: "get funded fast", headline: "now", mediaUrl: "https://c.test/1.jpg" });
    assert.equal(a, b);
  });

  test("a different dollar figure IS a different creative", () => {
    const a = contentHash({ bodyText: "up to $50,000", headline: "", mediaUrl: "" });
    const b = contentHash({ bodyText: "up to $250,000", headline: "", mediaUrl: "" });
    assert.notEqual(a, b);
  });

  test("the field separator stops adjacent fields from colliding", () => {
    // Without it, ("ab","c") and ("a","bc") hash the same and two unrelated
    // creatives merge into one.
    assert.notEqual(
      contentHash({ bodyText: "ab", headline: "c", mediaUrl: "" }),
      contentHash({ bodyText: "a", headline: "bc", mediaUrl: "" })
    );
  });

  test("zero-width characters are stripped", () => {
    assert.equal(normaliseText("a\u200bb"), "ab");
    assert.equal(normaliseText("a\u00a0b"), "a b");
  });

  test("null and undefined normalise to empty rather than the string 'null'", () => {
    assert.equal(normaliseText(null), "");
    assert.equal(normaliseText(undefined), "");
  });
});

describe("URL normalisation", () => {
  test("tracking parameters are stripped so a fresh click id is not a change", () => {
    assert.equal(
      stripTracking("https://a.test/apply?fbclid=xyz&utm_source=fb&plan=pro"),
      "https://a.test/apply?plan=pro"
    );
  });

  test("parameter order does not matter", () => {
    assert.equal(
      stripTracking("https://a.test/x?b=2&a=1"),
      stripTracking("https://a.test/x?a=1&b=2")
    );
  });

  test("something that is not a URL becomes null, not garbage", () => {
    assert.equal(stripTracking("not-a-url"), null);
    assert.equal(destinationDomain("not-a-url"), null);
  });

  test("www is not a different advertiser", () => {
    assert.equal(destinationDomain("https://www.a.test/x"), "a.test");
  });
});

describe("vendor adapter contract", () => {
  test("every registered module satisfies the interface", () => {
    for (const [name, mod] of Object.entries(MODULES)) assertAdapter(mod, name);
  });

  test("resolving an unknown vendor throws rather than defaulting", () => {
    // A default would spend money at a supplier nobody chose.
    assert.throws(() => resolve({ vendorKey: "adspy" }), /no vendor adapter/);
  });

  test("the fixture adapter is the only implemented one — no vendor key exists", () => {
    const implemented = VENDOR_CATALOG.filter((v) => v.implemented).map((v) => v.key);
    assert.deepEqual(implemented, ["fixture"]);
    assert.ok(VENDOR_KEYS.includes("fixture"));
  });

  test("no catalog entry carries a spend figure — nobody publishes competitor spend", () => {
    for (const v of VENDOR_CATALOG) {
      assert.ok(!("spend" in v), `${v.key} claims to supply spend, which no vendor can`);
    }
  });

  test("the monthly cost model reproduces the spec's arithmetic in integer cents", () => {
    // 31,000 Meta records at $1.50/1K = $46.50; 8,000 Google at $0.45/1K = $3.60.
    const cents = estimateMonthlyCostCents({
      "apify-meta": 31000, "apify-google-transparency": 8000, "tiktok-creative-center": 40000
    });
    assert.equal(cents, 4650 + 360 + 0);
  });

  test("an unknown vendor rate makes the TOTAL unknown, not smaller", () => {
    const cents = estimateMonthlyCostCents({ "apify-meta": 1000, "adlibrary-rest": 1000 });
    assert.equal(cents, null);
  });
});

describe("observation normalisation", () => {
  const base = {
    platform: "meta", external_ad_id: "a1", advertiser_id: "adv-1",
    observed_on: "2026-08-30", body_text: "hi", headline: "h",
    destination_url: "https://a.test/x?fbclid=1", placements: ["feed", "feed", "reels"]
  };

  test("a good row maps to the normalised shape", () => {
    const o = toObservation(base);
    assert.equal(o.destinationUrl, "https://a.test/x");
    assert.equal(o.destinationDomain, "a.test");
    assert.deepEqual(o.placements, ["feed", "reels"]);
    assert.match(o.contentHash, /^[0-9a-f]{64}$/);
  });

  test("an unknown platform is refused rather than stored", () => {
    assert.throws(() => toObservation({ ...base, platform: "snapchat" }), /platform/);
  });

  test("a row with no ad id is refused — nothing downstream can key on it", () => {
    assert.throws(() => toObservation({ ...base, external_ad_id: "" }), /externalAdId/);
  });

  test("a missing headline stays null, not an empty string", () => {
    // "no headline" and "an empty headline" are different facts.
    assert.equal(toObservation({ ...base, headline: null }).headline, null);
  });

  test("an unrecognised media kind becomes null rather than a guess", () => {
    assert.equal(toObservation({ ...base, media_kind: "gif" }).mediaKind, null);
  });

  test("the TikTok bucket stays ordinal and rejects anything else", () => {
    assert.equal(toObservation({ ...base, tiktok_perf_bucket: "high" }).tiktokPerfBucket, "high");
    assert.equal(toObservation({ ...base, tiktok_perf_bucket: "0.42" }).tiktokPerfBucket, null);
  });
});
