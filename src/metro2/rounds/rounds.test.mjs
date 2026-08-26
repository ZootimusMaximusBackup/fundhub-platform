import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextRound,
  roundAllowed,
  caseStatusFromItems,
  applyItemOutcome,
  preDispatchRecheck
} from "./state.mjs";
import { advanceAfterParse, filterForDispatch } from "./advance.mjs";
import { needsUpsellPending, markUpsellPending } from "./program-cap.mjs";

describe("rounds state", () => {
  it("nextRound advances R1→…→R6→null under full cap", () => {
    assert.equal(nextRound("R1"), "R2");
    assert.equal(nextRound("R2"), "R3");
    assert.equal(nextRound("R3"), "R4");
    assert.equal(nextRound("R4"), "R5");
    assert.equal(nextRound("R5"), "R6");
    assert.equal(nextRound("R6"), null);
  });

  it("nextRound respects trial rounds_cap=2 (B2)", () => {
    assert.equal(nextRound("R1", 2), "R2");
    assert.equal(nextRound("R2", 2), null);
    assert.equal(roundAllowed("R3", 2), false);
    assert.equal(roundAllowed("R2", 2), true);
    assert.equal(roundAllowed("FURNISHER", 2), true);
  });

  it("full client advances past R2", () => {
    assert.equal(nextRound("R2", 6), "R3");
    assert.equal(roundAllowed("R4", 6), true);
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

  it("applyItemOutcome verified at R6 closes", () => {
    const r = applyItemOutcome({ status: "sent", round: "R6" }, "verified");
    assert.equal(r.status, "closed");
    assert.equal(r.blocked_at_cap, true);
  });

  it("trial cap at R2 blocks R3 and marks blocked_at_cap (B2)", () => {
    const r = applyItemOutcome({ status: "sent", round: "R2" }, "verified", { roundsCap: 2 });
    assert.equal(r.status, "closed");
    assert.equal(r.blocked_at_cap, true);
    assert.equal(r.round, "R2");
  });

  it("needsUpsellPending true for trial at R2 with open items (B2)", () => {
    assert.equal(
      needsUpsellPending({
        roundsCap: 2,
        items: [{ status: "open", round: "R2" }]
      }),
      true
    );
    assert.equal(
      needsUpsellPending({
        roundsCap: 2,
        log: [{ blocked_at_cap: true }]
      }),
      true
    );
    assert.equal(
      needsUpsellPending({
        roundsCap: 6,
        items: [{ status: "open", round: "R2" }]
      }),
      false
    );
    assert.equal(
      needsUpsellPending({
        roundsCap: 2,
        items: [{ status: "escalated", round: "R3" }]
      }),
      true
    );
  });

  it("markUpsellPending clamps items past the trial cap", async () => {
    const updates = [];
    const db = {
      async query(sql, params = []) {
        if (/UPDATE repair_programs/i.test(sql)) {
          return { rows: [{ id: "p1", program: "trial", rounds_cap: 2, status: "upsell_pending" }] };
        }
        if (/UPDATE dispute_items/i.test(sql)) {
          updates.push({ round: params[2], cap: params[3] });
          return { rows: [] };
        }
        return { rows: [] };
      }
    };
    const r = await markUpsellPending(db, {
      orgId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222"
    });
    assert.equal(r.ok, true);
    assert.equal(updates[0].round, "R2");
    assert.equal(updates[0].cap, 2);
  });
});
