import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDeal, reconcileFee } from './deal-math.mjs';

// Worked example: $250k funding, 10% fee, $3k down, 12mo intro, 24.9% APR
test('worked example — cash position', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    feePct: 0.10,
    downPayment: 3000,
    introMonths: 12,
    postIntroApr: 0.249,
    minPaymentPct: 0.02,
  });

  // net cash = funding − fee − deposit. The deposit is money ON TOP of the fee
  // (011_sales.sql:82 makes them separate payment kinds; f-07-funding-locked
  // .mjs:74 bills the fee with no deposit offset), so the client walks away with
  // $250,000 − $25,000 − $3,000 = $222,000.
  //
  // THIS ASSERTION USED TO SAY $228,000, which is what the old
  // `max(0, fee - downPayment)` formula produced. That was the bug: it never
  // charged the $3k deposit AND credited it against the fee, a $6,000
  // overstatement on a $3,000 payment.
  assert.equal(result.cashPosition.netCashToClient, 222000, 'netCash should be $222,000');
  assert.equal(result.cashPosition.fee.total, 25000, 'fee total should be $25,000');
  assert.equal(result.cashPosition.deposit, 3000, 'deposit is reported separately');
  // feeFromProceeds defaults true, so the whole fee comes out of the funding and
  // none of it is paid out of pocket. The deposit does not enter this split.
  assert.equal(result.cashPosition.fee.fromProceeds, 25000, 'fromProceeds is the whole fee');
  assert.equal(result.cashPosition.fee.paidDown, 0, 'no part of the FEE was paid out of pocket');
});

/* THE TEST THAT WAS MISSING, AND THE ONE THAT WOULD HAVE CAUGHT IT.
   Every existing case pinned one deposit value, so nothing anywhere asserted
   which DIRECTION the deposit moves the answer. The old formula moved it the
   wrong way and no test disagreed. */
test('a larger deposit LOWERS net cash to the client', () => {
  const base = { approvedFunding: 250000, feePct: 0.10 };
  const small = calcDeal({ ...base, downPayment: 3000 });
  const large = calcDeal({ ...base, downPayment: 9000 });

  assert.ok(
    large.cashPosition.netCashToClient < small.cashPosition.netCashToClient,
    `paying more up front must leave the client with less cash in hand, got ` +
    `${large.cashPosition.netCashToClient} for a $9k deposit vs ` +
    `${small.cashPosition.netCashToClient} for a $3k deposit`
  );
  // And by exactly the extra deposit — the deposit is an outflow, not a discount.
  assert.equal(
    small.cashPosition.netCashToClient - large.cashPosition.netCashToClient, 6000,
    'a $6,000 larger deposit must lower net cash by exactly $6,000');
  // The fee is untouched by the deposit, matching what f-07 actually invoices.
  assert.equal(large.cashPosition.fee.total, small.cashPosition.fee.total,
    'the success fee does not shrink because a deposit was paid');
});

test('a deposit larger than the fee still reduces net cash — it is not clamped', () => {
  // The old formula clamped fromProceeds at zero, so every deposit above the fee
  // produced the SAME net cash: a $30k deposit and a $25k deposit both read
  // $250,000. Two different amounts of the client's money, one number.
  const atFee = calcDeal({ approvedFunding: 250000, feePct: 0.10, downPayment: 25000 });
  const overFee = calcDeal({ approvedFunding: 250000, feePct: 0.10, downPayment: 30000 });

  assert.equal(atFee.cashPosition.netCashToClient, 200000);
  assert.equal(overFee.cashPosition.netCashToClient, 195000,
    'a deposit above the fee keeps reducing net cash; there is nothing to clamp');
});

test('feeFromProceeds:false moves the fee out of the proceeds but not off the bill', () => {
  const out = calcDeal({
    approvedFunding: 250000, feePct: 0.10, downPayment: 3000, feeFromProceeds: false
  });
  // Same total cost to the client — the flag says where the fee is paid FROM,
  // not whether it is owed.
  assert.equal(out.cashPosition.netCashToClient, 222000);
  assert.equal(out.cashPosition.fee.fromProceeds, 0);
  assert.equal(out.cashPosition.fee.paidDown, 25000, 'the whole fee is out of pocket');
});

test('worked example — intro schedule month 1', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    feePct: 0.10,
    downPayment: 3000,
    introMonths: 12,
    postIntroApr: 0.249,
    minPaymentPct: 0.02,
  });

  const intro = result.monthly.intro;
  assert.equal(intro.month1Payment, 5000, 'month-1 payment = 250000 * 0.02 = $5,000');
  assert.ok(intro.balanceAtIntroExpiry > 190000 && intro.balanceAtIntroExpiry < 200000,
    `balanceAtIntroExpiry should be ~$195k, got ${intro.balanceAtIntroExpiry}`);
});

test('worked example — cliff triggers', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    feePct: 0.10,
    downPayment: 3000,
    introMonths: 12,
    postIntroApr: 0.249,
    minPaymentPct: 0.02,
  });

  const cliff = result.cliff;
  assert.ok(cliff, 'cliff object must exist');
  // At 24.9% APR: monthly rate = 0.249/12 = 0.02075
  // balanceAtExpiry * 0.02075 vs balanceAtExpiry * 0.02 → interest > minPayment → cliff triggered
  assert.equal(cliff.triggered, true, 'cliff must trigger: postIntroApr/12=2.075% > minPaymentPct=2%');
  assert.ok(cliff.interest > cliff.minPayment, 'interest must exceed minPayment');
  assert.ok(typeof cliff.message === 'string' && cliff.message.length > 0, 'cliff message must be present');
});

test('blank amort fields → amort.monthlyPayment is null', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    // amortApr and amortTermMonths intentionally omitted
  });

  assert.equal(result.monthly.amort.monthlyPayment, null, 'monthlyPayment must be null when amort inputs missing');
  assert.equal(result.monthly.amort.amortApr, null);
  assert.equal(result.monthly.amort.amortTermMonths, null);
});

test('feeDollar override recalculates feePct', () => {
  const fee = reconcileFee({ approvedFunding: 250000, feeDollar: 30000 });
  assert.equal(fee.feeDollar, 30000);
  assert.ok(Math.abs(fee.feePct - 0.12) < 0.0001, `feePct should be 0.12, got ${fee.feePct}`);
});

test('feeDollar override flows through calcDeal', () => {
  const result = calcDeal({ approvedFunding: 250000, feeDollar: 30000, downPayment: 0 });
  assert.equal(result.cashPosition.fee.total, 30000);
  assert.equal(result.cashPosition.netCashToClient, 220000);
});

/* REMOVED: 'downPayment >= fee clamps fromProceeds to 0'.
   That test asserted the defect. It required a $30k deposit against a $25k fee
   to report fromProceeds:0 and paidDown:$25k — i.e. the deposit had swallowed
   the entire fee — which is the "deposit credits the fee" reading that
   f-07-funding-locked.mjs:74 and 011_sales.sql:82 both contradict. The clamp it
   tested no longer exists because there is nothing to clamp: the deposit and
   the fee are independent amounts and neither can drive the other negative.
   Its replacement is 'a deposit larger than the fee still reduces net cash'
   above, which pins the behaviour that is actually correct. */

test('zero funding → netCash = 0, no null crash', () => {
  const result = calcDeal({ approvedFunding: 0, feePct: 0.10 });
  assert.equal(result.cashPosition.netCashToClient, 0);
  assert.equal(result.cashPosition.fee.total, 0);
});

test('missing approvedFunding → all outputs null', () => {
  const result = calcDeal({});
  assert.equal(result.cashPosition.netCashToClient, null);
  assert.equal(result.monthly, null);
  assert.equal(result.cliff, null);
});

test('amort section calculates when inputs provided', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    pctOn0Intro: 0.5,   // $125k intro, $125k amort
    amortApr: 0.12,
    amortTermMonths: 60,
  });

  assert.ok(result.monthly.amort.monthlyPayment > 0, 'should have a positive monthly payment');
  // 125k at 12% / 60mo → ~$2,779
  assert.ok(result.monthly.amort.monthlyPayment > 2700 && result.monthly.amort.monthlyPayment < 2850,
    `amort payment ~$2,779, got ${result.monthly.amort.monthlyPayment}`);
});

test('cliff does NOT trigger when APR/12 < minPaymentPct', () => {
  // postIntroApr = 0.18 → monthly rate = 1.5% < minPaymentPct 2%
  const result = calcDeal({
    approvedFunding: 100000,
    postIntroApr: 0.18,
    minPaymentPct: 0.02,
  });

  assert.equal(result.cliff.triggered, false, 'cliff should not trigger when interest < min payment');
});
