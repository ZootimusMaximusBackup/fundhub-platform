// The pure shaping rules behind /api/read/client-progress. Everything that
// needs a database is proved in src/http/client-progress.pg.test.mjs instead.

import { test, describe } from "node:test";
import assert from "node:assert";
import { nextStepOf, waitingOn, paidRoundOffer, roundNumber, PAID_ROUND_SERVICE_KIND } from "./read.mjs";
import { ROUND_BASE_CENTS, CREDITOR_LETTER_CENTS, ESCALATION_FILINGS_CENTS } from "../waypoints/pricing.mjs";

const wp = (over = {}) => ({
  id: "w1", order: 1, title: "t", owner: "client", state: "not_started",
  dueAt: null, overdue: false, completedAt: null, paidAlternative: null, ...over
});

describe("nextStep names exactly one waypoint", () => {
  test("the client's own open work comes first, even when FundHub owes something earlier", () => {
    const next = nextStepOf([
      wp({ id: "a", owner: "fundhub", order: 1 }),
      wp({ id: "b", owner: "client", order: 2 })
    ]);
    assert.deepEqual(next, { waypointId: "b", owner: "client" });
  });

  test("with nothing owed by the client it names what FundHub owes", () => {
    const next = nextStepOf([
      wp({ id: "a", owner: "client", state: "done", completedAt: "2026-01-01T00:00:00Z" }),
      wp({ id: "b", owner: "fundhub" })
    ]);
    assert.deepEqual(next, { waypointId: "b", owner: "fundhub" });
  });

  test("a blocked row is still open work and can be the next step", () => {
    assert.deepEqual(nextStepOf([wp({ id: "c", state: "blocked" })]),
      { waypointId: "c", owner: "client" });
  });

  test("done and skipped rows are never the next step", () => {
    assert.strictEqual(nextStepOf([
      wp({ id: "a", state: "done", completedAt: "2026-01-01T00:00:00Z" }),
      wp({ id: "b", state: "skipped" })
    ]), null);
  });

  test("no waypoints at all is null, not an invented step", () => {
    assert.strictEqual(nextStepOf([]), null);
  });
});

describe("waitingOn", () => {
  test("the bureaus win while the letters are out, whatever the checklist says", () => {
    const next = { waypointId: "w", owner: "client" };
    assert.equal(waitingOn({ stageKey: "in_transit", next }), "bureaus");
    assert.equal(waitingOn({ stageKey: "awaiting_response", next }), "bureaus");
  });

  test("otherwise it follows whoever owns the next step", () => {
    assert.equal(waitingOn({ stageKey: "analysis", next: { owner: "client" } }), "client");
    assert.equal(waitingOn({ stageKey: "analysis", next: { owner: "fundhub" } }), "fundhub");
  });

  test("unknown stage with nothing open is null, not a guess at fundhub", () => {
    assert.strictEqual(waitingOn({ stageKey: null, next: null }), null);
  });
});

describe("the paid round offer", () => {
  test("prices come from src/waypoints/pricing.mjs and are integer cents", () => {
    const offer = paidRoundOffer({ repairPath: true });
    const by = Object.fromEntries(offer.components.map((c) => [c.key, c]));
    /* THE CONTRACT'S KEYS, not the internal line codes. These were round_base /
       creditor_letter / escalation_filings — src/waypoints/pricing.mjs's private
       spelling — while GET /api/paid-services and
       docs/workflows/portal-progress-contract.md:108-110 both said base /
       creditor / cfpb_and_ag. Two reads of one product, two sets of keys, and the
       screen decides which extras to buy from them. The prices are still asserted
       against the same constants, so this is not a looser test. */
    assert.equal(by.base.priceCents, ROUND_BASE_CENTS);
    assert.equal(by.creditor.priceCents, CREDITOR_LETTER_CENTS);
    assert.equal(by.cfpb_and_ag.priceCents, ESCALATION_FILINGS_CENTS);
    assert.deepEqual(Object.keys(by), ["base", "creditor", "cfpb_and_ag"],
      "the keys a screen maps its checkboxes from are the contract's");
    for (const c of offer.components) assert.ok(Number.isInteger(c.priceCents));
  });

  test("only the base is required; the two add-ons are optional", () => {
    const offer = paidRoundOffer({ repairPath: true });
    assert.deepEqual(offer.components.map((c) => c.required), [true, false, false]);
  });

  test("an open request makes it inFlight, so a second press can be refused", () => {
    for (const status of ["quoted", "awaiting_payment", "paid", "staged"]) {
      const offer = paidRoundOffer({
        repairPath: true,
        paidRows: [{ service_kind: PAID_ROUND_SERVICE_KIND, status }]
      });
      assert.equal(offer.inFlight, true, status);
      assert.equal(offer.available, false, status);
    }
  });

  test("a finished request does not block the next one", () => {
    for (const status of ["failed", "cancelled", "refunded", "fulfilled"]) {
      const offer = paidRoundOffer({
        repairPath: true,
        paidRows: [{ service_kind: PAID_ROUND_SERVICE_KIND, status }]
      });
      assert.equal(offer.inFlight, false, status);
      assert.equal(offer.available, true, status);
    }
  });

  test("a client not on the optimisation path is not offered a round", () => {
    assert.equal(paidRoundOffer({ repairPath: false }).available, false);
  });

  test("a credit pull request in flight does not block a dispute round", () => {
    const offer = paidRoundOffer({
      repairPath: true,
      paidRows: [{ service_kind: "credit_pull", status: "paid" }]
    });
    assert.equal(offer.inFlight, false);
  });
});

describe("roundNumber", () => {
  test("R3 is 3", () => assert.equal(roundNumber("R3"), 3));
  test("R6 is 6", () => assert.equal(roundNumber("R6"), 6));
  test("FURNISHER is not a rung and is null, never zero", () => {
    assert.strictEqual(roundNumber("FURNISHER"), null);
  });
  test("null and nonsense are null, never zero", () => {
    assert.strictEqual(roundNumber(null), null);
    assert.strictEqual(roundNumber(""), null);
    assert.strictEqual(roundNumber("R0"), null);
    assert.strictEqual(roundNumber("banana"), null);
  });
});
