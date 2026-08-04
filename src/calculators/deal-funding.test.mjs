import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcFunding } from './deal-funding.mjs';

const CARDS = [
  { lender: 'Chase',   creditLimit: 20000, currentBalance: 2000, apr: 0.2499 }, // headroom 18k
  { lender: 'Amex',    creditLimit: 15000, currentBalance: 0,    apr: 0.1899 }, // headroom 15k, lowest APR
  { lender: 'Capital', creditLimit: 10000, currentBalance: 5000, apr: 0.2799 }, // headroom 5k, highest APR
];

test('total available credit sums headroom, never negative', () => {
  const r = calcFunding({ cards: CARDS });
  // 18000 + 15000 + 5000
  assert.equal(r.totalAvailableCredit, 38000);
});

test('over-limit balance contributes 0 headroom, not negative', () => {
  const r = calcFunding({ cards: [{ lender: 'X', creditLimit: 5000, currentBalance: 8000, apr: 0.2 }] });
  assert.equal(r.totalAvailableCredit, 0);
});

test('waterfall draws lowest APR first', () => {
  const r = calcFunding({ cards: CARDS, requestedAmount: 20000 });
  const byLender = Object.fromEntries(r.allocation.draws.map((d) => [d.lender, d.draw]));
  // Amex (18.99%) 15k fills first, then Chase (24.99%) 5k → 20k. Capital untouched.
  assert.equal(byLender.Amex, 15000);
  assert.equal(byLender.Chase, 5000);
  assert.equal(byLender.Capital, 0);
  assert.equal(r.allocation.totalDrawn, 20000);
  assert.equal(r.allocation.fullyFunded, true);
  assert.equal(r.allocation.shortfall, 0);
});

test('shortfall reported when request exceeds available', () => {
  const r = calcFunding({ cards: CARDS, requestedAmount: 50000 });
  assert.equal(r.allocation.totalDrawn, 38000);
  assert.equal(r.allocation.shortfall, 12000);
  assert.equal(r.allocation.fullyFunded, false);
});

test('no requestedAmount → allocation null, but total still computed', () => {
  const r = calcFunding({ cards: CARDS });
  assert.equal(r.allocation, null);
  assert.equal(r.payMethodComparison, null);
  assert.equal(r.guardrail, null);
  assert.equal(r.totalAvailableCredit, 38000);
});

test('pay-method comparison: interest-only leaves principal, min pays some down', () => {
  const r = calcFunding({ cards: CARDS, requestedAmount: 20000 });
  const h12 = r.payMethodComparison.horizons.find((h) => h.months === 12);
  assert.equal(h12.interestOnly.remainingBalance, 20000, 'interest-only keeps full principal');
  assert.equal(h12.lumpSum.remainingBalance, 0, 'lump sum clears balance');
  assert.ok(h12.minPayments.remainingBalance < 20000, 'min payments reduce balance');
  assert.ok(h12.minPayments.remainingBalance > 0, 'min payments do not clear in 12mo');
  // blended APR is draw-weighted: (15000*.1899 + 5000*.2499)/20000 = 0.2049
  assert.ok(Math.abs(r.payMethodComparison.blendedApr - 0.2049) < 0.0001, `blended got ${r.payMethodComparison.blendedApr}`);
});

test('lump-sum interest = draw * blendedApr * years', () => {
  const r = calcFunding({ cards: CARDS, requestedAmount: 20000 });
  const h24 = r.payMethodComparison.horizons.find((h) => h.months === 24);
  // 20000 * 0.2049 * 2 = 8196
  assert.ok(Math.abs(h24.lumpSum.totalInterest - 8196) < 1, `got ${h24.lumpSum.totalInterest}`);
});

test('guardrail hard-stops when a draw pushes a card over threshold', () => {
  // Small limit, big draw → utilization spikes
  const r = calcFunding({
    cards: [{ lender: 'Tight', creditLimit: 10000, currentBalance: 1000, apr: 0.2 }],
    requestedAmount: 9000,
    utilizationThreshold: 0.30,
  });
  assert.equal(r.guardrail.hardStop, true);
  assert.equal(r.guardrail.perCard[0].breaches, true);
  // (1000 + 9000) / 10000 = 1.0
  assert.equal(r.guardrail.perCard[0].newUtilization, 1);
  assert.ok(r.guardrail.message.includes('HARD STOP'));
});

test('guardrail passes when draw stays under threshold', () => {
  const r = calcFunding({
    cards: [{ lender: 'Roomy', creditLimit: 100000, currentBalance: 0, apr: 0.2 }],
    requestedAmount: 20000, // 20% util
    utilizationThreshold: 0.30,
  });
  assert.equal(r.guardrail.hardStop, false);
  assert.equal(r.guardrail.aggregateUtilization, 0.2);
  assert.equal(r.guardrail.message, null);
});

test('configurable threshold changes the verdict', () => {
  const base = { cards: [{ lender: 'A', creditLimit: 10000, currentBalance: 0, apr: 0.2 }], requestedAmount: 2500 };
  assert.equal(calcFunding({ ...base, utilizationThreshold: 0.30 }).guardrail.hardStop, false); // 25% < 30%
  assert.equal(calcFunding({ ...base, utilizationThreshold: 0.20 }).guardrail.hardStop, true);  // 25% > 20%
});

test('pre-existing over threshold does NOT hard-stop; reports it as a note (Priya case)', () => {
  // 38% util on existing balance alone, threshold 30%. A small draw must NOT hard-stop,
  // because the over-threshold condition pre-dates this deal.
  const r = calcFunding({
    cards: [{ lender: 'Priya', creditLimit: 10000, currentBalance: 3800, apr: 0.2 }], // 38% before
    requestedAmount: 500, // 43% after — still over, but the draw didn't CAUSE the crossing
    utilizationThreshold: 0.30,
  });
  const card = r.guardrail.perCard[0];
  assert.equal(card.utilizationBefore, 0.38);
  assert.equal(card.preExistingOver, true, 'flagged pre-existing');
  assert.equal(card.causedBreach, false, 'draw did not cause the crossing');
  assert.equal(r.guardrail.hardStop, false, 'must NOT hard-stop on a pre-existing condition');
  assert.ok(r.guardrail.message && r.guardrail.message.startsWith('NOTE:'), 'surfaced as a note');
});

test('guardrail reports the marginal delta the draw causes', () => {
  const r = calcFunding({
    cards: [{ lender: 'X', creditLimit: 10000, currentBalance: 1000, apr: 0.2 }], // 10% before
    requestedAmount: 1500, // +15pp → 25% after
    utilizationThreshold: 0.30,
  });
  const card = r.guardrail.perCard[0];
  assert.equal(card.utilizationBefore, 0.1);
  assert.equal(card.utilizationAfter, 0.25);
  assert.equal(card.utilizationDelta, 0.15, 'draw adds 15 percentage points');
  assert.equal(r.guardrail.hardStop, false, '25% never crosses 30%');
});

test('empty cards → 0 available, no crash', () => {
  const r = calcFunding({ cards: [], requestedAmount: 5000 });
  assert.equal(r.totalAvailableCredit, 0);
  assert.equal(r.allocation.totalDrawn, 0);
  assert.equal(r.allocation.shortfall, 5000);
  assert.equal(r.payMethodComparison, null); // nothing drawn
});

test('lenderMatchCount is null when lenders are omitted — never invented', () => {
  const r = calcFunding({ cards: CARDS });
  assert.equal(r.lenderMatchCount, null);
  assert.equal(r.lenderMatches, null);
});

test('lenderMatchCount reads the real lenders list when provided', () => {
  const r = calcFunding({
    cards: CARDS,
    lenders: [
      { id: '1', name: 'Fit', lender_table: 'OnlineBizCC', active: true, priority_tier: 1, bureaus_pulled: 'EQ', eligible_states: 'AZ' },
      { id: '2', name: 'Hot', lender_table: 'OnlineBizCC', active: true, priority_tier: 1, bureaus_pulled: 'EX', eligible_states: 'AZ' }
    ],
    clientState: 'AZ',
    inquiryLog: [{ bureau: 'EX', status: 'open' }]
  });
  assert.equal(r.lenderMatchCount, 1);
  assert.equal(r.lenderMatches[0].name, 'Fit');
});
