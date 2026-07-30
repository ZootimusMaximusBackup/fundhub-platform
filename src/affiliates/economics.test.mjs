// Pure-arithmetic tests for src/affiliates/economics.mjs.
// The Postgres-backed behaviour lives in economics.pg.test.mjs; this file needs
// no database, so it runs everywhere.

import { test } from "node:test";
import assert from "node:assert";
import { commissionFor } from "./economics.mjs";


/* ── money is integer cents, not floats ─────────────────────────────────────
   commissionFor used `round2(basis * (percent/100))`, where round2's
   Number.EPSILON nudge is a no-op above magnitude 1 (EPSILON is relative to
   1.0). Near-tie products rounded DOWN, so commission_due was persisted a cent
   short of what Postgres computes for the same expression — permanently, because
   rule_snapshot is frozen at conversion and nothing recalculates the accrual. */

test("percent commissions match exact half-up, not float rounding", () => {
  const cases = [
    [1010.10, 15,   151.52],   // was 151.51
    [1060.60, 7.5,  79.55],    // was 79.54
    [5048.36, 12.5, 631.05],   // was 631.04
    [3000,    12,   360],
    [1000,    10,   100],
    [0,       15,   0]
  ];
  for (const [basis, percent, want] of cases) {
    const got = commissionFor({ calc_method: "percent", percent }, basis).amount;
    assert.equal(got, want, `${percent}% of ${basis}`);
  }
});

test("commissionFor agrees with commissions/money.percentOf on every realistic pair", async () => {
  // The two implementations disagreed on 12 of 2730 pairs. There must not be a
  // second, worse money implementation in the repo.
  const { toCents, fromCents, percentOf } = await import("../commissions/money.mjs");
  const mismatches = [];
  for (let cents = 100_00; cents <= 5100_00; cents += 1010) {
    const basis = cents / 100;
    for (const percent of [5, 7.5, 10, 12, 12.5, 15, 20, 0.25]) {
      const a = commissionFor({ calc_method: "percent", percent }, basis).amount;
      const b = Number(fromCents(percentOf(toCents(basis), percent)));
      if (a !== b) mismatches.push(`${percent}% of ${basis}: ${a} vs ${b}`);
    }
  }
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} disagreements`);
});

test("a flat commission also goes through cents", () => {
  assert.equal(commissionFor({ calc_method: "flat", flat_amount: 250.005 }, 999).amount, 250.01);
  assert.equal(commissionFor({ calc_method: "flat", flat_amount: 100 }, 999).amount, 100);
});
