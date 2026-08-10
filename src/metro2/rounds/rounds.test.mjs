import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextRound, caseStatusFromItems, applyItemOutcome, preDispatchRecheck } from "./state.mjs";
import { advanceAfterParse, filterForDispatch } from "./advance.mjs";

describe("rounds state", () => {
  it("nextRound advances R1→R2→R3→null", () => {
    assert.equal(nextRound("R1"), "R2");
    assert.equal(nextRound("R2"), "R3");
    assert.equal(nextRound("R3"), null);
  });

  it("mixed outcomes: one deleted neighbour escalates", () => {
    const items = [
      { id: "1", status: "sent", round: "R1", creditor: "A", account_last4: "1111", rule_id: "M2-007" },
      { id: "2", status: "sent", round: "R1", creditor: "B", account_last4: "2222", rule_id: "M2-011" }
    ];
    const r = advanceAfterParse({
      items,
      outcomes: [
        { itemId: "1", outcome: "deleted" },
        { itemId: "2", outcome: "verified" }
      ]
    });
    assert.equal(r.items.find((i) => i.id === "1").status, "deleted");
    assert.equal(r.items.find((i) => i.id === "2").status, "escalated");
    assert.equal(r.items.find((i) => i.id === "2").round, "R2");
    assert.equal(r.escalate.length, 1);
  });

  it("preDispatchRecheck closes items gone from fresh pull", () => {
    const item = { creditor: "Midland", account_last4: "4521", rule_id: "M2-018", status: "escalated", round: "R2" };
    const r = preDispatchRecheck(item, [{ creditor: "Other", account_last4: "9999", rule_id: "M2-001" }]);
    assert.equal(r.proceed, false);
    assert.equal(r.reason, "absent_on_fresh_pull");
  });

  it("filterForDispatch keeps items still on report", () => {
    const items = [
      { creditor: "Midland", account_last4: "4521", rule_id: "M2-018", status: "escalated", round: "R2" }
    ];
    const latest = [{ creditor: "Midland", account_last4: "4521", rule_id: "M2-018" }];
    const r = filterForDispatch(items, latest);
    assert.equal(r.keep.length, 1);
    assert.equal(r.closed.length, 0);
  });

  it("caseStatusFromItems reaches round_complete when all resolved", () => {
    assert.equal(
      caseStatusFromItems([
        { status: "deleted" },
        { status: "updated" }
      ]),
      "round_complete"
    );
  });

  it("applyItemOutcome verified at R3 closes", () => {
    const r = applyItemOutcome({ status: "sent", round: "R3" }, "verified");
    assert.equal(r.status, "closed");
  });
});
