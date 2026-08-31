// The ten derived signals, against hand-built observation sequences.
//
// These are pure functions over arrays on purpose (see signals.mjs's header),
// which means every one of them can be tested against a sequence somebody wrote
// down rather than against whatever a database happened to contain. A wrong
// answer here is a wrong answer on a screen a customer pays for.
//
// THE ASSERTIONS THAT MATTER MOST ARE THE NULL ONES. CLAUDE.md §12 says NULL
// means unknown and must survive; the specific way this product breaks is a
// missing signal quietly becoming 0 and dragging a creative to the bottom of a
// ranking that then looks authoritative.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  adAgeDays, relaunchCount, placementSpread, landingPageChanged, extractOffer,
  isNewEntrant, deathWatch, crossPlatformEcho, variantCount, creativeVelocity,
  buildIndex, signalsFor, RELAUNCH_GAP_DAYS
} from "./signals.mjs";

const obs = (day, extra = {}) => ({
  content_hash: "h1", advertiser_id: "adv-a", platform: "meta",
  observed_on: day, first_seen_at: null, destination_url: "https://a.test/x",
  placements: ["feed"], ...extra
});

describe("1. ad age", () => {
  test("is the span between the first and the last sighting", () => {
    assert.equal(adAgeDays([obs("2026-08-02"), obs("2026-08-30")]), 28);
  });

  test("a single sighting is age 0 — a measurement, not an absence", () => {
    assert.equal(adAgeDays([obs("2026-08-30")]), 0);
  });

  test("no observations at all is NULL, not 0", () => {
    assert.equal(adAgeDays([]), null);
  });

  test("the vendor's earlier first_seen_at wins over our first sighting", () => {
    // The ad existed before the watch-list did. Ignoring that would reset every
    // ad's age to the day FundHub started watching.
    const age = adAgeDays([obs("2026-08-30", { first_seen_at: "2026-06-01T00:00:00Z" })]);
    assert.equal(age, 90);
  });
});

describe("3. re-launch", () => {
  test("a 14-day gap followed by a return counts once", () => {
    const days = ["2026-08-02", "2026-08-09", "2026-08-30"];
    assert.equal(relaunchCount(days.map((d) => obs(d))), 1);
  });

  test("a normal weekly cadence is not a re-launch", () => {
    const days = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23"];
    assert.equal(relaunchCount(days.map((d) => obs(d))), 0);
  });

  test("the gap threshold is the named constant, not a literal", () => {
    assert.equal(RELAUNCH_GAP_DAYS, 14);
  });

  test("two separate resurrections count twice", () => {
    const days = ["2026-05-03", "2026-06-01", "2026-07-05"];
    assert.equal(relaunchCount(days.map((d) => obs(d))), 2);
  });
});

describe("5. placement spread", () => {
  test("counts distinct placements across the whole life of the creative", () => {
    assert.equal(placementSpread([
      obs("2026-08-02", { placements: ["feed", "reels"] }),
      obs("2026-08-09", { placements: ["feed", "stories"] })
    ]), 3);
  });

  test("a vendor that reports no placements at all gives NULL, not 0", () => {
    // 0 would read as "this ad ran nowhere", which is impossible for a row that
    // exists. The honest answer is that the vendor did not say.
    assert.equal(placementSpread([obs("2026-08-02", { placements: [] })]), null);
  });
});

describe("6. landing-page change", () => {
  test("a changed destination is detected", () => {
    assert.equal(landingPageChanged([
      obs("2026-08-02", { destination_url: "https://a.test/v1" }),
      obs("2026-08-09", { destination_url: "https://a.test/v2" })
    ]), true);
  });

  test("one sighting cannot have changed, so it is NULL not false", () => {
    assert.equal(landingPageChanged([obs("2026-08-02")]), null);
  });

  test("a stable destination across weeks is false", () => {
    assert.equal(landingPageChanged([obs("2026-08-02"), obs("2026-08-09")]), false);
  });
});

describe("7. offer / price extraction", () => {
  test("pulls a dollar figure as integer cents", () => {
    assert.equal(extractOffer("Get $50,000 for your business").priceCents, 5_000_000);
  });

  test("understands k and M suffixes", () => {
    assert.equal(extractOffer("$10k to $2M, one application").priceCents, 200_000_000);
  });

  test("takes the LARGEST figure, not the first", () => {
    // "$10k to $2M" is the standard shape of funding copy. Taking the first
    // match records every one of those ads as a $10,000 offer.
    assert.equal(extractOffer("$10k to $250k available").priceCents, 25_000_000);
  });

  test("no figure at all is NULL, never 0", () => {
    assert.equal(extractOffer("Book a call with our team").priceCents, null);
  });

  test("picks up a term and guarantee language", () => {
    const o = extractOffer("Funded in 72 hours, guaranteed or your money back.");
    assert.equal(o.term, "72 hours");
    assert.equal(o.guaranteeLanguage, true);
  });

  test("cents are exact for a decimal amount", () => {
    assert.equal(extractOffer("only $47.00 a month").priceCents, 4700);
  });
});

describe("9. death watch", () => {
  const prior = new Set(["h1"]);

  test("a former top-decile creative unseen for 14+ days is flagged", () => {
    assert.equal(
      deathWatch("h1", [obs("2026-08-02")], { asOf: "2026-08-30", priorTopDecile: prior }),
      true
    );
  });

  test("a former leader still running is not flagged", () => {
    assert.equal(
      deathWatch("h1", [obs("2026-08-28")], { asOf: "2026-08-30", priorTopDecile: prior }),
      false
    );
  });

  test("a creative that was never a leader is FALSE, not null", () => {
    // We know it was never in the top decile, so we know it is not a death-watch
    // case. That is a measurement, not an absence.
    assert.equal(
      deathWatch("h9", [obs("2026-01-01")], { asOf: "2026-08-30", priorTopDecile: prior }),
      false
    );
  });

  test("no prior week at all means nothing is reported dead", () => {
    assert.equal(
      deathWatch("h1", [obs("2026-01-01")], { asOf: "2026-08-30", priorTopDecile: new Set() }),
      false
    );
  });
});

describe("2, 4, 8, 10 — the cross-creative signals, through buildIndex", () => {
  const creatives = [
    { content_hash: "h1", advertiser_id: "adv-a", platform: "meta", destination_domain: "a.test", body_text: "one" },
    { content_hash: "h2", advertiser_id: "adv-a", platform: "meta", destination_domain: "a.test", body_text: "two" },
    { content_hash: "h3", advertiser_id: "adv-b", platform: "tiktok", destination_domain: "a.test", body_text: "three" },
    { content_hash: "h4", advertiser_id: "adv-c", platform: "meta", destination_domain: "c.test", body_text: "four" }
  ];
  const records = [
    obs("2026-08-02", { content_hash: "h1" }),
    obs("2026-08-30", { content_hash: "h1" }),
    obs("2026-08-23", { content_hash: "h2" }),
    obs("2026-08-30", { content_hash: "h3", advertiser_id: "adv-b", platform: "tiktok" }),
    obs("2026-08-30", { content_hash: "h4", advertiser_id: "adv-c" })
  ];
  const cls = new Map([
    ["h1", { angle: "speed_of_money", promise_shape: "specific_timeframe" }],
    ["h2", { angle: "speed_of_money", promise_shape: "specific_timeframe" }],
    ["h3", { angle: "speed_of_money", promise_shape: "specific_timeframe" }],
    ["h4", { angle: "debt_rescue", promise_shape: "curiosity_no_promise" }]
  ]);
  const index = buildIndex(records, creatives, cls);

  test("2. variant count groups by advertiser + angle + domain", () => {
    assert.equal(variantCount("h1", index), 2);
    assert.equal(variantCount("h4", index), 1);
  });

  test("2. an unclassified creative gets NULL variants, not 1", () => {
    const bare = buildIndex(records, creatives, new Map());
    assert.equal(variantCount("h1", bare), null);
  });

  test("10. cross-platform echo counts platforms for the same angle + promise + domain", () => {
    // h1 (meta) and h3 (tiktok) share the angle, the promise and the domain, so
    // the hook is carrying across platforms — a fact about the market rather
    // than about one algorithm.
    assert.equal(crossPlatformEcho("h1", index, "2026-08-30"), 2);
  });

  test("10. a hook on one platform reports 1 — a measurement, not an absence", () => {
    assert.equal(crossPlatformEcho("h4", index, "2026-08-30"), 1);
  });

  test("10. an unclassified creative gets NULL echo", () => {
    const bare = buildIndex(records, creatives, new Map());
    assert.equal(crossPlatformEcho("h1", bare, "2026-08-30"), null);
  });

  test("8. new entrant is true only when the advertiser's first sighting is in the week", () => {
    assert.equal(isNewEntrant("adv-c", index, "2026-08-24"), true);
    assert.equal(isNewEntrant("adv-a", index, "2026-08-24"), false);
  });

  test("8. an advertiser we have never seen is NULL, not false", () => {
    assert.equal(isNewEntrant("adv-unknown", index, "2026-08-24"), null);
  });

  test("4. creative velocity is new creatives per week over the rolling window", () => {
    // adv-a launched h1 on 08-02 and h2 on 08-23. A four-week window ending
    // 08-30 opens on 08-02 EXCLUSIVE, so the window is exactly 28 days and h1
    // sits on the boundary, outside it. One new creative over four weeks.
    assert.equal(creativeVelocity("adv-a", index, "2026-08-30"), 0.25);
    // The window is a fixed 28 days that MOVES with asOf, so asking a day
    // earlier brings h1 back inside it and both launches count.
    assert.equal(creativeVelocity("adv-a", index, "2026-08-29"), 0.5);
  });

  test("4. an unknown advertiser has NULL velocity", () => {
    assert.equal(creativeVelocity("adv-nobody", index, "2026-08-30"), null);
  });

  test("signalsFor returns all ten keys, and unknowns are null", () => {
    const s = signalsFor("h1", index, {
      asOf: "2026-08-30", weekStart: "2026-08-24", priorTopDecile: new Set()
    });
    for (const key of [
      "ad_age_days", "variant_count", "relaunch_count", "creative_velocity",
      "placement_spread", "landing_page_changed", "offer_price_cents",
      "new_entrant", "death_watch", "cross_platform_echo"
    ]) {
      assert.ok(key in s, `signalsFor is missing ${key}`);
    }
    // No TikTok bucket was supplied, so it stays null rather than becoming "low".
    assert.equal(s.tiktok_perf_bucket, null);
  });
});
