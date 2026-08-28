import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRoundPlan } from "./round-plan.mjs";
import { LETTER_TYPES, LETTER_TYPE_LIST } from "../metro2/letters/catalog.mjs";

describe("buildRoundPlan", () => {
  it("marks R1 written and R2 held after Round 1 letters, no fake later mail", () => {
    const plan = buildRoundPlan({
      roundsCap: 6,
      letters: [{ bureau: "EX", round: "R1", status: "generated" }],
      items: [{
        bureau: "EX",
        round: "R1",
        creditor: "CAPITAL ONE",
        account_last4: "8664",
        rule_id: "M2-005"
      }]
    });
    assert.equal(plan.length, 6);
    assert.equal(plan[0].round, "R1");
    assert.equal(plan[0].status, "written");
    assert.equal(plan[0].title, "Round 1 Metro 2 dispute");
    assert.match(plan[0].when, /First mail after engine findings/);
    assert.deepEqual(plan[0].attacks, ["EX · CAPITAL ONE · ending 8664 · M2-005"]);
    assert.equal(plan[1].round, "R2");
    assert.equal(plan[1].status, "held");
    assert.match(plan[1].when, /30 days/);
    assert.equal(plan[1].title, "Round 2 FCRA / method of verification");
    assert.equal(plan[2].status, "later");
    assert.equal(plan[5].round, "R6");
    // After Round 3 every bureau letter is written in the final-notice voice.
    // This used to read "R2" for R6, which is what sent a client past Round 3
    // back to the method-of-verification wording forever.
    assert.equal(plan[5].pool, "R3");
    assert.equal(plan[4].pool, "R3");
  });

  it("THE PLAN SHOWS THE ESCALATION LADDER, NOT A REPEAT OF ROUNDS 2 AND 3", () => {
    const plan = buildRoundPlan({ roundsCap: 6, letters: [], items: [] });

    assert.equal(plan[3].round, "R4");
    assert.equal(plan[3].letterType, LETTER_TYPES.CFPB_COMPLAINT);
    assert.equal(plan[3].title, "CFPB complaint");

    assert.equal(plan[4].round, "R5");
    assert.equal(plan[4].letterType, LETTER_TYPES.STATE_AG_COMPLAINT);
    assert.equal(plan[4].title, "State attorney general complaint");

    // R6 reuses the Round 3 final notice. Nothing new was invented for it, and
    // it is labelled as reissued so nobody reads it as a fourth bureau round.
    assert.equal(plan[5].round, "R6");
    assert.equal(plan[5].letterType, LETTER_TYPES.R3_FINAL_NOTICE);
    assert.equal(plan[5].title, "Final notice, reissued");
    assert.match(plan[5].when, /does not claim either complaint was filed/);

    // The regression this test exists for: no rung past R3 may carry a
    // Round 1/2/3 bureau title again.
    for (const rung of plan.slice(3)) {
      assert.notEqual(rung.title, "Round 2 FCRA / method of verification",
        `${rung.round} is showing the Round 2 letter again`);
      assert.notEqual(rung.title, "Round 3 final notice",
        `${rung.round} is showing the Round 3 letter again`);
    }
  });

  it("every rung of the six-round plan has a real letter type", () => {
    const plan = buildRoundPlan({ roundsCap: 6, letters: [], items: [] });
    assert.equal(plan.length, 6);
    for (const rung of plan) {
      assert.ok(LETTER_TYPE_LIST.includes(rung.letterType),
        `${rung.round} has no letter type on the catalog`);
      assert.ok(rung.title && rung.when, `${rung.round} is missing its label`);
    }
  });

  it("blocks R3+ on a trial cap of 2", () => {
    const plan = buildRoundPlan({
      roundsCap: 2,
      letters: [{ bureau: "EQ", round: "R1" }]
    });
    assert.equal(plan[0].status, "written");
    assert.equal(plan[1].status, "held");
    assert.equal(plan[2].status, "blocked_at_cap");
    assert.equal(plan[5].status, "blocked_at_cap");
  });

  it("does not invent R2 hold before any letter exists", () => {
    const plan = buildRoundPlan({ roundsCap: 6, letters: [], items: [] });
    assert.equal(plan[0].status, "current");
    assert.equal(plan[1].status, "later");
  });
});
