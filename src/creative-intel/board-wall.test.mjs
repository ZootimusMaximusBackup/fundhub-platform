// The wall: what a partner may see, and what never leaves the building.
//
// docs/specs/W2-creative-intelligence.md §9.3.
//
// Owner decision: FundHub's own winning-creative performance is NOT handed to
// partners wholesale. That performance is the asset the whole white-label
// programme is built on.
//
// This file tests the LAST lock — the projection. The first lock is in SQL
// (FundHub's own advertisers are filtered out before anything is selected) and
// is covered by the endpoint test, which needs a database. This one needs
// nothing, runs on every push, and catches the specific regression that would
// otherwise ship silently: somebody adds a column to the feed query and it
// travels straight into a JSON body because nothing said it could not.
//
// That is not hypothetical in this repo. db/migrations/046_ad_platforms.sql
// lines 54-57 record the same failure mode for encrypted tokens: "the moment one
// exists, some SELECT * will carry it into a JSON body."

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  toPartnerRow, PARTNER_COLUMNS, WITHHELD_COLUMNS, RANK_BASIS_NOTE, NO_SPEND_NOTE
} from "./board.mjs";
import { SELECT_LIST } from "./board.mjs";

const fullRow = {
  content_hash: "hash-a", iso_week: "2026-W35", platform: "meta",
  advertiser_id: "adv-a", headline: "Fast money", hook_line: "Need $50,000?",
  destination_domain: "a.test", media_kind: "video",
  angle: "speed_of_money", ad_format: "talking_head_ugc",
  promise_shape: "specific_timeframe", compliance_risk: "clean",
  funnel: "call_booking", screen_state: "passed",
  ad_age_days: 28, variant_count: 3, relaunch_count: 0, creative_velocity: 0.5,
  placement_spread: 5, landing_page_changed: false, offer_price_cents: 5_000_000,
  offer_term: "72 hours", new_entrant: false, death_watch: false,
  cross_platform_echo: 2, tiktok_perf_bucket: "high",
  winner_score_rank: 1, winner_score_band: "hot", rank_delta: 3,

  // Everything below is real and must never reach a partner.
  winner_score: 0.9137,
  weights_version: 1,
  cost_cents: 8,
  input_tokens: 4000,
  output_tokens: 2000,
  raw: { vendor_payload: "verbatim" },
  vendor: "apify-meta",
  vendor_run_id: "run-123",
  watch_group: "own"
};

describe("toPartnerRow — the projection", () => {
  const projected = toPartnerRow(fullRow);

  test("the raw Winner Score never leaves the building", () => {
    // A decimal on a screen is a decimal somebody can regress the weights out
    // of, and the weights are the moat.
    assert.equal("winner_score" in projected, false);
    assert.equal(projected.winner_score_rank, 1);
    assert.equal(projected.winner_score_band, "hot");
  });

  test("every withheld column is absent", () => {
    for (const key of WITHHELD_COLUMNS) {
      assert.equal(key in projected, false, `${key} reached a partner-facing row`);
    }
  });

  test("a column nobody allow-listed does not travel, even when the SQL selects it", () => {
    // This is the regression the file exists for: a new column added to the
    // query does NOT appear in the response until somebody adds it to
    // PARTNER_COLUMNS on purpose.
    const withNewColumn = toPartnerRow({ ...fullRow, fundhub_internal_cpa_cents: 4100 });
    assert.equal("fundhub_internal_cpa_cents" in withNewColumn, false);
  });

  test("the allow-list and the withheld list do not overlap", () => {
    for (const key of WITHHELD_COLUMNS) {
      assert.equal(PARTNER_COLUMNS.includes(key), false,
        `${key} is on both lists — one of them is wrong`);
    }
  });

  test("what a partner DOES get is the useful part", () => {
    assert.equal(projected.hook_line, "Need $50,000?");
    assert.equal(projected.ad_age_days, 28);
    assert.equal(projected.cross_platform_echo, 2);
    assert.equal(projected.rank_delta, 3);
  });

  test("nulls survive the projection instead of disappearing", () => {
    // A null variant count means "not classified yet". Dropping the key would
    // make the screen render it the same as zero.
    const p = toPartnerRow({ ...fullRow, variant_count: null, tiktok_perf_bucket: null });
    assert.equal(p.variant_count, null);
    assert.equal(p.tiktok_perf_bucket, null);
  });
});

describe("the do-not-copy badge", () => {
  test("a credit-outcome claim is flagged", () => {
    const p = toPartnerRow({ ...fullRow, compliance_risk: "names_a_credit_outcome" });
    assert.equal(p.do_not_copy, true);
  });

  test("an implied guaranteed approval is flagged", () => {
    const p = toPartnerRow({ ...fullRow, compliance_risk: "implies_guaranteed_approval" });
    assert.equal(p.do_not_copy, true);
  });

  test("a blocked screening verdict is flagged even when the axis reads clean", () => {
    // screen() fails closed, so a screening that could not complete marks the
    // ad do-not-copy rather than clean. That is the right direction to fail in.
    const p = toPartnerRow({ ...fullRow, compliance_risk: "clean", screen_state: "blocked" });
    assert.equal(p.do_not_copy, true);
  });

  test("'no credit check' is labelled but not banned outright", () => {
    // It is a risk badge, not a do-not-copy: the phrase is a platform-policy
    // problem rather than a claim about a credit outcome, and a partner needs
    // to be able to see that the market uses it.
    const p = toPartnerRow({ ...fullRow, compliance_risk: "uses_no_credit_check" });
    assert.equal(p.do_not_copy, false);
    assert.equal(p.compliance_risk, "uses_no_credit_check");
  });

  test("a clean, passed creative is not flagged", () => {
    assert.equal(toPartnerRow(fullRow).do_not_copy, false);
  });
});

describe("the SQL allow-list", () => {
  test("the shared SELECT list never names the raw score or the weights", () => {
    assert.equal(/winner_score\b(?!_)/.test(SELECT_LIST), false,
      "the shared SELECT list selects the raw winner_score");
    assert.equal(SELECT_LIST.includes("weights_version"), false);
    assert.equal(SELECT_LIST.includes("cost_cents"), false);
    assert.equal(SELECT_LIST.includes("s.raw"), false);
  });

  test("it is a written column list, never a star", () => {
    assert.equal(SELECT_LIST.includes("*"), false);
  });
});

describe("the stated limitation", () => {
  test("says the ranks come from how long ads run, not from outcomes", () => {
    // §10: not a disclaimer in 8pt grey — a stated limitation. There are zero
    // measured paid closes on record, and per CLAUDE.md §2 that absence is a
    // finding rather than a gap to paper over.
    assert.match(RANK_BASIS_NOTE, /how long ads run/);
    assert.match(RANK_BASIS_NOTE, /Outcome data is still being collected/);
  });

  test("says plainly that no competitor spend figure appears", () => {
    assert.match(NO_SPEND_NOTE, /No competitor spend/);
    assert.match(NO_SPEND_NOTE, /guess/);
  });

  test("neither note makes an earnings claim", () => {
    // NO EARNINGS CLAIMS ANYWHERE PUBLIC. Zero measured paid closes exist.
    const forbidden = /\b(earn|income|revenue|profit|make \$|per month you)\b/i;
    assert.equal(forbidden.test(RANK_BASIS_NOTE), false);
    assert.equal(forbidden.test(NO_SPEND_NOTE), false);
  });
});
