// The client portal's stage ladder — the fix for walk finding F33, 2026-09-03.
//
// WHAT WENT WRONG. The portal decided its whole stage from one entitlement code.
// A client who had been credit-pulled, had the call, and signed a $5,000
// agreement was still greeted with "Your call is next" and told "we have not run
// those yet". The stage is now computed in api/read/portal-summary.mjs from four
// independent facts, and this file pins the ladder.
//
// No database: portalStage() is a pure function over four booleans, which is the
// whole point of having lifted it out of the handler.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { portalStage } from "../../api/read/portal-summary.mjs";

const NOTHING = {
  softPullComplete: false, callHeld: false, agreementSignedAt: null, paymentPosted: false
};

describe("portalStage", () => {
  test("a client who has only booked is before the call", () => {
    const s = portalStage(NOTHING);
    assert.equal(s.key, "booked");
    assert.equal(s.before_call, true);
  });

  test("the walk's own client is NOT before the call", () => {
    // Pulled, called, signed. This exact combination read "Your call is next".
    const s = portalStage({
      softPullComplete: true,
      callHeld: true,
      agreementSignedAt: "2026-09-03T18:51:07Z",
      paymentPosted: false
    });
    assert.equal(s.key, "agreement_signed");
    assert.equal(s.before_call, false);
    assert.equal(s.agreement_signed, true);
    assert.equal(s.payment_posted, false);
  });

  test("each fact moves the ladder one rung", () => {
    assert.equal(portalStage({ ...NOTHING, softPullComplete: true }).key, "soft_pull");
    assert.equal(portalStage({ ...NOTHING, callHeld: true }).key, "call_held");
    assert.equal(portalStage({ ...NOTHING, agreementSignedAt: "2026-09-03T00:00:00Z" }).key, "agreement_signed");
    assert.equal(portalStage({ ...NOTHING, paymentPosted: true }).key, "paid");
  });

  test("a fact out of order still counts", () => {
    // Somebody can pay before the pull lands, or sign before the call is logged.
    // Each fact is read on its own precisely so those people are not mis-staged.
    const s = portalStage({ ...NOTHING, paymentPosted: true });
    assert.equal(s.key, "paid");
    assert.equal(s.soft_pull_complete, false);
    assert.equal(s.call_held, false);
    assert.equal(s.before_call, false);
  });

  test("payment is the furthest rung and wins over everything under it", () => {
    const s = portalStage({
      softPullComplete: true, callHeld: true,
      agreementSignedAt: "2026-09-03T00:00:00Z", paymentPosted: true
    });
    assert.equal(s.key, "paid");
  });

  /* contract_signed_at, NOT agreement_signed_at — the second name is reserved for
     partners.agreement_signed_at, which is what stands between an unsigned partner
     and a payout, and partner-license-terms.test.mjs greps for it by name. */
  test("the signed date comes back, and is null when nothing is signed", () => {
    assert.equal(portalStage({ ...NOTHING, agreementSignedAt: "2026-09-03T18:51:07Z" })
      .contract_signed_at, "2026-09-03T18:51:07Z");
    assert.equal(portalStage(NOTHING).contract_signed_at, null);
  });

  test("every fact is a real boolean, never undefined", () => {
    // The screen tests these with === true, so a missing key must read false
    // rather than opening or closing something by accident.
    const s = portalStage({});
    for (const k of ["soft_pull_complete", "call_held", "agreement_signed", "payment_posted"]) {
      assert.equal(typeof s[k], "boolean", `${k} was not a boolean`);
    }
  });
});
