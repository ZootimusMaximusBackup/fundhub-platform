import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupFurnisherClaims, ruleBackedClaims } from "../repair/analyze.mjs";
import { formatPriorEvidence, buildLetterText } from "./letters/generate.mjs";
import { promptPoolRound, openingFor, closingFor, roundInstructions, ROUND } from "./letters/prompts.mjs";
import {
  ESCALATION_ROUNDS,
  LADDER_ROUNDS,
  LETTER_TYPES,
  LETTER_TYPE_LIST,
  isEscalationRound,
  letterTypeForRound,
  roundLadderEntry
} from "./letters/catalog.mjs";
import { BUREAU_ROUNDS } from "./rounds/state.mjs";

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

describe("WS-B R4–R6 bureau prose pools", () => {
  // These three used to assert R4→R2, R5→R3, R6→R2, which is the mapping that
  // sent a client past Round 3 back to the Round 2 method-of-verification
  // wording forever. The ladder moved to catalog.mjs ROUND_LADDER; what is
  // pinned here now is the prose rule that replaced it.
  it("after Round 3 every bureau letter is a final notice — R4, R5 and R6 all take R3", () => {
    assert.equal(promptPoolRound("R4"), ROUND.R3);
    assert.equal(promptPoolRound("R5"), ROUND.R3);
    assert.equal(promptPoolRound("R6"), ROUND.R3);
  });

  it("R1, R2, R3 and FURNISHER still write in their own voice", () => {
    assert.equal(promptPoolRound("R1"), ROUND.R1);
    assert.equal(promptPoolRound("R2"), ROUND.R2);
    assert.equal(promptPoolRound("R3"), ROUND.R3);
    assert.equal(promptPoolRound("FURNISHER"), ROUND.FURNISHER);
  });

  it("NO ROUND EVER STEPS BACK DOWN TO THE ROUND 2 WORDING", () => {
    // A step down in authority is the opposite of an escalation ladder.
    for (const round of ["R3", "R4", "R5", "R6"]) {
      assert.notEqual(promptPoolRound(round), ROUND.R2,
        `${round} must not ask the method-of-verification question a third time`);
    }
  });

  /* THIS USED TO ASSERT THE R4 OPENING WAS THE R3 OPENING, WORD FOR WORD.
     It was, and that is exactly what stopped the ladder at Round 3: the
     variance gate compares each letter against recent letters to the same
     bureau and refuses anything over 35% similar, so a Round 4 letter built
     from Round 3's sentences came back `variance_gate_exhausted` every time.
     Measured on origin/main against real Postgres and the production sim seed:
     R1 five letters, R2 three, R3 three, R4 zero, R5 zero, R6 zero.

     R4, R5 and R6 have their own words now. What must NOT change is the
     authority behind them — `promptPoolRound` still calls all three a final
     notice (pinned above), the statutory hooks are R3's, and none of them
     climbs to a stronger claim. That is what this pins instead. */
  it("R4, R5 and R6 write in their own words while citing exactly what R3 cites", () => {
    const r3Openings = new Set(Array.from({ length: 6 }, (_, i) => openingFor(i, ROUND.R3)));
    const r3 = roundInstructions(ROUND.R3);
    for (const round of ["R4", "R5", "R6"]) {
      for (let seed = 0; seed < 6; seed++) {
        assert.equal(r3Openings.has(openingFor(seed, round)), false,
          `${round} opening ${seed} is still one of Round 3's own sentences`);
      }
      assert.deepEqual(roundInstructions(round).hooks, r3.hooks,
        `${round} must rest on the same law Round 3 rests on, and no more`);
    }
  });

  it("NO R4-R6 WORDING CLAIMS A COMPLAINT WAS ALREADY FILED", () => {
    // Nothing in this repository records that a client filed a CFPB or state AG
    // complaint. Every reference to one in a bureau letter must stay future
    // tense, or the letter asserts something nobody here can know.
    const filed = /\b(have|has|already)\s+filed\b|\bi\s+filed\b/i;
    for (const round of ["R4", "R5", "R6"]) {
      for (let seed = 0; seed < 6; seed++) {
        assert.equal(filed.test(openingFor(seed, round)), false,
          `${round} opening ${seed} claims a filing that is not on record`);
        assert.equal(filed.test(closingFor(seed, round)), false,
          `${round} closing ${seed} claims a filing that is not on record`);
      }
      const instr = roundInstructions(round);
      for (const [key, line] of Object.entries(instr)) {
        if (typeof line !== "string") continue;
        assert.equal(filed.test(line), false,
          `${round} ${key} claims a filing that is not on record`);
      }
    }
  });
});

describe("the round ladder — one, two, three, then stronger law", () => {
  it("R4 is the CFPB complaint and R5 is the state attorney general complaint", () => {
    assert.equal(letterTypeForRound("R4"), LETTER_TYPES.CFPB_COMPLAINT);
    assert.equal(letterTypeForRound("R5"), LETTER_TYPES.STATE_AG_COMPLAINT);
  });

  it("R1, R2 and R3 are the three bureau letters, in order", () => {
    assert.equal(letterTypeForRound("R1"), LETTER_TYPES.R1_METRO2);
    assert.equal(letterTypeForRound("R2"), LETTER_TYPES.R2_FCRA_MOV);
    assert.equal(letterTypeForRound("R3"), LETTER_TYPES.R3_FINAL_NOTICE);
  });

  it("R6 REUSES the Round 3 final notice — no eighth letter type was invented", () => {
    assert.equal(letterTypeForRound("R6"), LETTER_TYPES.R3_FINAL_NOTICE);
    assert.equal(LETTER_TYPE_LIST.length, 8,
      "an escalation-final-notice type must not be quietly added; R6 reuses R3");
  });

  it("R6's label says it is reissued, and does not claim the complaints were filed", () => {
    const rung = roundLadderEntry("R6");
    assert.equal(rung.title, "Final notice, reissued");
    assert.match(rung.sendWhen, /Reuses the Round 3 final notice/);
    assert.match(rung.sendWhen, /does not claim either complaint was filed/);
    assert.notEqual(rung.title, roundLadderEntry("R3").title,
      "R6 must not print R3's title — its timing is different");
  });

  it("the escalation rounds are exactly R4, R5 and R6", () => {
    assert.deepEqual([...ESCALATION_ROUNDS], ["R4", "R5", "R6"]);
    for (const r of ["R1", "R2", "R3", "FURNISHER", "", null, undefined]) {
      assert.equal(isEscalationRound(r), false, `${r} is not an escalation round`);
    }
    for (const r of ["R4", "R5", "R6", "r4"]) {
      assert.equal(isEscalationRound(r), true, `${r} is an escalation round`);
    }
  });

  it("the ladder covers every bureau round the round machine can produce", () => {
    // Two files list the six rounds. If they ever drift, buildRoundPlan reads a
    // rung that does not exist.
    assert.deepEqual([...LADDER_ROUNDS], [...BUREAU_ROUNDS]);
    for (const round of BUREAU_ROUNDS) {
      assert.ok(roundLadderEntry(round), `${round} has no rung on the ladder`);
    }
  });
});
