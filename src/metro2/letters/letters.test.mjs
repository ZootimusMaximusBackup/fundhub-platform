// Unit tests — letter variance + generation + citation gate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  structuralFingerprint,
  similarityScore,
  assertBelowThreshold,
  assertBatchVariance,
  generateWithVarianceGate
} from "./variance.mjs";
import { buildLetterText, generateLetter } from "./generate.mjs";
import { assertCitationsByteIdentical } from "./citations-assert.mjs";
import { renderLetterPdf } from "./render.mjs";

const sampleViolations = [
  {
    ruleId: "M2-007",
    severity: "deletion",
    field: "25",
    observed: "2015-01-01",
    expected: "deleted",
    reason: "DOFD + 7 years + 180 days is past today",
    citations: ["15 U.S.C. § 1681c(a)", "15 U.S.C. § 1681i(a)(5)(A)"],
    metro2Ref: "Field 25"
  },
  {
    ruleId: "M2-011",
    severity: "strong",
    field: "21",
    observed: 2100,
    expected: 0,
    reason: "Status 13 with non-zero balance",
    citations: ["15 U.S.C. § 1681e(b)", "Saunders v. Branch Banking & Trust Co."],
    metro2Ref: "Exhibit 4, Status 13"
  }
];

const identity = {
  fullName: "Jane Consumer",
  addressLine1: "123 Main St",
  city: "Phoenix",
  state: "AZ",
  zip: "85001"
};

describe("variance", () => {
  it("identical letters score 1", () => {
    const a = structuralFingerprint("hello world dispute letter text here");
    assert.equal(similarityScore(a, a), 1);
  });

  it("rejects near-duplicates above threshold", () => {
    const base = "I dispute the inaccurate Metro 2 reporting on my Experian file for account ending 4521.";
    const clone = "I dispute the inaccurate Metro 2 reporting on my Experian file for account ending 4521.";
    const gate = assertBelowThreshold(clone, [base], 0.35);
    assert.equal(gate.ok, false);
  });

  it("accepts structurally different letters", () => {
    const a = "Opening with a statutory demand under section sixteen eighty one. Delete unverifiable items.";
    const b = "My factual account begins with Midland Funding reporting a balance after sale. Please investigate.";
    const gate = assertBelowThreshold(b, [a], 0.35);
    assert.equal(gate.ok, true);
  });

  it("batch variance catches intra-batch twins", () => {
    const t = "Same letter text for Experian TransUnion and Equifax batch twin detection pad.";
    const r = assertBatchVariance([
      { text: t, bureau: "EX" },
      { text: t, bureau: "TU" }
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "intra_batch");
  });

  it("generateWithVarianceGate fails after strikes", async () => {
    const twin = "fixed letter content that never changes across regeneration attempts pad pad";
    const r = await generateWithVarianceGate({
      priorLetters: [twin],
      produce: async () => twin,
      maxStrikes: 2
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "variance_gate_exhausted");
  });
});

describe("generate", () => {
  it("refuses letters with no ruleId violations", () => {
    assert.throws(
      () => buildLetterText({ violations: [{ reason: "no id" }], identity, bureau: "EX" }),
      /no_rule_id/
    );
  });

  it("emits every ruleId and a citation block", () => {
    const text = buildLetterText({ violations: sampleViolations, identity, bureau: "EX", seed: "jane-ex-r1" });
    assert.match(text, /M2-007/);
    assert.match(text, /M2-011/);
    assert.match(text, /CITATIONS:/);
    assert.match(text, /Jane Consumer/);
    const cite = assertCitationsByteIdentical(text, sampleViolations);
    assert.equal(cite.ok, true, JSON.stringify(cite));
  });

  it("undated mode leaves a date blank for DIY", () => {
    const text = buildLetterText({
      violations: sampleViolations,
      identity,
      bureau: "TU",
      undated: true,
      seed: "diy"
    });
    assert.match(text, /DATE — write today's date/);
  });

  it("generateLetter returns ok with fingerprint", async () => {
    const r = await generateLetter({
      violations: sampleViolations,
      identity,
      bureau: "EQ",
      seed: "eq-1",
      priorLetters: []
    });
    assert.equal(r.ok, true);
    assert.ok(r.fingerprint.length > 0);
    assert.deepEqual(r.ruleIds, ["M2-007", "M2-011"]);
  });

  it("renderLetterPdf produces a non-empty PDF", async () => {
    const text = buildLetterText({ violations: sampleViolations, identity, bureau: "EX", seed: "pdf" });
    const bytes = await renderLetterPdf({ text, identity });
    assert.ok(bytes.byteLength > 500);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "%PDF");
  });
});
