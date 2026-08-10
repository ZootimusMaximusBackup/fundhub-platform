import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canLeaveIntake, croaReleaseDate, addBusinessDays } from "./croa.mjs";
import { assertReadyToSend, shouldAutoAdvanceParse } from "./safety.mjs";
import { isBreached, STAGE_SLA } from "./sla.mjs";
import { clientRepairView } from "./portal.mjs";
import { deletionRate, deletionsByRuleId } from "./metrics.mjs";
import { EVENT_STAGE } from "./pipeline.mjs";

const contract = {
  terms_and_cost: true,
  services_description: true,
  estimated_timeline: true,
  business_name_address: true,
  cancellation_notice: true,
  disclosure_delivered_at: "2026-08-01T00:00:00Z"
};

describe("repair croa", () => {
  it("holds intake inside 3 business days", () => {
    // Friday Aug 7 2026 → +3 biz = Wed Aug 12
    const release = croaReleaseDate("2026-08-07");
    assert.equal(release, "2026-08-12");
    const gate = canLeaveIntake({ enrolledAt: "2026-08-07", asOf: "2026-08-10", contract });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "croa_3_day_hold");
  });

  it("releases after 3 business days with complete contract", () => {
    const gate = canLeaveIntake({ enrolledAt: "2026-08-07", asOf: "2026-08-12", contract });
    assert.equal(gate.ok, true);
  });

  it("addBusinessDays skips weekends", () => {
    assert.equal(addBusinessDays("2026-08-07", 1), "2026-08-10"); // Fri → Mon
  });
});

describe("repair safety + sla + portal", () => {
  it("blocks send without ruleIds", () => {
    const r = assertReadyToSend({ letterText: "x", violations: [{ reason: "nope" }] });
    assert.equal(r.ok, false);
  });

  it("low confidence does not auto-advance", () => {
    assert.equal(shouldAutoAdvanceParse(0.5), false);
    assert.equal(shouldAutoAdvanceParse(0.9), true);
  });

  it("SLA breach on analysis after 1 hour", () => {
    const r = isBreached({
      stageKey: "analysis",
      enteredAt: "2026-08-10T10:00:00Z",
      asOf: "2026-08-10T12:00:00Z"
    });
    assert.equal(r.breached, true);
    assert.ok(STAGE_SLA.analysis);
  });

  it("portal hides funding for repair-only and shows date", () => {
    const v = clientRepairView({
      stageKey: "awaiting_response",
      responseDueAt: "2026-09-12",
      isRepairOnly: true
    });
    assert.equal(v.showFunding, false);
    assert.match(v.title, /2026-09-12/);
  });

  it("metrics are item-level", () => {
    const items = [
      { rule_id: "M2-018", status: "deleted" },
      { rule_id: "M2-018", status: "verified" },
      { rule_id: "M2-031", status: "deleted" }
    ];
    assert.equal(deletionRate(items).deleted, 2);
    const by = deletionsByRuleId(items);
    assert.equal(by.find((r) => r.ruleId === "M2-018").deleted, 1);
  });

  it("event stage map has no specialist_review", () => {
    assert.equal(Object.values(EVENT_STAGE).includes("specialist_review"), false);
    assert.equal(EVENT_STAGE["repair.analysis.empty"], "stalled");
    assert.equal(EVENT_STAGE["repair.letters.ready"], "ready_to_send");
  });
});
