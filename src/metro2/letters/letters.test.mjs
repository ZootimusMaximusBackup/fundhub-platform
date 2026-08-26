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

  it("labels each item with Violation, field, and severity", () => {
    const text = buildLetterText({ violations: sampleViolations, identity, bureau: "EX", seed: "jane-ex-r1" });
    assert.match(text, /Violation M2-007 — Obsolete item/);
    assert.match(text, /Violation M2-011 — Status-balance contradiction/);
    assert.match(text, /Metro 2 field: Field 25/);
    assert.match(text, /Severity: Deletion-tier/);
    assert.match(text, /Severity: Strong/);
    assert.match(text, /Signature:/);
    assert.equal(/fundhub/i.test(text), false);
    assert.match(text, /Re: Round 1 Metro 2 dispute — /);
    assert.match(text, /M2-007/);
    assert.match(text, /M2-011/);
  });

  it("names the creditor and last four when the item has them", () => {
    const text = buildLetterText({
      violations: [{
        ...sampleViolations[0],
        creditor: "CAPITAL ONE",
        account_last4: "8664"
      }],
      identity,
      bureau: "EX",
      seed: "creditor-ex"
    });
    assert.match(text, /Account: CAPITAL ONE · ending 8664/);
  });

  it("prints last four of SSN only when identity has ssn", () => {
    const withSsn = buildLetterText({
      violations: sampleViolations,
      identity: { ...identity, ssn: "123-45-6789" },
      bureau: "EQ",
      seed: "ssn-eq"
    });
    assert.match(withSsn, /Last four of SSN: 6789/);
    assert.doesNotMatch(withSsn, /123-45-6789/);
    assert.doesNotMatch(withSsn, /123456789/);
    const without = buildLetterText({
      violations: sampleViolations,
      identity,
      bureau: "EQ",
      seed: "ssn-eq"
    });
    assert.doesNotMatch(without, /SSN/);
  });

  it("escalates copy by round without making R1 a final notice", () => {
    const r1 = buildLetterText({
      violations: sampleViolations,
      identity,
      bureau: "TU",
      round: "R1",
      seed: "round-tu"
    });
    const r2 = buildLetterText({
      violations: sampleViolations,
      identity,
      bureau: "TU",
      round: "R2",
      seed: "round-tu"
    });
    const r3 = buildLetterText({
      violations: sampleViolations,
      identity,
      bureau: "TU",
      round: "R3",
      seed: "round-tu"
    });
    const r1Body = r1.split("CITATIONS:")[0];
    assert.match(r1Body, /30 days/);
    assert.match(r1Body, /method of verification/i);
    assert.match(r1Body, /not a final notice/i);
    assert.doesNotMatch(r1Body, /this is a final notice/i);
    assert.doesNotMatch(r1Body, /willful noncompliance/i);
    assert.doesNotMatch(r1Body, /1681n/);
    assert.match(r2, /611\(a\)\(7\)/);
    assert.match(r2, /611\(a\)\(6\)\(B\)\(iii\)/);
    assert.match(r2, /furnisher/i);
    assert.match(r3, /611\(a\)\(5\)\(A\)/);
    assert.match(r3, /15 days/);
    assert.match(r3, /1681n/);
    assert.match(r3, /not a lawsuit/i);
    assert.match(r3, /Re: Round 3 Metro 2 dispute/);
    assert.equal(/Tone:/i.test(r1 + r2 + r3), false);
    assert.equal(/Hooks for this round/i.test(r1 + r2 + r3), false);
  });

  it("uses metro2Ref as the name when the rule is not in the short list", () => {
    const text = buildLetterText({
      violations: [{
        ruleId: "M2-018",
        severity: "moderate",
        field: "23",
        observed: null,
        expected: "populated",
        reason: "Original charge-off amount is blank",
        citations: ["15 U.S.C. § 1681e(b)"],
        metro2Ref: "Field 23 — Original Charge-off Amount"
      }],
      identity,
      bureau: "EX",
      seed: "fallback-name"
    });
    assert.match(text, /Violation M2-018 — Field 23 — Original Charge-off Amount/);
    assert.match(text, /Severity: Moderate/);
  });
});
