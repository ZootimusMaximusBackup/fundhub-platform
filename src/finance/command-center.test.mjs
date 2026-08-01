import { test, describe } from "node:test";
import assert from "node:assert";
import { commandCenter } from "./command-center.mjs";

describe("commandCenter", () => {
  test("totals cash across open, non-credit accounts and ignores closed ones", () => {
    const out = commandCenter({
      bankAccounts: [
        { account_type: "depository", current_balance_cents: 100000, closed_at: null },
        { account_type: "depository", current_balance_cents: 50000, closed_at: "2026-01-01" },
        { account_type: "credit", current_balance_cents: 20000, closed_at: null }
      ]
    });
    assert.equal(out.totals.cash_cents, 100000);
    assert.equal(out.totals.cash_display, "1000.00");
  });

  test("a bank account with an unknown balance makes the total partial, not zero", () => {
    const out = commandCenter({
      bankAccounts: [
        { account_type: "depository", current_balance_cents: 100000, closed_at: null },
        { account_type: "depository", current_balance_cents: null, closed_at: null }
      ]
    });
    assert.equal(out.totals.cash_cents, 100000);
    assert.equal(out.totals.cash_basis.unknown, 1);
    assert.equal(out.totals.cash_basis.partial, true);
  });

  test("no accounts at all is unknown, never $0.00", () => {
    const out = commandCenter({ bankAccounts: [] });
    assert.equal(out.totals.cash_cents, null);
    assert.equal(out.totals.cash_display, null);
  });

  test("per-card utilization divides balance by limit, and a zero limit is not divided by", () => {
    const out = commandCenter({
      cards: [
        { client_id: "c1", lender: "Chase", credit_limit_cents: 100000, current_balance_cents: 25000, closed_at: null },
        { client_id: "c1", lender: "Amex", credit_limit_cents: 0, current_balance_cents: 5000, closed_at: null }
      ]
    });
    assert.equal(out.per_card[0].utilization, 0.25);
    assert.equal(out.per_card[1].utilization, null);
  });

  test("closed cards are excluded from overall utilization", () => {
    const out = commandCenter({
      cards: [
        { client_id: "c1", lender: "A", credit_limit_cents: 100000, current_balance_cents: 50000, closed_at: null },
        { client_id: "c1", lender: "B", credit_limit_cents: 900000, current_balance_cents: 900000, closed_at: "2025-01-01" }
      ]
    });
    assert.equal(out.totals.credit_available_cents, 100000);
    assert.equal(out.totals.credit_owed_cents, 50000);
    assert.equal(out.totals.utilization_overall, 0.5);
  });

  test("marketing spend is its own series, never merged into cashflow", () => {
    const out = commandCenter({
      cashflowByDay: [{ day: "2026-07-01", inflow_cents: 100000, outflow_cents: 40000 }],
      marketingByDay: [{ day: "2026-07-01", spend_cents: 5000 }]
    });
    assert.equal(out.cashflow_series[0].net_cents, 60000);
    assert.equal(out.marketing_series[0].spend_cents, 5000);
    assert.equal(out.cashflow_series[0].outflow_cents, 40000, "marketing spend must not be folded into outflow_cents");
  });

  test("net worth trend is explicitly reported as unavailable, not faked", () => {
    const out = commandCenter({});
    assert.equal(out.net_worth_trend_available, false);
  });

  test("net worth today combines cash, investments, and owed when any is known", () => {
    const out = commandCenter({
      bankAccounts: [{ account_type: "depository", current_balance_cents: 500000, closed_at: null }],
      cards: [{ client_id: "c1", lender: "A", credit_limit_cents: 100000, current_balance_cents: 20000, closed_at: null }],
      investments: [{ current_value_cents: 300000 }]
    });
    assert.equal(out.net_worth_today_cents, 500000 + 300000 - 20000);
  });
});
