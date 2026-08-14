// B19 — smash unknown→0 in the vendored underwriter.
// NULL means unknown and must survive. 0 negatives is a fundable condition.
// Tests the implementation file, not the engine.mjs try/catch wrap.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import underwriter from "./vendor/underwriter.cjs";

const { computeUnderwrite, normalizeBureau } = underwriter;

function scored(extra = {}) {
  return {
    experian: {
      score: 720,
      utilization_pct: 20,
      inquiries: 0,
      negatives: 0,
      late_payment_events: 0,
      tradelines: [],
      ...extra
    }
  };
}

describe("unknown negatives never become 0 (fundable trap)", () => {
  test("score + measured zeros is still fundable", () => {
    const uw = computeUnderwrite(scored(), null);
    assert.equal(uw.fundable, true);
    assert.equal(uw.metrics.negative_accounts, 0);
    assert.equal(uw.metrics.utilization_pct, 20);
  });

  for (const [label, negatives] of [
    ["null", null],
    ["undefined", undefined],
    ["omitted", "OMIT"],
    ["empty string", ""],
    ["whitespace", "   "],
    ["tab/newline", "\t\n"],
    ["string null", "null"],
    ["string NULL", "NULL"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["boolean false", false],
    ["boolean true", true],
    ["array", []],
    ["object", {}],
    ["negative number", -1]
  ]) {
    test(`negatives=${label} stays unknown and is not fundable`, () => {
      const extra = negatives === "OMIT" ? {} : { negatives };
      if (negatives === "OMIT") delete extra.negatives;
      const uw = computeUnderwrite(
        {
          experian: {
            score: 720,
            utilization_pct: 20,
            inquiries: 0,
            late_payment_events: 0,
            tradelines: [],
            ...extra
          }
        },
        null
      );
      assert.equal(uw.metrics.negative_accounts, null, `${label}: negatives must stay null, got ${uw.metrics.negative_accounts}`);
      assert.equal(uw.fundable, false, `${label}: unknown negatives must not read as a clean file`);
    });
  }

  test("string '0' is a measured zero and can be fundable", () => {
    const uw = computeUnderwrite(scored({ negatives: "0" }), null);
    assert.equal(uw.metrics.negative_accounts, 0);
    assert.equal(uw.fundable, true);
  });

  test("real negative count stays a number and is not fundable", () => {
    const uw = computeUnderwrite(scored({ negatives: 3 }), null);
    assert.equal(uw.metrics.negative_accounts, 3);
    assert.equal(uw.fundable, false);
  });
});

describe("unknown utilization never becomes 0 (paid-down trap)", () => {
  for (const [label, utilization_pct] of [
    ["null", null],
    ["omitted", "OMIT"],
    ["empty string", ""],
    ["whitespace", "   "],
    ["string null", "null"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["boolean false", false],
    ["negative number", -5]
  ]) {
    test(`utilization=${label} stays null, never 0`, () => {
      const bag = scored({ negatives: 0 });
      if (utilization_pct === "OMIT") delete bag.experian.utilization_pct;
      else bag.experian.utilization_pct = utilization_pct;
      const uw = computeUnderwrite(bag, null);
      assert.equal(
        uw.metrics.utilization_pct,
        null,
        `${label}: utilization must stay null, got ${uw.metrics.utilization_pct}`
      );
    });
  }

  test("measured 0% utilization is 0, not null", () => {
    const uw = computeUnderwrite(scored({ utilization_pct: 0 }), null);
    assert.equal(uw.metrics.utilization_pct, 0);
    assert.equal(uw.fundable, true);
  });

  test("string '0' utilization is a measured zero", () => {
    const uw = computeUnderwrite(scored({ utilization_pct: "0" }), null);
    assert.equal(uw.metrics.utilization_pct, 0);
  });
});

describe("unknown inquiries and late payments stay null", () => {
  test("available bureau with null inquiries does not fill the slot with 0", () => {
    const uw = computeUnderwrite(scored({ inquiries: null }), null);
    assert.equal(uw.metrics.inquiries.ex, null);
    assert.equal(uw.metrics.inquiries.eq, 0, "unpulled bureau slot stays 0 so a real pull is not swallowed");
    assert.equal(uw.metrics.inquiries.tu, 0);
    assert.equal(uw.metrics.inquiries.total, null, "unknown on a pulled bureau makes the total unknown");
    assert.equal(uw.optimization.needs_inquiry_cleanup, false);
  });

  test("whitespace inquiries stay unknown", () => {
    const uw = computeUnderwrite(scored({ inquiries: "  " }), null);
    assert.equal(uw.metrics.inquiries.ex, null);
    assert.equal(uw.metrics.inquiries.total, null);
  });

  test("pulled bureau counts still sum when the other two were not pulled", () => {
    const uw = computeUnderwrite(
      { experian: { score: 720, inquiries: 14, negatives: 0, utilization_pct: 20 } },
      null
    );
    assert.deepEqual(uw.metrics.inquiries, { ex: 14, eq: 0, tu: 0, total: 14 });
  });

  test("null late payments stay null and do not unlock loan stacking", () => {
    const uw = computeUnderwrite(
      {
        experian: {
          score: 750,
          negatives: 0,
          late_payment_events: null,
          tradelines: [
            { type: "installment", status: "open", limit: 15000, opened: "1990-01" }
          ]
        }
      },
      null
    );
    assert.equal(uw.metrics.late_payment_events, null);
    assert.equal(uw.personal.can_loan_stack, false, "unknown lates must not count as zero lates");
  });

  test("measured zero lates still allow loan stacking", () => {
    const uw = computeUnderwrite(
      {
        experian: {
          score: 750,
          negatives: 0,
          late_payment_events: 0,
          tradelines: [
            { type: "installment", status: "open", limit: 15000, opened: "1990-01" }
          ]
        }
      },
      null
    );
    assert.equal(uw.metrics.late_payment_events, 0);
    assert.equal(uw.personal.can_loan_stack, true);
  });
});

describe("score-only client (honesty fixture)", () => {
  test("a 700 score with every other field unknown is not fundable", () => {
    const uw = computeUnderwrite(
      {
        experian: {
          score: 700,
          utilization_pct: null,
          inquiries: null,
          negatives: null,
          late_payment_events: null,
          tradelines: []
        }
      },
      null
    );
    assert.equal(uw.fundable, false);
    assert.equal(uw.metrics.negative_accounts, null);
    assert.equal(uw.metrics.utilization_pct, null);
    assert.equal(uw.metrics.late_payment_events, null);
    assert.equal(uw.metrics.inquiries.ex, null);
    assert.equal(uw.metrics.inquiries.total, null);
  });
});

describe("normalizeBureau still passes holes through as null", () => {
  test("missing bureau is unavailable with null measures", () => {
    const b = normalizeBureau(null);
    assert.equal(b.available, false);
    assert.equal(b.negatives, null);
    assert.equal(b.utilization_pct, null);
    assert.equal(b.inquiries, null);
  });
});
