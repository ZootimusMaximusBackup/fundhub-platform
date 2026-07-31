// Finance OS — the seven-row grid, computed once, server-side.
//
// WHY THIS IS A MODULE AND NOT BROWSER JS. `closer-dashboard.html` already
// reimplements a funding waterfall in inline JavaScript against sample rows, and
// `api/read/tradelines.mjs` was written specifically so "the screen renders one
// consistent answer rather than reimplementing the waterfall in browser JS".
// Same rule here: the seven numbers are computed in one place, tested without a
// browser, and shipped to the page already formed. A second implementation in a
// <script> block is a second answer that goes stale.
//
// TRADELINES ONLY. Every row is derived from the `tradelines` table and nothing
// else — no bank data, no liabilities, no subscriptions. Those tables belong to
// other builds that are running in parallel and are not on `main`. A grid that
// silently mixed in a half-landed source would be worse than one that says what
// it is: `source: "tradelines"` is on the response, and the screen prints it.
//
// THE HARD PART IS NOT THE ARITHMETIC, IT IS THE HOLES.
//
// A bureau file that omits a credit limit produces a tradeline with
// `credit_limit_cents = NULL`, and `src/tradelines/index.mjs` is emphatic that
// this must stay NULL rather than become a guess. So a "total credit limit"
// across twenty cards where three report no limit is NOT a total — it is a
// partial sum, and rendering it as a total is the exact species of confident
// wrongness this repo keeps finding (a mint "live" banner over a number nobody
// can stand behind).
//
// Every row therefore carries a `basis`: how many lines it counted, and how many
// it could not. A row whose basis has `unknown > 0` is a floor, not a figure,
// and `partial: true` says so. A row with NO usable input at all is `value:
// null` — never 0. "Nobody has pulled this client yet" and "this client has zero
// available credit" are opposite facts and must not share a rendering.
//
// Pure. No I/O, no clock, no randomness — so the rules above are unit-testable
// without Postgres, which is the only reason they can be trusted.

import { fromCents } from "../commissions/money.mjs";

/* Installment lines are excluded from every credit row, matching
   toCalculatorCards() in src/tradelines/index.mjs: you cannot draw against an
   auto loan, and including one inflates Total Available Credit — the single
   number a closer says out loud on a call. Closed lines are excluded for the
   same reason: a closed card has no headroom. */
const DRAWABLE = (r) => r && !r.closed_at && r.kind !== "installment";

/* pg returns bigint as a string, and numeric as a string. Anything that is not
   a finite number after conversion is UNKNOWN, not zero. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function rate(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* money — cents to a 2dp string, or null. NULL never renders as "0.00": an
   unknown total that prints as zero is a wrong answer wearing a plausible face. */
const money = (c) => (c === null ? null : fromCents(c));

/* sumKnown — total the values that exist, and COUNT the ones that do not.
   Returns null for the total when nothing was usable, so a client with no rows
   reads as "unknown", not as "$0.00". */
function sumKnown(values) {
  let total = 0;
  let known = 0;
  let unknown = 0;
  for (const v of values) {
    if (v === null) unknown++;
    else { total += v; known++; }
  }
  return { total: known ? total : null, known, unknown };
}

const basisOf = (s, counted) => ({
  lines: counted,
  counted: s.known,
  unknown: s.unknown,
  partial: s.unknown > 0
});

/**
 * financeOsGrid — stored tradeline rows → the seven rows the screen prints.
 *
 * Returns { source, lines, rows: [7] }. Each row is
 *   { key, label, value, display, unit, basis: { lines, counted, unknown, partial } }
 * with `value === null` meaning UNKNOWN and `display === null` alongside it.
 *
 * The row order is fixed and is the reading order of the screen: what you have,
 * what you owe, what is left, how hard you are leaning on it, how many lines it
 * is spread across, what it costs, and where the cheapest money is.
 */
export function financeOsGrid(rows = []) {
  const drawable = (Array.isArray(rows) ? rows : []).filter(DRAWABLE);
  const n = drawable.length;

  const limits = drawable.map((r) => cents(r.credit_limit_cents));
  const balances = drawable.map((r) => cents(r.balance_cents));

  const limit = sumKnown(limits);
  const balance = sumKnown(balances);

  /* Headroom is per-line and only for lines where BOTH numbers are known —
     limit minus an unknown balance is not headroom, it is a limit. Clamped at
     zero per line, because an over-limit card contributes no room to draw and
     must not cancel out another card's genuine headroom. */
  const headrooms = drawable.map((r) => {
    const l = cents(r.credit_limit_cents);
    const b = cents(r.balance_cents);
    return l === null || b === null ? null : Math.max(0, l - b);
  });
  const headroom = sumKnown(headrooms);

  /* Utilization only over lines where both numbers are known, and only when the
     known limit is above zero — dividing by a zero limit is not 0% utilization,
     it is an undefined ratio. */
  const bothKnown = drawable.filter((r) =>
    cents(r.credit_limit_cents) !== null && cents(r.balance_cents) !== null);
  const utilLimit = bothKnown.reduce((a, r) => a + cents(r.credit_limit_cents), 0);
  const utilBalance = bothKnown.reduce((a, r) => a + cents(r.balance_cents), 0);
  const utilization = bothKnown.length && utilLimit > 0
    ? Math.round((utilBalance / utilLimit) * 10000) / 10000
    : null;

  /* Weighted by credit limit, not a plain mean: a 29% APR on a $500 card and a
     12% APR on a $50,000 card do not cost the same, and averaging them flat
     produces a number that describes no borrower. Lines with an unknown APR or
     an unknown limit cannot be weighted and are counted as unknown rather than
     dropped silently. */
  let aprWeight = 0;
  let aprAcc = 0;
  let aprKnown = 0;
  let aprUnknown = 0;
  for (const r of drawable) {
    const a = rate(r.apr);
    const l = cents(r.credit_limit_cents);
    if (a === null || l === null || l <= 0) { aprUnknown++; continue; }
    aprAcc += a * l;
    aprWeight += l;
    aprKnown++;
  }
  const avgApr = aprWeight > 0 ? Math.round((aprAcc / aprWeight) * 100000) / 100000 : null;

  /* The cheapest money the client can actually draw: lowest APR among lines
     that have headroom AND a known rate. An unpriced line is NOT offered as
     cheapest — src/tradelines/index.mjs sorts nulls last for exactly this
     reason, and calling an unknown price the best price is the worst possible
     direction to be wrong in. */
  let cheapest = null;
  drawable.forEach((r, i) => {
    const a = rate(r.apr);
    const room = headrooms[i];
    if (a === null || room === null || room <= 0) return;
    if (cheapest === null || a < cheapest.apr) {
      cheapest = { apr: a, lender: r.lender, availableCents: room };
    }
  });
  const cheapestPriced = drawable.filter((r, i) =>
    rate(r.apr) !== null && headrooms[i] !== null && headrooms[i] > 0).length;

  return {
    source: "tradelines",
    lines: n,
    rows: [
      {
        key: "credit_limit", label: "Total credit limit",
        value: limit.total, display: money(limit.total), unit: "usd",
        basis: basisOf(limit, n)
      },
      {
        key: "balance", label: "Total balance",
        value: balance.total, display: money(balance.total), unit: "usd",
        basis: basisOf(balance, n)
      },
      {
        key: "available", label: "Available credit",
        value: headroom.total, display: money(headroom.total), unit: "usd",
        basis: basisOf(headroom, n)
      },
      {
        key: "utilization", label: "Utilization",
        value: utilization,
        display: utilization === null ? null : `${(utilization * 100).toFixed(1)}%`,
        unit: "fraction",
        basis: { lines: n, counted: bothKnown.length, unknown: n - bothKnown.length,
                 partial: n - bothKnown.length > 0 }
      },
      {
        key: "open_lines", label: "Open revolving lines",
        // A count is never unknown: we know exactly how many rows we hold. Zero
        // here means zero drawable lines, which is a real answer, not a hole.
        value: n, display: String(n), unit: "count",
        basis: { lines: n, counted: n, unknown: 0, partial: false }
      },
      {
        key: "avg_apr", label: "Average APR (limit-weighted)",
        value: avgApr,
        display: avgApr === null ? null : `${(avgApr * 100).toFixed(2)}%`,
        unit: "fraction",
        basis: { lines: n, counted: aprKnown, unknown: aprUnknown, partial: aprUnknown > 0 }
      },
      {
        key: "cheapest", label: "Cheapest money available",
        value: cheapest === null ? null : cheapest.apr,
        display: cheapest === null
          ? null
          : `${(cheapest.apr * 100).toFixed(2)}% · ${cheapest.lender} · ${fromCents(cheapest.availableCents)}`,
        unit: "fraction",
        basis: { lines: n, counted: cheapestPriced, unknown: n - cheapestPriced,
                 partial: n - cheapestPriced > 0 }
      }
    ]
  };
}

export default financeOsGrid;
