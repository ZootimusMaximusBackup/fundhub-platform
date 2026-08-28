import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextRound,
  roundAllowed,
  caseStatusFromItems,
  applyItemOutcome,
  crossesIntoEscalation,
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

// ═══════════════════════════════════════════════════════════════════════════════
// CROSSING INTO R4 NEEDS A PERSON
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// A confident AI read of a client-uploaded bureau letter advances a round with
// nobody in the loop. That is intended for the bureau ladder. It is NOT intended
// for the crossing into R4, where the CFPB and state attorney general complaints
// — signed by the consumer under penalty of perjury — get released.
//
// Owner-set 2026-08-28: R1→R2 and R2→R3 stay automatic; entering R4 needs a human.
// ═══════════════════════════════════════════════════════════════════════════════

describe("the escalation crossing is gated on a human", () => {
  const verified = (round, opts) => applyItemOutcome({ id: "i1", status: "sent", round }, "verified", opts);

  it("R1→R2 AND R2→R3 STILL ADVANCE WITH NO HUMAN — this must not change", () => {
    // The thing most likely to break by accident. A wrong move here costs a
    // letter and is recoverable, and the speed is the point.
    for (const [from, to] of [["R1", "R2"], ["R2", "R3"]]) {
      const auto = verified(from);
      assert.equal(auto.status, "escalated", `${from} stopped advancing on its own`);
      assert.equal(auto.round, to);
      assert.equal(auto.awaiting_human_confirmation, undefined);
      // And it behaves identically when a human IS present.
      const withHuman = verified(from, { humanConfirmed: true });
      assert.equal(withHuman.status, "escalated");
      assert.equal(withHuman.round, to);
    }
  });

  it("R3→R4 IS REFUSED WITHOUT A HUMAN — the item keeps its round", () => {
    const r = verified("R3");
    assert.equal(r.status, "verified", "an unconfirmed R3 answer must not become escalated");
    assert.equal(r.round, "R3", "the item must not move to R4");
    assert.equal(r.awaiting_human_confirmation, true);
    assert.equal(r.would_advance_to, "R4");
  });

  it("R3→R4 goes through when a human confirmed it", () => {
    const r = verified("R3", { humanConfirmed: true });
    assert.equal(r.status, "escalated");
    assert.equal(r.round, "R4");
    assert.equal(r.awaiting_human_confirmation, undefined);
  });

  it("moves already inside escalation need a human too", () => {
    for (const [from, to] of [["R4", "R5"], ["R5", "R6"]]) {
      assert.equal(verified(from).status, "verified", `${from}→${to} advanced with no human`);
      assert.equal(verified(from).round, from);
      assert.equal(verified(from, { humanConfirmed: true }).round, to);
    }
  });

  it("ONLY THE LITERAL TRUE COUNTS AS A HUMAN", () => {
    // A truthy sentinel must not buy an escalation. The auto path passes null or
    // the string "system_high_confidence"; neither is a person.
    for (const junk of ["system_high_confidence", "true", 1, {}, [], "yes", null, undefined, 0, ""]) {
      const r = verified("R3", { humanConfirmed: junk });
      assert.equal(r.status, "verified", `${JSON.stringify(junk)} was accepted as a human`);
      assert.equal(r.round, "R3");
    }
  });

  it("a deleted, updated or unaddressed answer at R3 is unaffected — nothing escalates", () => {
    for (const outcome of ["deleted", "updated", "unaddressed"]) {
      const r = applyItemOutcome({ status: "sent", round: "R3" }, outcome);
      assert.equal(r.awaiting_human_confirmation, undefined);
      assert.equal(r.round, "R3");
    }
  });

  it("the cap still wins — a capped item closes rather than waiting on a human", () => {
    const r = applyItemOutcome({ status: "sent", round: "R3" }, "verified", { roundsCap: 3 });
    assert.equal(r.status, "closed");
    assert.equal(r.blocked_at_cap, true);
    assert.equal(r.awaiting_human_confirmation, undefined);
  });

  it("crossesIntoEscalation names exactly the R3→R4 boundary and up", () => {
    assert.equal(crossesIntoEscalation("R1"), false);
    assert.equal(crossesIntoEscalation("R2"), false);
    assert.equal(crossesIntoEscalation("R3"), true);
    assert.equal(crossesIntoEscalation("R4"), true);
    assert.equal(crossesIntoEscalation("R5"), true);
    assert.equal(crossesIntoEscalation("R6"), false, "R6 is the cap — there is nowhere to cross to");
    assert.equal(crossesIntoEscalation("R3", 3), false, "a trial cap of 3 never reaches R4");
  });

  it("advanceAfterParse reports the hold, and holds only what needed holding", () => {
    const items = [
      { id: "a", status: "sent", round: "R1" },
      { id: "b", status: "sent", round: "R3" }
    ];
    const outcomes = [{ itemId: "a", outcome: "verified" }, { itemId: "b", outcome: "verified" }];
    const out = advanceAfterParse({ items, outcomes });
    assert.equal(out.heldForHuman, true);
    const a = out.items.find((i) => i.id === "a");
    const b = out.items.find((i) => i.id === "b");
    assert.equal(a.round, "R2", "the R1 item must still advance on its own");
    assert.equal(b.round, "R3", "the R3 item must wait for a person");
    assert.equal(out.log.find((l) => l.itemId === "a").held_for_human, false);
    assert.equal(out.log.find((l) => l.itemId === "b").held_for_human, true);
  });

  it("with a human, nothing is held", () => {
    const out = advanceAfterParse({
      items: [{ id: "b", status: "sent", round: "R3" }],
      outcomes: [{ itemId: "b", outcome: "verified" }],
      humanConfirmed: true
    });
    assert.equal(out.heldForHuman, false);
    assert.equal(out.items[0].round, "R4");
  });

  it("a held item is still reported as needing escalation — nothing is dropped", () => {
    const out = advanceAfterParse({
      items: [{ id: "b", status: "sent", round: "R3" }],
      outcomes: [{ itemId: "b", outcome: "verified" }]
    });
    assert.equal(out.escalate.length, 1, "the held item vanished from the escalation list");
    assert.equal(out.escalate[0].id, "b");
  });
});
