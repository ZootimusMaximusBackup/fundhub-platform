/**
 * Deal Math Calculator — pure, dependency-free ESM module.
 * Answers: "Given approved funding, fee, and down payment, what's the monthly obligation?"
 */

/**
 * Reconcile feePct ↔ feeDollar. Pass one or both; the last explicit one wins.
 * If feeDollar is provided, it takes precedence and feePct is back-calculated.
 * If only feePct is provided, feeDollar is derived from approvedFunding.
 * Returns {feePct, feeDollar} — both always present if approvedFunding is given.
 */
export function reconcileFee({ approvedFunding, feePct = 0.10, feeDollar } = {}) {
  if (approvedFunding == null || approvedFunding === '') {
    return { feePct: null, feeDollar: null };
  }
  if (feeDollar != null && feeDollar !== '') {
    return {
      feeDollar,
      feePct: approvedFunding > 0 ? feeDollar / approvedFunding : null,
    };
  }
  return {
    feePct,
    feeDollar: approvedFunding * feePct,
  };
}

/**
 * Main calculator. All inputs optional except approvedFunding.
 * Any output that depends on a missing required input is null.
 */
export function calcDeal({
  approvedFunding,
  feePct = 0.10,
  feeDollar: feeDollarInput,
  downPayment = 0,
  feeFromProceeds = true,
  pctOn0Intro = 1.0,
  introMonths = 12,
  postIntroApr = 0.249,
  minPaymentPct = 0.02,
  amortApr,
  amortTermMonths,
} = {}) {
  const missing = approvedFunding == null || approvedFunding === '';

  // --- 1. Fee reconciliation ---
  const { feeDollar } = reconcileFee({
    approvedFunding: missing ? null : approvedFunding,
    feePct,
    feeDollar: feeDollarInput,
  });

  // --- 2. Cash position ---
  //
  // *** THE DEPOSIT IS MONEY ON TOP OF THE FEE, NOT A CREDIT AGAINST IT. ***
  //
  // THE DEFECT THIS REPLACES. This block used to read
  //     fromProceeds  = max(0, feeDollar - downPayment)
  //     netCashToClient = approvedFunding - fromProceeds
  // which treats the deposit as prepayment of the success fee — every dollar of
  // deposit cancelled a dollar of fee, so the number on the screen went UP as
  // the client paid MORE. Two places in this repository say that is wrong, and
  // they are the two that actually move money:
  //
  //   1. src/workflows/f-07-funding-locked.mjs:74 is the billing path. It
  //      invoices the success fee as `approvedAmount * feePercent / 100` with NO
  //      deposit term anywhere in the expression. Whatever the client paid at
  //      signature, the full success fee is still billed.
  //   2. db/migrations/011_sales.sql:82 makes `deposit` and `success_fee`
  //      separate, co-existing values of `sale_payments.kind` — the front end
  //      and the back end. Two payment kinds on one sale are two payments, not
  //      one payment counted twice.
  //
  // So the deposit is a SECOND outflow from the client, and the corrected
  // reading is: money in, less the fee, less the deposit.
  //
  // WHAT IT COST. On the worked example in deal-math.test.mjs — $250,000
  // approved, 10% fee, $3,000 down — the old formula returned $228,000 and the
  // true figure is $222,000. That is $6,000 of overstatement on a $3,000
  // deposit, because the deposit was double-counted: never charged, and then
  // credited. A closer reading that number off the screen promises a client
  // six thousand dollars they will not receive.
  //
  // feeFromProceeds NO LONGER MOVES netCashToClient, AND THAT IS CORRECT. The
  // money leaves the client either way; the flag only says WHERE it leaves
  // from. A fee netted out of the funding and a fee wired separately are the
  // same cost to the person paying it, so the flag now shapes the `fee`
  // breakdown (which portion comes out of the proceeds vs. out of pocket) and
  // nothing else. Anything that made the headline cash number depend on the
  // plumbing rather than on the total would be a number nobody can stand
  // behind.
  const fromProceeds = missing ? null : (feeFromProceeds ? feeDollar : 0);
  const cashPosition = missing
    ? { netCashToClient: null, fee: null, deposit: null }
    : {
        netCashToClient: approvedFunding - feeDollar - downPayment,
        // Reported alongside the net figure so a screen can show the two
        // deductions separately rather than a single unexplained difference.
        deposit: downPayment,
        fee: {
          total: feeDollar,
          // The out-of-pocket portion of the FEE. It is not the deposit and it
          // is never reduced by the deposit — see above.
          paidDown: feeDollar - fromProceeds,
          fromProceeds,
        },
      };

  // --- 3. Monthly obligation ---
  const fundingAmount = missing ? null : approvedFunding * pctOn0Intro;

  let introSchedule = null;
  let balanceAtIntroExpiry = null;
  let postIntro = null;
  let cliff = null;

  if (!missing) {
    // Month-by-month intro schedule
    const schedule = [];
    let balance = fundingAmount;
    for (let m = 1; m <= introMonths; m++) {
      const payment = balance * minPaymentPct;
      schedule.push({ month: m, openingBalance: balance, payment: round2(payment) });
      balance = balance - payment;
    }
    balanceAtIntroExpiry = round2(balance);

    introSchedule = {
      month1Payment: schedule[0]?.payment ?? null,
      note: 'Minimum payment steps down each month as balance declines.',
      schedule,
      balanceAtIntroExpiry,
    };

    // Post-intro
    const interestOnlyMonthly = round2(balanceAtIntroExpiry * (postIntroApr / 12));
    postIntro = { interestOnlyMonthly };

    // Cliff detection
    const minPaymentAtExpiry = round2(balanceAtIntroExpiry * minPaymentPct);
    if (interestOnlyMonthly > minPaymentAtExpiry) {
      cliff = {
        triggered: true,
        interest: interestOnlyMonthly,
        minPayment: minPaymentAtExpiry,
        message:
          `Post-intro interest ($${interestOnlyMonthly.toLocaleString()}/mo) exceeds the minimum ` +
          `payment ($${minPaymentAtExpiry.toLocaleString()}/mo). Balance will grow unless ` +
          `refinanced or paid down before month ${introMonths + 1}.`,
      };
    } else {
      cliff = {
        triggered: false,
        interest: interestOnlyMonthly,
        minPayment: minPaymentAtExpiry,
        message: null,
      };
    }
  }

  // --- 4. Amortization (non-intro portion) ---
  const amortFundingAmount = missing ? null : approvedFunding * (1 - pctOn0Intro);
  let amort = null;
  if (!missing) {
    const hasAmortInputs =
      amortApr != null && amortApr !== '' &&
      amortTermMonths != null && amortTermMonths !== '';
    if (hasAmortInputs) {
      const monthlyRate = amortApr / 12;
      const payment =
        monthlyRate === 0
          ? amortFundingAmount / amortTermMonths
          : (amortFundingAmount * monthlyRate * Math.pow(1 + monthlyRate, amortTermMonths)) /
            (Math.pow(1 + monthlyRate, amortTermMonths) - 1);
      amort = {
        fundingAmount: amortFundingAmount,
        monthlyPayment: round2(payment),
        amortApr,
        amortTermMonths,
      };
    } else {
      amort = {
        fundingAmount: amortFundingAmount,
        monthlyPayment: null,
        amortApr: null,
        amortTermMonths: null,
      };
    }
  }

  return {
    cashPosition,
    monthly: missing
      ? null
      : {
          intro: introSchedule,
          postIntro,
          amort,
        },
    cliff,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
