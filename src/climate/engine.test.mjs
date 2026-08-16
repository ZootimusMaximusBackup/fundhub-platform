import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFromScore, normalize, weightedComposite } from "./config.mjs";
import { computeBusinessConditions, computeNational, computeStateScore } from "./scoring.mjs";
import { geocode } from "./connectors.mjs";

test("climate: sage band at 80+", () => {
  assert.equal(bandFromScore(86).color_band, "very_favorable");
  assert.equal(bandFromScore(86).color, "#A8D8B0");
  assert.equal(bandFromScore(40).color_band, "tight");
});

test("climate: invert mapping — lower unemployment scores higher", () => {
  const easy = normalize(3, 2, 12, true);
  const hard = normalize(10, 2, 12, true);
  assert.ok(easy > hard);
});

test("climate: national weights sum to a 0-100 score", () => {
  const national = computeNational({
    series: {
      EFFR: { observations: [{ value: 4.3 }] },
      CPIAUCSL: { observations: [{ value: 2.8 }] },
      BAMLC0A4CBBBEY: { observations: [{ value: 5.4 }] },
      DGS10: { observations: [{ value: 4.2 }] },
      UMCSENT: { observations: [{ value: 70 }] },
      NFIBBUSI: { observations: [{ value: 95 }] }
    },
    updated_at: "2026-08-16T00:00:00Z",
    stale: false
  });
  assert.ok(national.score >= 0 && national.score <= 100);
  assert.ok(national.components.fed_policy > 0);
});

test("climate: state score includes business conditions and bank rollup", () => {
  const scored = computeStateScore(
    { state_code: "AZ", unemployment_rate_pct: 3.5, delinquency_rate_pct: 1.1 },
    [{
      state: "AZ",
      issuance: { direction: 1 },
      internal_outcomes: { approval_rate: 0.72 },
      fundamentals: { deposits_cds: 80 }
    }],
    95,
    []
  );
  assert.equal(scored.state, "AZ");
  assert.ok(scored.business_conditions > 50);
  assert.ok(scored.avg_approval_odds > 0.5);
});

test("climate: weightedComposite ignores missing keys", () => {
  assert.equal(weightedComposite({ a: 100 }, { a: 1, b: 1 }, 0), 50);
});

test("climate: geocode falls back to state centroid without a maps key", async () => {
  const hit = await geocode("AZ");
  assert.equal(hit.stateCode, "AZ");
  assert.ok(Number.isFinite(hit.lat));
});

test("climate: business conditions invert unemployment", () => {
  const open = computeBusinessConditions({ nfibIndex: 100, unemployment_rate_pct: 3, delinquency_rate_pct: 0.8 });
  const tight = computeBusinessConditions({ nfibIndex: 85, unemployment_rate_pct: 9, delinquency_rate_pct: 5 });
  assert.ok(open > tight);
});
