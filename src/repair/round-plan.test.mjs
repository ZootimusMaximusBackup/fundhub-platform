import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRoundPlan } from "./round-plan.mjs";

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
    assert.equal(plan[5].pool, "R2");
    assert.equal(plan[4].pool, "R3");
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
