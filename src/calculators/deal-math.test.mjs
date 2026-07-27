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

  // net cash = funding − fromProceeds ($22k), NOT funding − fee. The $3k down is
  // collected out-of-pocket, so the client still receives $228k (spec §1b Block 1).
  assert.equal(result.cashPosition.netCashToClient, 228000, 'netCash should be $228,000');
  assert.equal(result.cashPosition.fee.total, 25000, 'fee total should be $25,000');
  assert.equal(result.cashPosition.fee.paidDown, 3000, 'paidDown should be $3,000');
  assert.equal(result.cashPosition.fee.fromProceeds, 22000, 'fromProceeds should be $22,000');
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

test('downPayment >= fee clamps fromProceeds to 0', () => {
  const result = calcDeal({
    approvedFunding: 250000,
    feePct: 0.10, // fee = $25k
    downPayment: 30000, // exceeds fee
  });

  assert.equal(result.cashPosition.fee.paidDown, 25000, 'paidDown capped at fee total');
  assert.equal(result.cashPosition.fee.fromProceeds, 0, 'fromProceeds should be 0, not negative');
});

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
