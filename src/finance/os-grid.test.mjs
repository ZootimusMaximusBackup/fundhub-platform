// Unit tests for the Finance OS grid.
//
// The arithmetic is the easy half and is barely tested here. What these pin is
// the HOLES: a bureau file that omits a limit produces NULL, NULL must stay
// NULL, and a partial sum must announce itself as partial. The failure this
// guards against is a screen printing a confident total over a data set with
// gaps in it — which is the shape of nearly every finding in AUDIT-FINDINGS.md.
//
// Pure module, so no database and no browser. Runs in every CI pass.

import { test, describe } from "node:test";
import assert from "node:assert";
import { financeOsGrid } from "./os-grid.mjs";

/* A stored tradeline row as Postgres hands it back: bigint columns arrive as
   STRINGS, numeric as strings. Getting that wrong is how "10000" becomes
   garbage, so the fixtures use the real wire types. */
const line = (over = {}) => ({
  id: "t1", lender: "Amex", kind: "revolving",
  credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.18990",
  closed_at: null, ...over
});

const row = (grid, key) => grid.rows.find((r) => r.key === key);

describe("shape", () => {
  test("exactly seven rows, in a fixed reading order", () => {
    const g = financeOsGrid([line()]);
    assert.equal(g.rows.length, 7, `grid has ${g.rows.length} rows, not 7`);
    assert.deepEqual(g.rows.map((r) => r.key), [
      "credit_limit", "balance", "available", "utilization",
      "open_lines", "avg_apr", "cheapest"
    ]);
  });

  test("the response names its own source, so a screen cannot imply more", () => {
    assert.equal(financeOsGrid([]).source, "tradelines");
  });

  test("bad input does not throw — it reports nothing known", () => {
    for (const input of [undefined, null, [], "nonsense", 7, {}]) {
      const g = financeOsGrid(input);
      assert.equal(g.rows.length, 7, `input ${JSON.stringify(input)} produced ${g.rows.length} rows`);
      assert.equal(g.lines, 0);
    }
  });
});

describe("the ordinary case", () => {
  const g = financeOsGrid([
    line({ id: "a", lender: "Amex", credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.18990" }),
    line({ id: "b", lender: "Chase", credit_limit_cents: "500000", balance_cents: "100000", apr: "0.21240" })
  ]);

  test("limits, balances and headroom total in cents and render in dollars", () => {
    assert.equal(row(g, "credit_limit").value, 1500000);
    assert.equal(row(g, "credit_limit").display, "15000.00");
    assert.equal(row(g, "balance").value, 350000);
    assert.equal(row(g, "balance").display, "3500.00");
    assert.equal(row(g, "available").value, 1150000);
    assert.equal(row(g, "available").display, "11500.00");
  });

  test("utilization is balance over limit, not an average of ratios", () => {
    // 350000/1500000 = 0.2333. Averaging the two cards' ratios (0.25, 0.20)
    // would give 0.225 — a number describing no borrower.
    assert.equal(row(g, "utilization").value, 0.2333);
    assert.equal(row(g, "utilization").display, "23.3%");
  });

  test("APR is weighted by credit limit, not a flat mean", () => {
    // (0.1899*1000000 + 0.2124*500000) / 1500000 = 0.1974
    assert.equal(row(g, "avg_apr").value, 0.1974);
    assert.equal(row(g, "avg_apr").display, "19.74%");
  });

  test("cheapest money is the lowest priced line that actually has room", () => {
    const c = row(g, "cheapest");
    assert.equal(c.value, 0.1899);
    assert.match(c.display, /^18\.99% · Amex · 7500\.00$/);
  });

  test("nothing is flagged partial when nothing is missing", () => {
    for (const r of g.rows) {
      assert.equal(r.basis.partial, false, `${r.key} was flagged partial with complete data`);
      assert.equal(r.basis.unknown, 0, `${r.key} counted ${r.basis.unknown} unknowns`);
    }
  });
});

describe("NULL means unknown, and unknown never renders as zero", () => {
  test("a client with no tradelines reads as unknown, not as $0.00", () => {
    // "Nobody has pulled this client yet" and "this client has zero available
    // credit" are opposite facts. A screen that shows $0.00 for the first one
    // tells the closer something false on the call.
    const g = financeOsGrid([]);
    for (const key of ["credit_limit", "balance", "available", "utilization", "avg_apr", "cheapest"]) {
      assert.equal(row(g, key).value, null, `${key} was ${row(g, key).value}, not null`);
      assert.equal(row(g, key).display, null, `${key} rendered "${row(g, key).display}" for an empty file`);
    }
    // A COUNT is genuinely known: we hold zero rows and can say so.
    assert.equal(row(g, "open_lines").value, 0);
    assert.equal(row(g, "open_lines").display, "0");
  });

  test("a missing limit makes the total a FLOOR, and the row says so", () => {
    const g = financeOsGrid([
      line({ id: "a", credit_limit_cents: "1000000" }),
      line({ id: "b", credit_limit_cents: null })
    ]);
    const r = row(g, "credit_limit");
    assert.equal(r.value, 1000000, "the known limit was dropped instead of counted");
    assert.equal(r.basis.counted, 1);
    assert.equal(r.basis.unknown, 1);
    assert.equal(r.basis.partial, true,
      "a total over a data set with a hole in it was presented as complete");
  });

  test("headroom needs BOTH numbers — a known limit with an unknown balance is not room", () => {
    const g = financeOsGrid([line({ credit_limit_cents: "1000000", balance_cents: null })]);
    const r = row(g, "available");
    assert.equal(r.value, null, "an unknown balance was treated as zero owed");
    assert.equal(r.display, null);
    assert.equal(r.basis.unknown, 1);
  });

  test("an unknown APR is never offered as the cheapest money", () => {
    // The worst possible direction to be wrong in: calling a price we do not
    // know the best price available.
    const g = financeOsGrid([
      line({ id: "a", lender: "Unpriced", apr: null, credit_limit_cents: "9000000", balance_cents: "0" }),
      line({ id: "b", lender: "Chase", apr: "0.21240", credit_limit_cents: "500000", balance_cents: "0" })
    ]);
    const c = row(g, "cheapest");
    assert.equal(c.value, 0.2124);
    assert.match(c.display, /Chase/);
    assert.ok(!/Unpriced/.test(c.display), "an unpriced line was named as the cheapest money");
    assert.equal(c.basis.partial, true);
  });

  test("an unpriced line is counted as unknown in the APR row, not silently dropped", () => {
    const g = financeOsGrid([
      line({ id: "a", apr: "0.18990", credit_limit_cents: "1000000" }),
      line({ id: "b", apr: null, credit_limit_cents: "1000000" })
    ]);
    const r = row(g, "avg_apr");
    assert.equal(r.value, 0.1899, "the unpriced line dragged the average");
    assert.equal(r.basis.counted, 1);
    assert.equal(r.basis.unknown, 1);
    assert.equal(r.basis.partial, true);
  });

  test("a zero limit is not zero utilization — it is an undefined ratio", () => {
    const g = financeOsGrid([line({ credit_limit_cents: "0", balance_cents: "0" })]);
    assert.equal(row(g, "utilization").value, null,
      "dividing by a zero limit produced a number");
  });
});

describe("what does not count as drawable credit", () => {
  test("installment lines are excluded — you cannot draw against an auto loan", () => {
    // Including one inflates Total Available Credit, which is the single number
    // a closer says out loud on a call.
    const g = financeOsGrid([
      line({ id: "a", credit_limit_cents: "1000000", balance_cents: "0" }),
      line({ id: "b", kind: "installment", credit_limit_cents: "5000000", balance_cents: "0" })
    ]);
    assert.equal(g.lines, 1);
    assert.equal(row(g, "credit_limit").value, 1000000,
      "an installment loan was counted as available credit");
    assert.equal(row(g, "open_lines").value, 1);
  });

  test("closed lines are excluded — a closed card has no headroom", () => {
    const g = financeOsGrid([
      line({ id: "a", credit_limit_cents: "1000000", balance_cents: "0" }),
      line({ id: "b", closed_at: new Date(), credit_limit_cents: "5000000", balance_cents: "0" })
    ]);
    assert.equal(g.lines, 1);
    assert.equal(row(g, "available").value, 1000000);
  });

  test("a line of credit IS drawable and stays in", () => {
    const g = financeOsGrid([line({ kind: "loc", credit_limit_cents: "300000", balance_cents: "0" })]);
    assert.equal(g.lines, 1);
    assert.equal(row(g, "available").value, 300000);
  });
});

describe("over-limit cards", () => {
  test("negative headroom is clamped per line, not netted against another card", () => {
    // An over-limit card contributes no room to draw. Letting it go negative
    // would cancel out a different card's genuine headroom and understate what
    // the client can actually access.
    const g = financeOsGrid([
      line({ id: "a", credit_limit_cents: "100000", balance_cents: "150000" }),
      line({ id: "b", credit_limit_cents: "500000", balance_cents: "0" })
    ]);
    assert.equal(row(g, "available").value, 500000,
      "an over-limit card ate another card's headroom");
  });

  test("utilization above 100% is reported, not clamped", () => {
    // Being over limit is a real and important fact about a file. Clamping it
    // to 100% hides the thing the closer most needs to see.
    const g = financeOsGrid([line({ credit_limit_cents: "100000", balance_cents: "150000" })]);
    assert.equal(row(g, "utilization").value, 1.5);
    assert.equal(row(g, "utilization").display, "150.0%");
  });
});

describe("wire types", () => {
  test("bigint columns arriving as strings are handled, not concatenated", () => {
    // pg returns bigint as a string. "1000000" + "500000" is "1000000500000".
    const g = financeOsGrid([
      line({ id: "a", credit_limit_cents: "1000000" }),
      line({ id: "b", credit_limit_cents: "500000" })
    ]);
    assert.equal(row(g, "credit_limit").value, 1500000);
  });

  test("unparseable values are unknown rather than NaN", () => {
    const g = financeOsGrid([line({ credit_limit_cents: "not a number" })]);
    assert.equal(row(g, "credit_limit").value, null);
    assert.equal(row(g, "credit_limit").basis.unknown, 1);
  });
});
