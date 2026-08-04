import test from "node:test";
import assert from "node:assert/strict";
import { createFundingCloseout, DEFAULT_FEE_PERCENT } from "./closeout.mjs";

function stubDb(apps) {
  const calls = [];
  let closeoutId = "co-1";
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
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

test("createFundingCloseout computes 10% fee from Approved apps", async () => {
  assert.equal(DEFAULT_FEE_PERCENT, 0.1);
  const db = stubDb([
    { id: "a1", approved_amount: 10000, lender_name: "Bank A", status: "Approved" },
    { id: "a2", approved_amount: 5000, lender_name: "Bank B", status: "Approved" }
  ]);
  const result = await createFundingCloseout(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fundingRoundId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.created, true);
  assert.equal(result.closeout.total_approved_amount, 15000);
  assert.equal(result.closeout.total_fee, 1500);
  assert.equal(result.closeout.balance_due, 1500);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].fee_amount, 1000);
  assert.equal(result.items[1].fee_amount, 500);
});

test("createFundingCloseout with no approved apps still creates zero closeout", async () => {
  const db = stubDb([]);
  const result = await createFundingCloseout(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    fundingRoundId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.closeout.total_approved_amount, 0);
  assert.equal(result.closeout.total_fee, 0);
  assert.equal(result.items.length, 0);
});
