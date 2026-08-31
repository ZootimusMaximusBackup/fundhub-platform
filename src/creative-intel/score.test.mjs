// The Winner Score.
//
// Two properties are load-bearing and both are easy to break without noticing:
//
//   1. A MISSING SIGNAL DOES NOT PENALISE. The weights renormalise over the
//      signals present. If a null ever becomes a 0, every creative not on
//      TikTok drops down a ranking that still looks authoritative.
//
//   2. PERCENTILES ARE WITHIN ANGLE. Across the board, case-study ads — which
//      naturally run long — would own the top of the list forever and the
//      weekly product would say the same thing every week.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  rankWeek, scoreOne, percentileTable, topDecile, bandFor,
  WEIGHTS, WEIGHTS_VERSION, SCORED_SIGNALS
} from "./score.mjs";

const row = (hash, angle, signals) => ({ content_hash: hash, angle, signals });

describe("percentileTable", () => {
  test("spreads values across the unit interval", () => {
    const t = percentileTable([10, 20, 30]);
    assert.equal(t.get(10), 0);
    assert.equal(t.get(20), 0.5);
    assert.equal(t.get(30), 1);
  });

  test("ties share a percentile", () => {
    // Two creatives with identical evidence must score identically. A
    // first-come position would rank one above the other for no reason anyone
    // could explain.
    const t = percentileTable([5, 5, 9]);
    assert.equal(t.get(5), 0.25);
    assert.equal(t.get(9), 1);
  });

  test("a group of one sits in the middle, not at the top", () => {
    // A creative alone in its angle has no distribution to sit in. Giving it
    // 1.0 would put every lone creative in a rare angle at the head of the
    // board on the strength of having no competition.
    assert.equal(percentileTable([42]).get(42), 0.5);
  });

  test("nulls are excluded rather than counted as a value", () => {
    const t = percentileTable([null, 10, null, 20]);
    assert.equal(t.size, 2);
    assert.equal(t.get(10), 0);
  });
});

describe("scoreOne — renormalisation is the NULL-survival mechanism", () => {
  test("all signals present sums the full weight set", () => {
    const all = {};
    for (const k of SCORED_SIGNALS) all[k] = 1;
    assert.equal(scoreOne(all), 1);
  });

  test("a missing signal is skipped and the rest are renormalised", () => {
    // Present at 1.0 on two signals, absent on the other five. The answer is 1,
    // not 50/100 — the creative is top of everything we know about it.
    const partial = {};
    for (const k of SCORED_SIGNALS) partial[k] = null;
    partial.ad_age_days = 1;
    partial.variant_count = 1;
    assert.equal(scoreOne(partial), 1);
  });

  test("nothing scorable gives null, not zero", () => {
    const none = {};
    for (const k of SCORED_SIGNALS) none[k] = null;
    assert.equal(scoreOne(none), null);
  });

  test("weights are the spec's table and sum to 100", () => {
    assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
    assert.equal(WEIGHTS.ad_age_days, 30);
    assert.equal(WEIGHTS.tiktok_perf_bucket, 5);
  });

  test("the weights carry a version, so a refit cannot restate history", () => {
    assert.ok(Number.isInteger(WEIGHTS_VERSION));
  });
});

describe("rankWeek", () => {
  test("ranks within angle, so a long-running angle does not own the board", () => {
    // Two angles. The case-study ads are all older than the debt-rescue ads, but
    // each group is ranked against itself, so the top of each group scores 1.
    const rows = [
      row("cs1", "case_study_receipt", { ad_age_days: 400 }),
      row("cs2", "case_study_receipt", { ad_age_days: 300 }),
      row("dr1", "debt_rescue", { ad_age_days: 20 }),
      row("dr2", "debt_rescue", { ad_age_days: 5 })
    ];
    const ranked = rankWeek(rows);
    const byHash = new Map(ranked.map((r) => [r.content_hash, r]));
    assert.equal(byHash.get("cs1").winner_score, 1);
    assert.equal(byHash.get("dr1").winner_score, 1);
    // If normalisation were across the board, dr1's 20 days would score near 0
    // and no debt-rescue ad would ever appear on the board.
    assert.ok(byHash.get("dr1").winner_score > byHash.get("cs2").winner_score);
  });

  test("a TikTok bucket participates as an ordinal, not as a rate", () => {
    const rows = [
      row("a", "speed_of_money", { ad_age_days: 10, tiktok_perf_bucket: "high" }),
      row("b", "speed_of_money", { ad_age_days: 10, tiktok_perf_bucket: "low" })
    ];
    const ranked = rankWeek(rows);
    assert.equal(ranked[0].content_hash, "a");
  });

  test("a creative with no scorable signal is not ranked at all", () => {
    const rows = [
      row("a", "speed_of_money", { ad_age_days: 10 }),
      row("b", "speed_of_money", {})
    ];
    const ranked = rankWeek(rows);
    const b = ranked.find((r) => r.content_hash === "b");
    assert.equal(b.winner_score, null);
    assert.equal(b.winner_score_rank, null);
    assert.equal(b.winner_score_band, null);
  });

  test("unclassified creatives are grouped together rather than dropped", () => {
    const ranked = rankWeek([
      row("a", null, { ad_age_days: 90 }),
      row("b", null, { ad_age_days: 1 })
    ]);
    assert.equal(ranked.filter((r) => r.winner_score_rank !== null).length, 2);
    assert.equal(ranked[0].content_hash, "a");
  });

  test("ranks are 1-based, contiguous, and best first", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(`h${i}`, "speed_of_money", { ad_age_days: i }));
    const ranked = rankWeek(rows);
    assert.deepEqual(ranked.map((r) => r.winner_score_rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(ranked[0].content_hash, "h9");
  });
});

describe("bands and the top decile", () => {
  test("hot is the top fifth, warm the next third, cold the rest", () => {
    assert.equal(bandFor(0, 100), "hot");
    assert.equal(bandFor(19, 100), "hot");
    assert.equal(bandFor(20, 100), "warm");
    assert.equal(bandFor(49, 100), "warm");
    assert.equal(bandFor(50, 100), "cold");
  });

  test("no population means no band, rather than a default of cold", () => {
    assert.equal(bandFor(0, 0), null);
  });

  test("topDecile takes at least one row even in a tiny week", () => {
    // A ceiling of zero would mean the death watch could never fire on a small
    // board, and the death watch is the differentiator.
    const ranked = [{ content_hash: "a", winner_score_rank: 1 }];
    assert.deepEqual([...topDecile(ranked)], ["a"]);
  });

  test("topDecile ignores unranked rows", () => {
    const ranked = [
      { content_hash: "a", winner_score_rank: 1 },
      { content_hash: "b", winner_score_rank: null }
    ];
    assert.equal(topDecile(ranked).has("b"), false);
  });
});
