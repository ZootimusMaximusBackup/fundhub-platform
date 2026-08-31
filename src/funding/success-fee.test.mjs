import test from "node:test";
import assert from "node:assert/strict";
import {
  amountOrNull,
  successFeeCents,
  sumConfirmedApprovals,
  agreedFeePercent,
  resolveSuccessFee,
  NO_CONFIRMED_APPROVALS,
  NO_AGREED_FEE_PERCENT,
  NO_ROUND
} from "./success-fee.mjs";

const ROUND = "22222222-2222-4222-8222-222222222222";

function stubDb({ apps = [], sale = { sale_id: "sale-1", agreed_success_fee_percent: 10 } } = {}) {
  return {
    async query(sql) {
      if (/FROM funding_round_sales/i.test(sql)) return { rows: sale ? [sale] : [] };
      if (/FROM applications/i.test(sql)) return { rows: apps };
      return { rows: [] };
    }
  };
}

test("amountOrNull keeps unknown as unknown", () => {
  assert.equal(amountOrNull(null), null);
  assert.equal(amountOrNull(undefined), null);
  assert.equal(amountOrNull(""), null);
  assert.equal(amountOrNull("abc"), null);
  assert.equal(amountOrNull("450.10"), 450.1);
  assert.equal(amountOrNull(0), 0);
});

test("successFeeCents takes PERCENT UNITS — 10 means 10%", () => {
  assert.equal(successFeeCents(35000, 10), 350000, "$3,500.00 in cents");
  assert.equal(successFeeCents(25000, 12), 300000, "$3,000.00 in cents");
  // The factor-of-100 trap: 0.10 is a tenth of one percent, not ten percent.
  assert.equal(successFeeCents(35000, 0.1), 3500, "$35.00 — 0.1%, which is why the units matter");
});

test("successFeeCents refuses unknown instead of answering zero", () => {
  assert.equal(successFeeCents(null, 10), null);
  assert.equal(successFeeCents(35000, null), null);
  assert.equal(successFeeCents(0, 10), null);
  assert.equal(successFeeCents(35000, 0), null);
  assert.equal(successFeeCents(35000, 150), null);
});

test("the confirmed total is the sum of approvals that carry an amount", async () => {
  const db = stubDb({ apps: [{ approved_amount: "20000.00" }, { approved_amount: "15000.00" }] });
  assert.equal(await sumConfirmedApprovals(db, { fundingRoundId: ROUND }), 35000);
});

test("no approvals at all is null, not zero", async () => {
  const db = stubDb({ apps: [] });
  assert.equal(await sumConfirmedApprovals(db, { fundingRoundId: ROUND }), null);
});

test("the rate comes from the sale, in percent units", async () => {
  const db = stubDb({ sale: { sale_id: "s9", agreed_success_fee_percent: "12.5000" } });
  const r = await agreedFeePercent(db, { fundingRoundId: ROUND });
  assert.equal(r.feePercent, 12.5);
  assert.equal(r.saleId, "s9");
});

test("a sale with no agreed rate answers null — there is no default", async () => {
  const db = stubDb({ sale: { sale_id: "s9", agreed_success_fee_percent: null } });
  assert.equal((await agreedFeePercent(db, { fundingRoundId: ROUND })).feePercent, null);
});

test("a round with no linked sale answers null", async () => {
  const db = stubDb({ sale: null });
  const r = await agreedFeePercent(db, { fundingRoundId: ROUND });
  assert.equal(r.feePercent, null);
  assert.equal(r.saleId, null);
});

test("resolveSuccessFee answers the whole bill for a good round", async () => {
  const db = stubDb({ apps: [{ id: "a1", approved_amount: "20000.00" }, { id: "a2", approved_amount: "15000.00" }] });
  const fee = await resolveSuccessFee(db, { fundingRoundId: ROUND });
  assert.equal(fee.ok, true);
  assert.equal(fee.confirmedApprovedAmount, 35000);
  assert.equal(fee.feePercent, 10);
  assert.equal(fee.feeAmount, "3500.00");
  assert.equal(fee.saleId, "sale-1");
  assert.equal(fee.approvals.length, 2);
});

test("resolveSuccessFee names why it refuses, and every money field stays null", async () => {
  const noApps = await resolveSuccessFee(stubDb({ apps: [] }), { fundingRoundId: ROUND });
  assert.equal(noApps.ok, false);
  assert.equal(noApps.reason, NO_CONFIRMED_APPROVALS);
  assert.equal(noApps.feeAmount, null);
  assert.equal(noApps.confirmedApprovedAmount, null);

  const noRate = await resolveSuccessFee(
    stubDb({ apps: [{ id: "a1", approved_amount: "20000.00" }], sale: null }),
    { fundingRoundId: ROUND }
  );
  assert.equal(noRate.reason, NO_AGREED_FEE_PERCENT);
  assert.equal(noRate.feeAmount, null);
  assert.equal(noRate.confirmedApprovedAmount, 20000, "we know what was confirmed, just not the rate");

  const noRound = await resolveSuccessFee(stubDb(), {});
  assert.equal(noRound.reason, NO_ROUND);
  assert.equal(noRound.feeAmount, null);
});
