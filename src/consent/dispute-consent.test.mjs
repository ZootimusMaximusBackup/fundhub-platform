// Who may be asked to authorize dispute letters — the whole owner rule, not
// half of it.
//
// Walk finding F35 (2026-09-03) was an Academy buyer being shown "Sign to
// authorize dispute letters". The first fix answered that by asking "is this a
// repair client", which shut the course buyer out and shut the FUNDING customer
// out with them — and a funding customer's own letter pack contains dispute
// work. The owner's words, same day: "It's only for repair and for the funding
// offer. If they're getting deliverables, meaning e-products and courses, they
// don't need to sign for shit."
//
// So every case below is one of three answers: repair yes, funding offer yes,
// everything else no. The trap case is the last group — a course buyer whose
// analyzer tier says FULL_FUNDING, which is why this gate reads the ENTITLEMENT
// and never the tier.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mayAuthorizeDisputes, FUNDING_OFFER_ENTITLEMENT_CODE } from "./dispute-consent.mjs";
import { REPAIR_ENTITLEMENT_CODE } from "../repair/on-repair-path.mjs";

/* Shaped like the two reads this module can make: the clients row for the tier,
   and v_client_entitlements for an active code. */
function fakeDb({ tier = null, codes = [], failEntitlements = false } = {}) {
  return {
    async query(sql, params) {
      if (/FROM clients/i.test(sql)) return { rows: [{ outcome_tier: tier }] };
      if (/v_client_entitlements/i.test(sql)) {
        if (failEntitlements) throw new Error("relation does not exist");
        return { rows: codes.includes(params[2]) ? [{ "?column?": 1 }] : [] };
      }
      throw new Error("unexpected query: " + String(sql).slice(0, 60));
    }
  };
}

const who = { orgId: "org-1", clientId: "cl-1" };

describe("mayAuthorizeDisputes", () => {
  test("the codes are the ones the product seed actually grants", () => {
    // db/migrations/180: card-stacking-dfy → funding-snapshot,
    // repair-bundle / consulting-package → metro2-letter-pack.
    assert.equal(FUNDING_OFFER_ENTITLEMENT_CODE, "funding-snapshot");
    assert.equal(REPAIR_ENTITLEMENT_CODE, "metro2-letter-pack");
  });

  test("a repair buyer may sign", async () => {
    const db = fakeDb({ tier: null, codes: [REPAIR_ENTITLEMENT_CODE] });
    assert.equal(await mayAuthorizeDisputes(db, who), true);
  });

  test("a REPAIR_ONLY client may sign before they have bought anything", async () => {
    const db = fakeDb({ tier: "REPAIR_ONLY", codes: [] });
    assert.equal(await mayAuthorizeDisputes(db, who), true);
  });

  test("THE FUNDING OFFER may sign — this is the half the first fix missed", async () => {
    const db = fakeDb({ tier: null, codes: [FUNDING_OFFER_ENTITLEMENT_CODE] });
    assert.equal(await mayAuthorizeDisputes(db, who), true);
  });

  test("an Academy buyer is refused", async () => {
    const db = fakeDb({ tier: null, codes: ["funding-mastery-course"] });
    assert.equal(await mayAuthorizeDisputes(db, who), false);
  });

  test("an Academy buyer whose PULL said FULL_FUNDING is still refused", async () => {
    /* THE WHOLE REASON THIS GATE READS THE OFFER AND NOT THE TIER. The walk's
       own client bought a course and had a credit pull, so the analyzer stamped
       a funding tier on them. Gating on the tier re-opens F35 exactly. */
    for (const tier of ["FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK"]) {
      const db = fakeDb({ tier, codes: ["funding-mastery-course"] });
      assert.equal(await mayAuthorizeDisputes(db, who), false, `tier ${tier} opened the door`);
    }
  });

  test("a Capital Blueprint (deliverables) buyer is refused", async () => {
    // "If they're getting deliverables, meaning e-products and courses, they
    // don't need to sign for shit." — owner, 2026-09-03.
    const db = fakeDb({ tier: "FULL_FUNDING", codes: ["credit-optimization-roadmap"] });
    assert.equal(await mayAuthorizeDisputes(db, who), false);
  });

  test("a soft-pull-only client is refused", async () => {
    const db = fakeDb({ tier: null, codes: ["credit-analysis-report"] });
    assert.equal(await mayAuthorizeDisputes(db, who), false);
  });

  test("a caller that already knows the repair answer is not asked twice", async () => {
    let clientReads = 0;
    const db = {
      async query(sql, params) {
        if (/FROM clients/i.test(sql)) { clientReads += 1; return { rows: [{ outcome_tier: null }] }; }
        if (/v_client_entitlements/i.test(sql)) {
          return { rows: params[2] === FUNDING_OFFER_ENTITLEMENT_CODE ? [{ x: 1 }] : [] };
        }
        throw new Error("unexpected query");
      }
    };
    assert.equal(await mayAuthorizeDisputes(db, { ...who, repairPath: false }), true);
    assert.equal(clientReads, 0, "the repair reads must not be repeated when the answer was handed in");
  });

  test("repairPath true short-circuits to yes", async () => {
    const db = { async query() { throw new Error("must not read anything"); } };
    assert.equal(await mayAuthorizeDisputes(db, { ...who, repairPath: true }), true);
  });

  test("it fails closed", async () => {
    const noDb = { async query() { throw new Error("db down"); } };
    assert.equal(await mayAuthorizeDisputes(noDb, who), false);
    assert.equal(await mayAuthorizeDisputes(fakeDb({ failEntitlements: true }), who), false);
    assert.equal(await mayAuthorizeDisputes(fakeDb({}), { orgId: "org-1" }), false);
    assert.equal(await mayAuthorizeDisputes(fakeDb({}), { clientId: "cl-1" }), false);
    assert.equal(await mayAuthorizeDisputes(fakeDb({}), {}), false);
  });
});
