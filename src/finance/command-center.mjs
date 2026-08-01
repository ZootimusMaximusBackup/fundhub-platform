// commandCenter — the roll-up: every client's cash, credit, and investment
// balances folded into one picture, plus cash-in/cash-out and marketing spend
// over time. Pure — no I/O, no clock — the same shape as src/finance/money-map.mjs,
// which is what api/read/finance-command.mjs fetches for.
//
// SAME "NULL IS UNKNOWN, NEVER ZERO" RULE AS EVERY OTHER FINANCE MODULE HERE.
// src/finance/os-grid.mjs's sumKnown()/basisOf() are reused rather than
// reimplemented — two copies of "a total over rows with holes is a floor, not a
// total" is exactly the drift this repo's finance work keeps finding.
import { fromCents } from "../commissions/money.mjs";
import { sumKnown, basisOf } from "./os-grid.mjs";

function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
const money = (c) => (c === null ? null : fromCents(c));

/**
 * commandCenter — assemble the roll-up.
 *
 * @param bankAccounts   rows: { id, client_id, entity_id, account_type,
 *                        current_balance_cents, closed_at }
 * @param cards          rows: { client_id, entity_id, lender, credit_limit_cents,
 *                        current_balance_cents, closed_at } — one row per
 *                        tradeline (the live figure; card_liabilities is a
 *                        separate CRS-observation history, not this)
 * @param investments    rows: { client_id, current_value_cents }
 * @param cashflowByDay   rows: { day, inflow_cents, outflow_cents } — one row per
 *                        calendar day in the window, pre-aggregated in SQL from
 *                        bank_transactions.amount_cents (positive = inflow).
 * @param marketingByDay  rows: { day, spend_cents } — pre-aggregated from
 *                        ad_metrics_daily. Business-wide: campaigns are scoped
 *                        to a partner, not a client, so this series is never
 *                        filtered by client_id — see the header note in
 *                        api/read/finance-command.mjs.
 */
export function commandCenter({ bankAccounts = [], cards = [], investments = [],
                                 cashflowByDay = [], marketingByDay = [], scopedToClient = false } = {}) {
  const openAccounts = bankAccounts.filter((a) => !a.closed_at);
  const cashRows = openAccounts.filter((a) => a.account_type !== "credit" && a.account_type !== "investment");
  const cash = sumKnown(cashRows.map((a) => cents(a.current_balance_cents)));

  const openCards = cards.filter((c) => !c.closed_at);
  const limitSum = sumKnown(openCards.map((c) => cents(c.credit_limit_cents)));
  const owedSum = sumKnown(openCards.map((c) => cents(c.current_balance_cents)));

  const perCard = openCards.map((c) => {
    const limit = cents(c.credit_limit_cents);
    const balance = cents(c.current_balance_cents);
    const utilization = (limit && limit > 0 && balance !== null) ? balance / limit : null;
    return {
      client_id: c.client_id,
      entity_id: c.entity_id ?? null,
      lender: c.lender ?? null,
      limit_cents: limit,
      limit_display: money(limit),
      balance_cents: balance,
      balance_display: money(balance),
      utilization
    };
  });

  const utilizationOverall = (limitSum.total && limitSum.total > 0 && owedSum.total !== null)
    ? owedSum.total / limitSum.total
    : null;

  const investmentTotal = sumKnown(investments.map((i) => cents(i.current_value_cents)));

  const cashflowSeries = cashflowByDay.map((r) => {
    const inflow = cents(r.inflow_cents) ?? 0;
    const outflow = cents(r.outflow_cents) ?? 0;
    return {
      date: r.day,
      inflow_cents: inflow,
      inflow_display: money(inflow),
      outflow_cents: outflow,
      outflow_display: money(outflow),
      net_cents: inflow - outflow,
      net_display: money(inflow - outflow)
    };
  });

  const marketingSeries = marketingByDay.map((r) => {
    const spend = cents(r.spend_cents) ?? 0;
    return { date: r.day, spend_cents: spend, spend_display: money(spend) };
  });

  /* combined_series — cash-out INCLUDING marketing spend, as one line. Only
     computed when the view is business-wide (scopedToClient === false):
     marketing spend cannot be attributed to one client (campaigns are scoped
     to a partner, not a client — see the header note in
     api/read/finance-command.mjs), so combining it into a single client's cash
     flow would misattribute somebody else's ad cost onto their file. When a
     client filter is applied, this is null WITH A NAMED REASON — never
     silently omitted, and never combined anyway "close enough". */
  let combinedSeries = null;
  let combinedUnavailableReason = null;
  if (scopedToClient) {
    combinedUnavailableReason = "marketing spend cannot be attributed to one client — see marketing_series, shown separately";
  } else {
    const marketingByDate = new Map(marketingSeries.map((r) => [r.date, r.spend_cents]));
    const dates = new Set([...cashflowSeries.map((r) => r.date), ...marketingSeries.map((r) => r.date)]);
    combinedSeries = [...dates].sort().map((date) => {
      const cf = cashflowSeries.find((r) => r.date === date);
      const inflow = cf ? cf.inflow_cents : 0;
      const outflow = (cf ? cf.outflow_cents : 0) + (marketingByDate.get(date) || 0);
      return {
        date, inflow_cents: inflow, outflow_cents: outflow,
        net_cents: inflow - outflow, net_display: money(inflow - outflow)
      };
    });
  }

  return {
    totals: {
      cash_cents: cash.total,
      cash_display: money(cash.total),
      cash_basis: basisOf(cash, cashRows.length),

      credit_available_cents: limitSum.total,
      credit_available_display: money(limitSum.total),
      credit_available_basis: basisOf(limitSum, openCards.length),

      credit_owed_cents: owedSum.total,
      credit_owed_display: money(owedSum.total),
      credit_owed_basis: basisOf(owedSum, openCards.length),

      utilization_overall: utilizationOverall,

      investment_cents: investmentTotal.total,
      investment_display: money(investmentTotal.total),
      investment_basis: basisOf(investmentTotal, investments.length)
    },
    per_card: perCard,
    cashflow_series: cashflowSeries,
    /* Business-wide marketing spend, folded in as its own labelled series
       rather than merged into cashflow_series — see the header note above on
       why campaigns cannot be attributed to one client. A dashboard that wants
       "cash out including marketing" adds the two series rather than this
       module inventing a third number nobody asked for. */
    marketing_series: marketingSeries,
    combined_series: combinedSeries,
    combined_series_unavailable_reason: combinedUnavailableReason,
    /* No history table exists for account balances (098_investment_holdings.sql
       is explicitly "current position only, no history table" — see the Finance
       OS audit). A net-worth TREND therefore cannot be computed from anything
       currently stored; only today's point figure (cash + investment - owed)
       can. Reporting a trend line here would be the exact "confident guess
       wearing a chart's face" this repo's finance code refuses to do. */
    net_worth_today_cents: (cash.total !== null || investmentTotal.total !== null || owedSum.total !== null)
      ? (cash.total || 0) + (investmentTotal.total || 0) - (owedSum.total || 0)
      : null,
    net_worth_trend_available: false
  };
}
