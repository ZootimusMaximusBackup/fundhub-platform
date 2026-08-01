/**
 * Deal Funding Calculator (1a) — pure, dependency-free ESM module.
 * Answers: "How much can this contact actually access, and how should we allocate it?"
 *
 * Four output blocks (spec §1a):
 *   1. totalAvailableCredit  — sum of available headroom across all matched lenders
 *   2. allocation            — waterfall draw (lowest APR first) until requestedAmount is filled
 *   3. payMethodComparison   — lump sum vs minimum vs interest-only, cost of capital over horizons
 *   4. guardrail             — hard stop if a draw pushes utilization past the org threshold
 *
 * All math is deterministic. No LLM calls. Any missing required input → null-bearing output.
 */

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const round6 = (n) => (n == null ? null : Math.round(n * 1e6) / 1e6); // rates need precision

/* ───────────────────── the threshold, as a CALLER may set it ─────────────────
 *
 * THE DEFECT THIS EXISTS TO CLOSE. api/read/tradelines.mjs:65 read
 * `?utilization_threshold=` straight off the query string and handed
 * `Number(raw)` to calcFunding with no check of any kind. `Number("0.99")` is
 * 0.99 and nothing refused it, so any staff session could switch the hard stop
 * off from the address bar: at a 99% line, `causedBreach` is false for every
 * draw a real card can carry, `hardStop` comes back false, and the screen says
 * the deal is clear. The gate that exists to stop a closer wrecking the client's
 * NEXT funding round was one query parameter wide, it left no trace, and the
 * answer it produced looked exactly like an honest one.
 *
 * SO THE THRESHOLD IS VALIDATED IN ONE PLACE AND BOTH CALLERS USE IT. This
 * function is not in an http file on purpose — the number belongs to this
 * module, which is the only thing that acts on it, and a validator sitting next
 * to one of its two callers is a validator the other one forgets.
 *
 * THE BAND, AND WHY IT IS NARROWER THAN "ANY NUMBER". This value is a credit
 * utilization line: the point past which drawing more is expected to move a
 * score. Configured values in this business sit between 10% and 50% and the
 * effect the gate is about starts around 30%.
 *
 *   * ABOVE 50% is not a looser reading of the rule, it is a way of turning the
 *     rule off. Turning a guardrail off is a product decision that belongs in
 *     configuration where somebody signed for it (upsell_triggers, migration
 *     079, which ships every rule unset for exactly this reason) — never in a
 *     URL, and never invisibly.
 *   * BELOW 1% makes every draw a hard stop, which does not read as a strict
 *     policy, it reads as a broken screen.
 *
 * A value outside the band is REFUSED and named, not clamped. A clamped
 * threshold is a wrong number wearing a plausible face — the caller asked for
 * 0.99, got 0.50, and nothing on the answer says so. Same rule readApr() applies
 * to a rate it cannot read (src/tradelines/index.mjs:56).
 *
 * PERCENT UNITS ARE REFUSED RATHER THAN GUESSED. `30` meaning 30% and `30`
 * meaning 3000% are both readable from the same digits, and src/commissions/
 * money.mjs uses percent units (10 = 10%) while this module uses a fraction
 * (0.30). Two conventions already live in this repo, so a value above 1 gets a
 * sentence telling the caller which one this parameter speaks, instead of a
 * silent divide-by-100 that would make `0.30` and `30` mean the same thing and
 * `0.5` ambiguous forever.
 *
 * Returns { ok, value, reason } rather than throwing, so each caller shapes its
 * own refusal — same shape src/banking/cashflow.mjs project() uses for a fact it
 * cannot work with.
 */
export const UTILIZATION_THRESHOLD_MIN = 0.01;
export const UTILIZATION_THRESHOLD_MAX = 0.50;

/* One sentence per refusal, written once, so the endpoint and the read API
   cannot tell a caller two different stories about the same rejected number. */
export const UTILIZATION_THRESHOLD_REFUSALS = Object.freeze({
  absent: "no utilization threshold was supplied",
  not_a_number: "utilization_threshold must be a number",
  not_a_fraction:
    "utilization_threshold is a fraction, not a percentage — 0.30 means 30%",
  below_minimum:
    `utilization_threshold must be at least ${UTILIZATION_THRESHOLD_MIN} (${UTILIZATION_THRESHOLD_MIN * 100}%) — ` +
    "anything lower makes every draw a hard stop",
  above_maximum:
    `utilization_threshold must be at most ${UTILIZATION_THRESHOLD_MAX} (${UTILIZATION_THRESHOLD_MAX * 100}%) — ` +
    "a higher line switches the guardrail off, which is a configuration decision and not a request parameter"
});

export function parseUtilizationThreshold(raw) {
  const refuse = (reason) => ({ ok: false, value: null, reason });

  if (raw === null || raw === undefined) return refuse("absent");
  if (typeof raw === "string" && raw.trim() === "") return refuse("absent");
  // A boolean, an array or an object all survive Number() with a plausible
  // answer (true → 1, [] → 0) and none of them is a threshold anybody typed.
  if (typeof raw !== "number" && typeof raw !== "string") return refuse("not_a_number");

  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return refuse("not_a_number");
  if (n > 1) return refuse("not_a_fraction");
  if (n < UTILIZATION_THRESHOLD_MIN) return refuse("below_minimum");
  if (n > UTILIZATION_THRESHOLD_MAX) return refuse("above_maximum");

  // Six places, matching round6 above: the threshold is compared against a ratio
  // this module rounds to the same precision.
  return { ok: true, value: Math.round(n * 1e6) / 1e6, reason: null };
}

/** Available headroom on a single card, never negative. */
function headroom(card) {
  const limit = num(card?.creditLimit);
  const bal = num(card?.currentBalance) ?? 0;
  if (limit == null) return 0;
  return Math.max(0, limit - bal);
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} opts
 * @param {Array}  opts.cards               [{ lender, creditLimit, currentBalance, apr, promoApr?, promoExpiryMonth? }]
 * @param {number} opts.requestedAmount     amount the deal wants to draw (optional — allocation null if omitted)
 * @param {number} opts.utilizationThreshold default 0.30 (per-org configurable)
 * @param {number} opts.minPaymentPct        default 0.02, for the min-payment pay method
 * @param {number[]} opts.horizons           months to compare cost of capital over; default [12, 24, 36]
 */
export function calcFunding({
  cards = [],
  requestedAmount,
  utilizationThreshold = 0.30,
  minPaymentPct = 0.02,
  horizons = [12, 24, 36],
} = {}) {
  const clean = Array.isArray(cards) ? cards.filter((c) => c && num(c.creditLimit) != null) : [];

  // --- 1. Total available credit ---
  const totalAvailableCredit = round2(clean.reduce((sum, c) => sum + headroom(c), 0));

  // --- 2. Waterfall allocation (lowest APR first) ---
  const req = num(requestedAmount);
  let allocation = null;
  if (req != null) {
    // sort a COPY by effective APR ascending; stable-ish tiebreak by larger headroom first
    const ordered = [...clean].sort((a, b) => {
      const ra = num(a.apr) ?? Infinity;
      const rb = num(b.apr) ?? Infinity;
      if (ra !== rb) return ra - rb;
      return headroom(b) - headroom(a);
    });

    let remaining = Math.max(0, req);
    const draws = ordered.map((c) => {
      const avail = headroom(c);
      const draw = Math.min(avail, remaining);
      remaining = round2(remaining - draw);
      return {
        lender: c.lender ?? null,
        creditLimit: num(c.creditLimit),
        currentBalance: num(c.currentBalance) ?? 0,
        availableHeadroom: round2(avail),
        apr: num(c.apr),
        draw: round2(draw),
      };
    });

    const totalDrawn = round2(draws.reduce((s, d) => s + d.draw, 0));
    allocation = {
      requestedAmount: req,
      totalDrawn,
      shortfall: round2(Math.max(0, req - totalDrawn)), // >0 means can't fully fund
      fullyFunded: totalDrawn >= req - 0.005,
      draws,
    };
  }

  // --- 3. Pay-method comparison (on the drawn total, draw-weighted blended APR) ---
  let payMethodComparison = null;
  const drawnCards = allocation ? allocation.draws.filter((d) => d.draw > 0) : [];
  const drawTotal = allocation ? allocation.totalDrawn : 0;
  if (allocation && drawTotal > 0) {
    const weightedAprSum = drawnCards.reduce((s, d) => s + d.draw * (d.apr ?? 0), 0);
    const blendedApr = round6(weightedAprSum / drawTotal);
    payMethodComparison = {
      blendedApr,
      horizons: horizons.map((H) => payMethods(drawTotal, blendedApr, H, minPaymentPct)),
    };
  }

  // --- 4. Pre-approval guardrail ---
  // Measures the DELTA the draw causes, not the absolute post-draw utilization. A client
  // already above the threshold on existing balances alone (e.g. 38% before any draw) would
  // fail an absolute 30% gate forever, even at zero draw — that's a pre-existing condition,
  // not a reason to block THIS deal. So the HARD STOP fires only when the draw itself pushes
  // utilization across the threshold (was at/below, now above). An already-over card is
  // surfaced as a warning, and the marginal delta is always reported.
  let guardrail = null;
  if (allocation) {
    const perCard = allocation.draws.map((d) => {
      const before = d.creditLimit > 0 ? d.currentBalance / d.creditLimit : null;
      const after = d.creditLimit > 0 ? (d.currentBalance + d.draw) / d.creditLimit : null;
      const delta = before != null && after != null ? after - before : null;
      // The draw is the cause only if it crosses the line: at/below before, above after.
      const causedBreach = before != null && after != null && before <= utilizationThreshold && after > utilizationThreshold;
      const preExistingOver = before != null && before > utilizationThreshold;
      return {
        lender: d.lender,
        utilizationBefore: round2(before),
        utilizationAfter: round2(after),
        utilizationDelta: round2(delta),
        newUtilization: round2(after), // retained for back-compat
        causedBreach,
        preExistingOver,
        breaches: causedBreach, // hard-stop trigger is now the draw-caused crossing
      };
    });
    const totalLimit = allocation.draws.reduce((s, d) => s + d.creditLimit, 0);
    const totalBal = allocation.draws.reduce((s, d) => s + d.currentBalance, 0);
    const totalNewBal = allocation.draws.reduce((s, d) => s + d.currentBalance + d.draw, 0);
    const aggregateBefore = totalLimit > 0 ? totalBal / totalLimit : null;
    const aggregateUtil = totalLimit > 0 ? totalNewBal / totalLimit : null;
    const aggregateDelta = aggregateBefore != null && aggregateUtil != null ? aggregateUtil - aggregateBefore : null;
    const causedCards = perCard.filter((c) => c.causedBreach);
    const preExistingCards = perCard.filter((c) => c.preExistingOver);
    const aggregateCausedBreach =
      aggregateBefore != null && aggregateUtil != null && aggregateBefore <= utilizationThreshold && aggregateUtil > utilizationThreshold;
    const hardStop = causedCards.length > 0 || aggregateCausedBreach;
    guardrail = {
      threshold: utilizationThreshold,
      aggregateUtilizationBefore: round2(aggregateBefore),
      aggregateUtilization: round2(aggregateUtil),
      aggregateUtilizationDelta: round2(aggregateDelta),
      aggregateBreaches: aggregateCausedBreach,
      perCard,
      hardStop,
      message: hardStop
        ? `HARD STOP: this draw pushes ${aggregateCausedBreach ? `aggregate utilization across ${(utilizationThreshold * 100).toFixed(0)}% (to ${(aggregateUtil * 100).toFixed(1)}%)` : ''}` +
          `${aggregateCausedBreach && causedCards.length ? ' and ' : ''}` +
          `${causedCards.length ? `${causedCards.length} card(s) across ${(utilizationThreshold * 100).toFixed(0)}%` : ''}` +
          `. The draw itself is what triggers the score-drop threshold that kills the next funding round. Reduce the draw or restructure the allocation.`
        : preExistingCards.length
        ? `NOTE: ${preExistingCards.length} card(s) already above ${(utilizationThreshold * 100).toFixed(0)}% on existing balances before any draw — pre-existing, not caused by this deal. This draw adds ${(aggregateDelta * 100).toFixed(1)}pp aggregate.`
        : null,
    };
  }

  return { totalAvailableCredit, allocation, payMethodComparison, guardrail };
}

/**
 * Cost of capital for a drawn balance over `months` under three payment strategies.
 * Simple monthly-compounding model; principal/interest tracked per method.
 */
function payMethods(draw, apr, months, minPaymentPct) {
  const monthlyRate = apr / 12;

  // Lump sum: carry full balance, single payoff at horizon end. Interest = simple accrual.
  const lumpInterest = round2(draw * apr * (months / 12));

  // Interest-only: pay the accruing interest each month; principal untouched, still owed at end.
  const interestOnlyMonthly = round2(draw * monthlyRate);
  const interestOnlyTotalInterest = round2(interestOnlyMonthly * months);

  // Minimum payments: pay minPaymentPct of the current balance each month (declining).
  let balance = draw;
  let minTotalInterest = 0;
  let minTotalPaid = 0;
  for (let m = 0; m < months; m++) {
    const interest = balance * monthlyRate;
    balance += interest;
    const payment = Math.min(balance, balance * minPaymentPct);
    balance -= payment;
    minTotalInterest += interest;
    minTotalPaid += payment;
  }

  return {
    months,
    lumpSum: {
      monthlyPayment: null, // single payment at horizon end
      totalInterest: lumpInterest,
      totalPaid: round2(draw + lumpInterest),
      remainingBalance: 0,
    },
    interestOnly: {
      monthlyPayment: interestOnlyMonthly,
      totalInterest: interestOnlyTotalInterest,
      totalPaid: round2(interestOnlyTotalInterest + draw), // principal due at end
      remainingBalance: round2(draw),
    },
    minPayments: {
      monthlyPaymentMonth1: round2((draw + draw * monthlyRate) * minPaymentPct),
      totalInterest: round2(minTotalInterest),
      totalPaid: round2(minTotalPaid),
      remainingBalance: round2(balance),
    },
  };
}
