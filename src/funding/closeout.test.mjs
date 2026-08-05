import test from "node:test";
import assert from "node:assert/strict";
import { createFundingCloseout, DEFAULT_FEE_PERCENT } from "./closeout.mjs";

function stubDb({ apps = [], fundedAmount = 0, approvedAmount = null } = {}) {
  const calls = [];
  let closeoutId = "co-1";
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM funding_rounds/i.test(sql)) {
        return {
          rows: [{
            id: params[1],
            funded_amount: fundedAmount,
            approved_amount: approvedAmount,
            status: "funded"
          }]
        };
      }
      if (/FROM applications/i.test(sql)) {
        return { rows: apps };
      }
      if (/FROM funding_closeout/i.test(sql) && /SELECT \*/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO funding_closeout\b/i.test(sql)) {
        return {
          rows: [{
            id: closeoutId,
            org_id: params[0],
            funding_round_id: params[1],
            total_approved_amount: params[2],
            total_fee: params[3],
            balance_due: params[4],
            fee_percent: params[5],
            status: "open"
          }]
        };
      }
      if (/INSERT INTO funding_closeout_items/i.test(sql)) {
        return {
          rows: [{
            id: "item-" + params[2],
            funding_closeout_id: params[1],
            application_id: params[2],
            approved_amount: params[3],
            fee_amount: params[4]
          }]
        };
      }
      return { rows: [] };
    }
  };
}

test("createFundingCloseout computes 10% from the round funded_amount", async () => {
  assert.equal(DEFAULT_FEE_PERCENT, 0.1);
  const db = stubDb({
    fundedAmount: 50000,
    apps: [
      { id: "a1", approved_amount: 10000, lender_name: "Bank A", status: "Approved" },
      { id: "a2", approved_amount: 5000, lender_name: "Bank B", status: "Approved" }
    ]
  });
  const result = await createFundingCloseout(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fundingRoundId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.created, true);
  assert.equal(result.closeout.total_approved_amount, 50000, "fee basis is funded amount");
  assert.equal(result.closeout.total_fee, 5000);
  assert.equal(result.closeout.balance_due, 5000);
  assert.equal(result.items.length, 2);
  // Item fees are proportional shares of the funded-based total.
  assert.equal(result.items[0].fee_amount + result.items[1].fee_amount, 5000);
});

test("createFundingCloseout with zero Approved apps still bills 10% of funded", async () => {
  const db = stubDb({ fundedAmount: 50000, apps: [] });
  const result = await createFundingCloseout(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fundingRoundId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.closeout.total_approved_amount, 50000);
  assert.equal(result.closeout.total_fee, 5000, "must not silently bill $0");
  assert.equal(result.closeout.balance_due, 5000);
  assert.equal(result.items.length, 0);
  assert.equal(result.feeBasis, 50000);
});

test("createFundingCloseout with no funded amount yields zero fee", async () => {
  const db = stubDb({ fundedAmount: 0, apps: [
    { id: "a1", approved_amount: 10000, lender_name: "Bank A", status: "Approved" }
  ] });
  const result = await createFundingCloseout(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fundingRoundId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.closeout.total_fee, 0);
});
