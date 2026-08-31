// Pure-arithmetic tests for src/affiliates/economics.mjs.
// The Postgres-backed behaviour lives in economics.pg.test.mjs; this file needs
// no database, so it runs everywhere.

import { test } from "node:test";
import assert from "node:assert";
import { commissionFor, basisFor } from "./economics.mjs";


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


/* ── the partner's half, as a basis (migration 272) ──────────────────────────
   Owner-set 2026-08-31: an affiliate earns on the 10% success fee, not only on
   the deposit, and is paid out of the PARTNER'S half — so the partner's half is
   what the rate reads. The arithmetic is worth pinning without a database,
   because a half of a half is exactly where a rounding or a NULL goes wrong
   quietly. The one-row stub stands in for the join; the real query is exercised
   in economics.pg.test.mjs and success-fee-share.pg.test.mjs. */

const stubDb = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const share = (row) => basisFor(stubDb(row), {
  amountBasis: "partner_share_of_cash", saleId: "sale-1"
});

test("the partner's half of the cash is what the affiliate rate applies to", async () => {
  // $3,000 deposit + $9,000 success-fee balance = the whole 10% fee on a
  // $120,000 funded deal. Half of it is the partner's; fundhub keeps the rest.
  assert.equal(await share({ cash: "12000.00", partner_id: "p1", share_pct: "50" }), 6000);
  assert.equal(await share({ cash: "3000.00", partner_id: "p1", share_pct: "50" }), 1500);
  // A downgraded partner (W1 §6) is on 20, and only new conversions see it.
  assert.equal(await share({ cash: "12000.00", partner_id: "p1", share_pct: "20" }), 2400);
});

test("odd cents split half-up, not down", async () => {
  // $1,010.15 halves to $505.075. Half-up is 505.08; a float floor gives 505.07,
  // and one cent wrong on a statement is a partner who stops trusting it.
  assert.equal(await share({ cash: "1010.15", partner_id: "p1", share_pct: "50" }), 505.08);
  assert.equal(await share({ cash: "0.01", partner_id: "p1", share_pct: "50" }), 0.01);
});

test("a fundhub-direct client has no partner half, so the whole of the cash is the basis", async () => {
  // There is no partner to take from — fundhub owns that cash and pays its own
  // affiliate out of it. Zeroing it here would silently stop paying the direct book.
  assert.equal(await share({ cash: "12000.00", partner_id: null, share_pct: null }), 12000);
});

test("an unreachable partner is UNKNOWN — null, never zero and never the full cash", async () => {
  // The client names a partner the org-scoped join could not reach. A zero would
  // look like a settled $0 commission; null keeps it in unratedConversions().
  assert.equal(await share({ cash: "12000.00", partner_id: "p1", share_pct: null }), null);
  assert.equal(await share({ cash: "12000.00", partner_id: "p1", share_pct: "nonsense" }), null);
});

test("a partner on 0% has no half, which is an answer and not a crash", async () => {
  // applySplit refuses a split of zero, so this case is handled before it.
  assert.equal(await share({ cash: "12000.00", partner_id: "p1", share_pct: "0" }), 0);
});

test("no such sale answers 0, the same as every other basis", async () => {
  assert.equal(await share(null), 0);
});
