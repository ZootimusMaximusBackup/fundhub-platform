import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { buildDocuments } = require("./vendor/build-documents.cjs");

function makeNormalized(bureaus = ["transunion", "experian", "equifax"]) {
  return {
    meta: { availableBureaus: bureaus },
    inquiries: [
      { source: "transunion", creditorName: "TEST", date: "2026-01-01" },
      { source: "experian", creditorName: "TEST", date: "2026-01-01" }
    ]
  };
}

const FUNDING_DOC_TYPES = new Set([
  "funding_summary",
  "funding_snapshot",
  "credit_analysis_report",
  "lender_match_list",
  "optimization_roadmap",
  "summary_funding_snapshot"
]);

// ---------------------------------------------------------------------------
// Outcome → package matrix
// ---------------------------------------------------------------------------

test("matrix: MANUAL_REVIEW → hold, no funding letters", () => {
  const result = buildDocuments("MANUAL_REVIEW", [], makeNormalized(), {});
  assert.equal(result.package, "hold");
  assert.equal(result.letters.length, 0);
  assert.ok(!result.letters.some((l) => String(l.fieldKey || "").startsWith("funding_")));
});

test("matrix: FRAUD_HOLD → hold, no funding letters", () => {
  const result = buildDocuments("FRAUD_HOLD", [], makeNormalized(), {});
  assert.equal(result.package, "hold");
  assert.equal(result.letters.length, 0);
});

test("matrix: REPAIR_ONLY → repair, not funding analysis primary pack", () => {
  const result = buildDocuments("REPAIR_ONLY", [], makeNormalized(), {});
  assert.equal(result.package, "repair");
  assert.ok(result.summaryDocuments.some((d) => d.type === "repair_plan_summary"));
  assert.ok(
    !result.summaryDocuments.some((d) => FUNDING_DOC_TYPES.has(d.type)),
    "repair must not list funding analysis docs as the primary pack"
  );
  assert.ok(!result.letters.some((l) => l.type === "inquiry_removal"));
  assert.ok(
    !result.letters.some((l) => String(l.fieldKey || "").startsWith("funding_letter_url"))
  );
});

test("matrix: FULL_FUNDING → funding", () => {
  const result = buildDocuments("FULL_FUNDING", [], makeNormalized(), {});
  assert.equal(result.package, "funding");
  assert.ok(result.summaryDocuments.some((d) => d.type === "funding_summary"));
});

test("matrix: PREMIUM_STACK → funding", () => {
  assert.equal(buildDocuments("PREMIUM_STACK", [], makeNormalized(), {}).package, "funding");
});

test("matrix: FUNDING_PLUS_REPAIR → funding", () => {
  assert.equal(
    buildDocuments("FUNDING_PLUS_REPAIR", [], makeNormalized(), {}).package,
    "funding"
  );
});

test("matrix: unknown / null outcome → hold (fail closed)", () => {
  assert.equal(buildDocuments(null, [], makeNormalized(), {}).package, "hold");
  assert.equal(buildDocuments(undefined, [], makeNormalized(), {}).package, "hold");
  assert.equal(buildDocuments("", [], makeNormalized(), {}).package, "hold");
  assert.equal(buildDocuments("TYPO_TIER", [], makeNormalized(), {}).package, "hold");
  assert.equal(buildDocuments("full_funding", [], makeNormalized(), {}).package, "hold");
});

// ---------------------------------------------------------------------------
// Null / empty edges — never throw
// ---------------------------------------------------------------------------

test("null normalized does not throw (funding)", () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildDocuments("FULL_FUNDING", [], null, {});
  });
  assert.equal(result.package, "funding");
  assert.equal(result.letters.length, 0);
  assert.ok(Array.isArray(result.summaryDocuments));
});

test("null normalized does not throw (repair)", () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildDocuments("REPAIR_ONLY", null, null, null);
  });
  assert.equal(result.package, "repair");
  assert.equal(result.letters.length, 0);
});

test("undefined normalized + empty findings does not throw (hold)", () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildDocuments("MANUAL_REVIEW", [], undefined, undefined);
  });
  assert.equal(result.package, "hold");
  assert.equal(result.letters.length, 0);
});

test("malformed normalized (missing meta / inquiries) does not throw", () => {
  let result;
  assert.doesNotThrow(() => {
    result = buildDocuments("FULL_FUNDING", [], {}, {});
  });
  assert.equal(result.package, "funding");
  assert.equal(result.letters.length, 0);

  assert.doesNotThrow(() => {
    result = buildDocuments("FULL_FUNDING", [], { meta: null, inquiries: null }, {});
  });
  assert.equal(result.package, "funding");

  assert.doesNotThrow(() => {
    result = buildDocuments(
      "FULL_FUNDING",
      [],
      { meta: { availableBureaus: "not-array" }, inquiries: "nope" },
      {}
    );
  });
  assert.equal(result.package, "funding");
  assert.equal(result.letters.length, 0);
});

test("empty findings array is fine on every package kind", () => {
  for (const outcome of [
    "FRAUD_HOLD",
    "MANUAL_REVIEW",
    "REPAIR_ONLY",
    "FULL_FUNDING",
    "PREMIUM_STACK",
    "FUNDING_PLUS_REPAIR"
  ]) {
    assert.doesNotThrow(() => buildDocuments(outcome, [], makeNormalized(), {}));
  }
});

test("null findings does not throw", () => {
  assert.doesNotThrow(() => buildDocuments("FULL_FUNDING", null, makeNormalized(), null));
  assert.doesNotThrow(() => buildDocuments("REPAIR_ONLY", undefined, makeNormalized(), undefined));
});

test("FUNDING_PLUS_REPAIR with null bureauNegatives stays funding, no dispute specs", () => {
  const result = buildDocuments(
    "FUNDING_PLUS_REPAIR",
    [],
    makeNormalized(["transunion"]),
    { bureauNegatives: null }
  );
  assert.equal(result.package, "funding");
  assert.equal(result.letters.filter((l) => l.type === "dispute").length, 0);
});

test("hole inquiry rows do not throw", () => {
  const normalized = {
    meta: { availableBureaus: ["experian"] },
    inquiries: [null, { source: "experian" }, undefined]
  };
  let result;
  assert.doesNotThrow(() => {
    result = buildDocuments("FULL_FUNDING", [], normalized, {});
  });
  assert.equal(result.package, "funding");
  assert.equal(result.letters.filter((l) => l.type === "inquiry_removal").length, 1);
});
