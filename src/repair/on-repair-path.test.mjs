// Who counts as a repair client — the rule that decides whether the portal may
// ask somebody to authorize dispute letters at all.
//
// The failure this pins is walk finding F35, 2026-09-03: an Academy buyer — a
// course, not credit repair — was shown "Sign to authorize dispute letters" and
// could sign it. Every case below is a client this must answer NO for, plus the
// two it must answer YES for.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { onRepairPath, REPAIR_ENTITLEMENT_CODE } from "./on-repair-path.mjs";

/* A db shaped like the two reads this module makes. `tier` answers the clients
   lookup; `codes` are the client's ACTIVE entitlement codes. */
function fakeDb({ tier = null, codes = [], failEntitlements = false } = {}) {
  return {
    async query(sql, params) {
      if (/FROM clients/i.test(sql)) return { rows: tier === undefined ? [] : [{ outcome_tier: tier }] };
      if (/v_client_entitlements/i.test(sql)) {
        if (failEntitlements) throw new Error("relation does not exist");
        return { rows: codes.includes(params[2]) ? [{ "?column?": 1 }] : [] };
      }
      throw new Error("unexpected query: " + String(sql).slice(0, 60));
    }
  };
}

const who = { orgId: "org-1", clientId: "cl-1" };

describe("onRepairPath", () => {
  test("an Academy buyer with no repair anything is refused", async () => {
    const db = fakeDb({ tier: "FULL_FUNDING", codes: ["funding-mastery-course"] });
    assert.equal(await onRepairPath(db, who), false);
  });

  test("a repair purchase says yes on the entitlement alone", async () => {
    const db = fakeDb({ tier: "FULL_FUNDING", codes: [REPAIR_ENTITLEMENT_CODE] });
    assert.equal(await onRepairPath(db, who), true);
  });

  test("REPAIR_ONLY says yes before anything has been bought", async () => {
    // The DIY letter path: the tier is set by the pull, the entitlement comes
    // later or never. src/workflows/ds-02-diy-letters.mjs refuses on the same tier.
    const db = fakeDb({ tier: "REPAIR_ONLY", codes: [] });
    assert.equal(await onRepairPath(db, who), true);
  });

  test("a funding tier is not a repair tier", async () => {
    for (const tier of ["FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK", "MANUAL_REVIEW", null]) {
      const db = fakeDb({ tier, codes: [] });
      assert.equal(await onRepairPath(db, who), false, `tier ${tier} opened the door`);
    }
  });

  test("a tier the caller already holds is not re-read", async () => {
    // The portal summary has the column in hand; a second SELECT for it would be
    // a query per page load for a value already on the row.
    let clientReads = 0;
    const db = {
      async query(sql, params) {
        if (/FROM clients/i.test(sql)) { clientReads++; return { rows: [] }; }
        return { rows: params[2] === REPAIR_ENTITLEMENT_CODE ? [{ ok: 1 }] : [] };
      }
    };
    assert.equal(await onRepairPath(db, { ...who, outcomeTier: "REPAIR_ONLY" }), true);
    assert.equal(clientReads, 0);
  });

  test("a database that will not answer fails CLOSED", async () => {
    const db = fakeDb({ tier: "FULL_FUNDING", codes: [], failEntitlements: true });
    assert.equal(await onRepairPath(db, who), false);
  });

  test("no org or no client is refused without a query", async () => {
    const noDb = { query() { throw new Error("must not reach the database"); } };
    assert.equal(await onRepairPath(noDb, { orgId: "org-1" }), false);
    assert.equal(await onRepairPath(noDb, { clientId: "cl-1" }), false);
    assert.equal(await onRepairPath(noDb, {}), false);
  });
});
