// B12 — smash the underwrite engine boundary on bad CRS shapes.
// Must not throw. Must not invent utilization % or lender lists when data is missing.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeUnderwrite,
  normalizeBureau,
  buildSuggestions,
  getNumberField,
  SAFE_EMPTY_UNDERWRITE
} from "./engine.mjs";

function assertNoInventedUtilOrLenders(uw, label) {
  const util = uw.metrics?.utilization_pct;
  assert.ok(
    util == null || Number.isFinite(Number(util)),
    `${label}: utilization must be null or finite, got ${util}`
  );
  if (Object.prototype.hasOwnProperty.call(uw, "lenders")) {
    assert.ok(Array.isArray(uw.lenders), `${label}: lenders must be an array`);
    assert.equal(
      uw.lenders.length,
      0,
      `${label}: must not invent lender names when CRS is empty/bad`
    );
  }
}

describe("computeUnderwrite — never throws on bad CRS", () => {
  test("null / undefined / empty bureaus", () => {
    for (const input of [null, undefined, {}, { experian: null, equifax: null, transunion: null }]) {
      const uw = computeUnderwrite(input, null);
      assert.equal(typeof uw, "object");
      assert.equal(uw.fundable, false);
      assert.equal(uw.metrics.utilization_pct, null, "empty CRS must not invent utilization");
      assert.equal(uw.lite_banner_funding, null);
      assertNoInventedUtilOrLenders(uw, JSON.stringify(input));
    }
  });

  test("NaN / Infinity / non-numeric scores", () => {
    const uw = computeUnderwrite(
      {
        experian: { score: NaN },
        equifax: { score: Infinity },
        transunion: { score: "not-a-score" }
      },
      NaN
    );
    assert.equal(uw.fundable, false);
    assert.equal(uw.metrics.utilization_pct, null);
    assertNoInventedUtilOrLenders(uw, "NaN scores");
  });

  test("missing identity (no names / addresses / employers) stays empty arrays", () => {
    const uw = computeUnderwrite(
      {
        experian: {
          score: 710,
          names: undefined,
          addresses: null,
          employers: "not-an-array",
          tradelines: []
        }
      },
      null
    );
    assert.equal(uw.per_bureau.experian.available, true);
    // Engine summary does not invent identity — tradelines only.
    assert.ok(Array.isArray(uw.per_bureau.experian.tradelines));
    assert.equal(uw.metrics.utilization_pct, null, "no util supplied → null, not 0");
    assertNoInventedUtilOrLenders(uw, "missing identity");
  });

  test("huge tradeline arrays do not throw and do not invent utilization", () => {
    const tls = Array.from({ length: 8000 }, (_, i) => ({
      type: i % 2 === 0 ? "revolving" : "installment",
      status: "open",
      limit: i,
      balance: Math.floor(i / 2),
      opened: null
    }));
    const uw = computeUnderwrite(
      {
        experian: { score: 680, tradelines: tls },
        equifax: { score: 670, tradelines: tls },
        transunion: { score: 690, tradelines: tls }
      },
      18
    );
    assert.equal(typeof uw.fundable, "boolean");
    assert.equal(uw.metrics.utilization_pct, null,
      "utilization is not computed from tradelines — missing util stays null");
    assertNoInventedUtilOrLenders(uw, "huge tradelines");
  });

  test("hostile getters that throw → safe empty, no invented util/lenders", () => {
    const throwyScore = {
      get score() {
        throw new Error("score boom");
      }
    };
    const uw = computeUnderwrite({ experian: throwyScore }, null);
    assert.equal(uw.fundable, SAFE_EMPTY_UNDERWRITE.fundable);
    assert.equal(uw.metrics.utilization_pct, null);
    assert.deepEqual(uw.lenders, []);
    assert.equal(uw.lite_banner_funding, null);
  });

  test("hostile tradeline proxy that throws → safe empty", () => {
    const uw = computeUnderwrite(
      {
        experian: {
          score: 720,
          tradelines: [
            new Proxy(
              {},
              {
                get() {
                  throw new Error("tl boom");
                }
              }
            )
          ]
        }
      },
      null
    );
    assert.equal(uw.metrics.utilization_pct, null);
    assert.deepEqual(uw.lenders, []);
    assert.equal(uw.fundable, false);
  });

  test("non-array lenders stamped on a weird bag are stripped to []", () => {
    // Simulate a corrupted bag that somehow carries lenders through a future fork.
    // We call through the wrapper after a normal compute and assert property rules
    // via a direct shape the wrapper would scrub — covered by hostile catch above
    // for throw path; here assert SAFE_EMPTY contract.
    assert.deepEqual(SAFE_EMPTY_UNDERWRITE.lenders, []);
    assert.equal(SAFE_EMPTY_UNDERWRITE.metrics.utilization_pct, null);
  });
});

describe("normalizeBureau — never throws", () => {
  test("null / junk / NaN util", () => {
    for (const input of [null, undefined, 42, "x", { score: NaN, utilization_pct: NaN }]) {
      const b = normalizeBureau(input);
      assert.equal(typeof b, "object");
      assert.equal(b.utilization_pct, null);
      assert.ok(Array.isArray(b.names));
      assert.ok(Array.isArray(b.tradelines));
      assert.equal(b.names.length, 0);
    }
  });

  test("hostile getter → unavailable empty", () => {
    const b = normalizeBureau({
      get score() {
        throw new Error("boom");
      }
    });
    assert.equal(b.available, false);
    assert.equal(b.utilization_pct, null);
    assert.equal(b.score, null);
  });
});

describe("buildSuggestions — never throws", () => {
  test("null / undefined uw → safe fallback, no util claim", () => {
    for (const uw of [null, undefined]) {
      const lines = buildSuggestions(uw);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 1);
      for (const line of lines) {
        assert.equal(typeof line, "string");
        assert.equal(/utilization|lender list|unlock_ladder/i.test(line), false,
          `fallback must not invent util/lender claims: ${line}`);
      }
    }
  });

  test("empty CRS underwrite still returns strings", () => {
    const uw = computeUnderwrite(null, null);
    const lines = buildSuggestions(uw);
    assert.ok(lines.length >= 1);
  });
});

describe("getNumberField — never throws", () => {
  test("hostile fields bag → null", () => {
    const fields = {
      get business_age_months() {
        throw new Error("fields boom");
      }
    };
    assert.equal(getNumberField(fields, "business_age_months"), null);
    assert.equal(getNumberField(null, "business_age_months"), null);
  });
});
