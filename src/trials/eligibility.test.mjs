// The pre-checkout gate.
//
// THE ORDERING IS THE FEATURE. Verification is asked BEFORE the pay button, and
// an unverified business is sold a HELD-START trial rather than seven days that
// FundHub cannot deliver. These tests fail if that ordering is ever inverted.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  decideEligibility, reconcileWithConnection, readMetaVerification,
  DECISION, ELIGIBILITY_QUESTIONS
} from "./eligibility.mjs";

const YES = { has_ad_account: true, business_verified: true, can_fund_ad_spend: true };

describe("decideEligibility", () => {
  test("all three yes → sell seven days", () => {
    const d = decideEligibility(YES);
    assert.equal(d.decision, DECISION.SELL);
    assert.equal(d.ok, true);
    assert.equal(d.heldStart, false);
    assert.deepEqual(d.blockers, []);
  });

  test("unverified business → HELD START, not a refusal and not seven days", () => {
    const d = decideEligibility({ ...YES, business_verified: false });
    assert.equal(d.decision, DECISION.HELD_START);
    assert.equal(d.ok, true);
    assert.equal(d.heldStart, true);
    assert.equal(d.priceApplies, true);
    // The refund promise has to be on the terms, in words.
    assert.ok(d.terms.some((t) => /refuses your verification within 30 days/i.test(t)));
    // And it must not promise a start date nobody can know.
    assert.ok(d.terms.some((t) => /cannot tell you how long Meta takes/i.test(t)));
  });

  test("no ad account → hold the sale", () => {
    const d = decideEligibility({ ...YES, has_ad_account: false });
    assert.equal(d.decision, DECISION.HOLD_SALE);
    assert.equal(d.ok, false);
    assert.equal(d.priceApplies, false);
    assert.ok(d.blockers.some((b) => b.key === "has_ad_account" && b.reason === "no_ad_account"));
  });

  test("no ad budget → hold the sale, and the $297 is said not to include spend", () => {
    const d = decideEligibility({ ...YES, can_fund_ad_spend: false });
    assert.equal(d.decision, DECISION.HOLD_SALE);
    const blocker = d.blockers.find((b) => b.key === "can_fund_ad_spend");
    assert.ok(/does not include ad spend/i.test(blocker.message));
  });

  /* AN UNANSWERED QUESTION IS NOT A "NO", AND IT IS CERTAINLY NOT A "YES".
     Selling a held-start trial to somebody who never told us anything is the
     failure this case exists to prevent. */
  test("unanswered verification holds the sale rather than assuming either way", () => {
    const d = decideEligibility({ has_ad_account: true, can_fund_ad_spend: true });
    assert.equal(d.decision, DECISION.HOLD_SALE);
    assert.ok(d.blockers.some((b) => b.key === "business_verified" && b.reason === "unanswered"));
  });

  test("an empty body holds the sale on all three", () => {
    const d = decideEligibility({});
    assert.equal(d.decision, DECISION.HOLD_SALE);
    assert.equal(d.blockers.length, 3);
  });

  test("string and camelCase answers are accepted", () => {
    assert.equal(
      decideEligibility({ hasAdAccount: "yes", businessVerified: "true", canFundAdSpend: 1 }).decision,
      DECISION.SELL
    );
  });

  test("no decision anywhere states a result", () => {
    for (const answers of [YES, { ...YES, business_verified: false }, {}]) {
      const d = decideEligibility(answers);
      const text = [d.headline, ...(d.terms || []), ...d.blockers.map((b) => b.message)].join(" ");
      assert.ok(!/\b\d+\s*(calls?|leads?|closes?)\b/i.test(text), `states a result count: ${text}`);
      assert.ok(!/average|typical|guarantee(d)? (approval|result)/i.test(text),
        `promises a result: ${text}`);
    }
  });
});

describe("ELIGIBILITY_QUESTIONS", () => {
  test("three questions, in the order the gate asks them", () => {
    assert.deepEqual(
      ELIGIBILITY_QUESTIONS.map((q) => q.key),
      ["has_ad_account", "business_verified", "can_fund_ad_spend"]
    );
  });

  test("every question says why it is asked and what happens on a no", () => {
    for (const q of ELIGIBILITY_QUESTIONS) {
      assert.ok(q.question && q.why && q.onNo, `question ${q.key} is incomplete`);
    }
  });
});

describe("reconcileWithConnection", () => {
  test("the platform's own 'approved' upgrades a held start to seven days", () => {
    const held = decideEligibility({ ...YES, business_verified: false });
    const out = reconcileWithConnection(held, { state: "approved" });
    assert.equal(out.decision, DECISION.SELL);
  });

  /* THE ASYMMETRY IS THE POINT. A form answer of "yes" never overrides a
     database that says rejected — that is the case where FundHub would sell
     days it cannot deliver. */
  test("a rejected verification downgrades a full sale to held start", () => {
    const sold = decideEligibility(YES);
    assert.equal(reconcileWithConnection(sold, { state: "rejected" }).decision, DECISION.HELD_START);
    assert.equal(reconcileWithConnection(sold, { state: "unverified" }).decision, DECISION.HELD_START);
    assert.equal(reconcileWithConnection(sold, { state: "submitted" }).decision, DECISION.HELD_START);
  });

  test("no connection row changes nothing — no row means unknown, not unverified", () => {
    const sold = decideEligibility(YES);
    assert.equal(reconcileWithConnection(sold, null).decision, DECISION.SELL);
  });
});

describe("readMetaVerification", () => {
  test("returns null without a partner rather than querying for everybody", async () => {
    let called = false;
    const db = { query: async () => { called = true; return { rows: [] }; } };
    assert.equal(await readMetaVerification(db, { orgId: "o" }), null);
    assert.equal(called, false);
  });

  test("scopes on org AND partner AND platform", async () => {
    let sql = "", params = null;
    const db = {
      query: async (q, p) => {
        sql = q; params = p;
        return { rows: [{ platform_verification_state: "approved", connection_state: "active" }] };
      }
    };
    const out = await readMetaVerification(db, { orgId: "org-1", partnerId: "p-1" });
    assert.equal(out.state, "approved");
    assert.match(sql, /org_id = \$1/);
    assert.match(sql, /partner_id = \$2/);
    assert.match(sql, /platform = 'meta'/);
    assert.deepEqual(params, ["org-1", "p-1"]);
  });
});
