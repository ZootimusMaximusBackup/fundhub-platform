import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupFurnisherClaims, ruleBackedClaims } from "../repair/analyze.mjs";
import { formatPriorEvidence, buildLetterText } from "./letters/generate.mjs";
import { promptPoolRound, openingFor, ROUND } from "./letters/prompts.mjs";

describe("WS-B furnisher grouping (B1)", () => {
  it("groups collection claims by creditor name_norm", () => {
    const groups = groupFurnisherClaims({
      EX: [
        {
          ruleId: "M2-019",
          severity: "deletion",
          creditor: "Midland Credit Management",
          account_last4: "1234",
          collection: true
        },
        {
          ruleId: "M2-007",
          severity: "deletion",
          creditor: "Chase",
          account_last4: "9999"
        }
      ],
      TU: [
        {
          ruleId: "M2-019",
          severity: "strong",
          creditor: "midland credit management",
          account_last4: "1234",
          collection: true
        }
      ]
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].nameNorm, "midland credit management");
    assert.equal(groups[0].claims.length, 2);
  });

  it("ruleBackedClaims still requires ruleId + severity", () => {
    assert.equal(ruleBackedClaims([{ ruleId: "M2-019" }]).length, 0);
    assert.equal(ruleBackedClaims([{ ruleId: "M2-019", severity: "deletion" }]).length, 1);
  });
});

describe("WS-B prior evidence in letters (B3)", () => {
  it("formatPriorEvidence quotes outcome and last4", () => {
    const lines = formatPriorEvidence([
      {
        date: "2026-08-01T12:00:00Z",
        outcome: "verified",
        accountLast4: "1234",
        rawExcerpt: "Account verified as reported"
      }
    ]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /On 2026-08-01 you responded 'verified' for account ending 1234/);
    assert.match(lines[0], /Account verified as reported/);
  });

  it("R2 letter body includes prior response quote", () => {
    const text = buildLetterText({
      violations: [
        {
          ruleId: "M2-007",
          severity: "deletion",
          field: "25",
          observed: "2015-01-01",
          expected: "deleted",
          reason: "Obsolete",
          citations: ["15 U.S.C. § 1681c(a)"],
          metro2Ref: "Field 25",
          account_last4: "1234"
        }
      ],
      identity: {
        fullName: "Jane Consumer",
        addressLine1: "123 Main St",
        city: "Phoenix",
        state: "AZ",
        zip: "85001"
      },
      bureau: "EX",
      round: "R2",
      seed: "b3-prior-evidence",
      priorResponses: [
        {
          date: "2026-07-15",
          outcome: "verified",
          accountLast4: "1234",
          rawExcerpt: "verified as reported"
        }
      ]
    });
    assert.match(text, /PRIOR BUREAU RESPONSE/);
    assert.match(text, /On 2026-07-15 you responded 'verified' for account ending 1234/);
  });
});

describe("WS-B R4–R6 prompt pools (D3)", () => {
  it("R4 and R6 cycle R2; R5 cycles R3", () => {
    assert.equal(promptPoolRound("R4"), ROUND.R2);
    assert.equal(promptPoolRound("R5"), ROUND.R3);
    assert.equal(promptPoolRound("R6"), ROUND.R2);
  });

  it("R4 opening comes from R2 pool", () => {
    const r2 = openingFor(0, ROUND.R2);
    const r4 = openingFor(0, "R4");
    assert.equal(r4, r2);
  });
});
