import test from "node:test";
import assert from "node:assert/strict";
import { createFundingCloseout, createFundingCloseoutSafe, money } from "./closeout.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const ROUND = "22222222-2222-4222-8222-222222222222";

/* The stub answers the four reads createFundingCloseout makes, in the shape the
   real SQL returns them. `apps` is what the CONFIRMED-approvals query returns —
   the query itself filters out Approved rows with no amount, so a row in this
   list is already a confirmed approval. */
function stubDb({ apps = [], fundedAmount = 0, approvedAmount = null, agreedPercent = 10, linkedSale = "sale-1" } = {}) {
  const calls = [];
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
      if (/FROM funding_round_sales/i.test(sql)) {
        return {
          rows: linkedSale
            ? [{ sale_id: linkedSale, agreed_success_fee_percent: agreedPercent }]
            : []
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
            id: "co-1",
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

test("money(null) is unknown, not a billable zero", () => {
  assert.equal(money(null), null);
  assert.equal(money(undefined), null);
  assert.equal(money(""), null);
  assert.equal(money("not a number"), null);
  // Real amounts still round to cents.
  assert.equal(money(0), 0);
  assert.equal(money("450.104"), 450.1);
  assert.equal(money(35000), 35000);
});

test("the fee is 10% of the confirmed approved total, not the funded amount", async () => {
  const db = stubDb({
    // Funded for far more than was ever confirmed. Under the 2026-08-30
    // decision the funded number is not the basis and must not leak in.
    fundedAmount: 50000,
    apps: [
      { id: "a1", approved_amount: 20000, lender_name: "Bank A", status: "Approved" },
      { id: "a2", approved_amount: 15000, lender_name: "Bank B", status: "Approved" }
    ]
  });
  const result = await createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND });

  assert.equal(result.created, true);
  assert.equal(Number(result.closeout.total_approved_amount), 35000, "basis is the confirmed approvals");
  assert.equal(Number(result.closeout.total_fee), 3500);
  assert.equal(Number(result.closeout.balance_due), 3500);
  assert.equal(result.feeBasis, 35000);
  assert.equal(result.items.length, 2);
  // Item fees are proportional shares and must sum to the total exactly.
  assert.equal(
    result.items.reduce((s, i) => s + Number(i.fee_amount), 0),
    3500
  );
});

test("the column stores the rate as a fraction while the argument is percent units", async () => {
  const db = stubDb({
    agreedPercent: 12,
    apps: [{ id: "a1", approved_amount: 25000, lender_name: "Bank A", status: "Approved" }]
  });
  const result = await createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND });
  assert.equal(Number(result.closeout.total_fee), 3000, "25000 at 12% is 3000, not 300 and not 3500");
  assert.equal(Number(result.closeout.fee_percent), 0.12);
  assert.equal(result.feePercent, 12);
});

test("an explicit rate is still percent units", async () => {
  const db = stubDb({
    agreedPercent: 10,
    apps: [{ id: "a1", approved_amount: 10000, lender_name: "Bank A", status: "Approved" }]
  });
  const result = await createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND, feePercentUnits: 15 });
  assert.equal(Number(result.closeout.total_fee), 1500);
  assert.equal(Number(result.closeout.fee_percent), 0.15);
});

test("no confirmed approvals refuses with a named reason — it does not bill $0", async () => {
  const db = stubDb({ fundedAmount: 50000, apps: [] });
  await assert.rejects(
    () => createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND }),
    (err) => err.code === "closeout_no_confirmed_approvals"
  );
  const written = db.calls.filter((c) => /INSERT INTO funding_closeout/i.test(c.sql));
  assert.equal(written.length, 0, "a round with nothing confirmed must write no closeout row at all");
});

test("no agreed fee percent refuses with a named reason", async () => {
  const db = stubDb({
    linkedSale: null,
    apps: [{ id: "a1", approved_amount: 20000, lender_name: "Bank A", status: "Approved" }]
  });
  await assert.rejects(
    () => createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND }),
    (err) => err.code === "closeout_no_fee_percent"
  );
});

test("a sale with a NULL agreed percent refuses too — no hardcoded 10%", async () => {
  const db = stubDb({
    agreedPercent: null,
    apps: [{ id: "a1", approved_amount: 20000, lender_name: "Bank A", status: "Approved" }]
  });
  await assert.rejects(
    () => createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND }),
    (err) => err.code === "closeout_no_fee_percent"
  );
});

test("the safe wrapper hands the named reason back instead of throwing", async () => {
  const db = stubDb({ fundedAmount: 50000, apps: [] });
  const res = await createFundingCloseoutSafe(db, { orgId: ORG, fundingRoundId: ROUND });
  assert.equal(res.closeout, null);
  assert.equal(res.created, false);
  assert.equal(res.error, "closeout_no_confirmed_approvals");
});

test("a funded round with confirmed approvals bills even when funded_amount is missing", async () => {
  // The reverse of the old trap: the basis no longer depends on funded_amount.
  const db = stubDb({
    fundedAmount: null,
    apps: [{ id: "a1", approved_amount: 40000, lender_name: "Bank A", status: "Approved" }]
  });
  const result = await createFundingCloseout(db, { orgId: ORG, fundingRoundId: ROUND });
  assert.equal(Number(result.closeout.total_fee), 4000);
});
