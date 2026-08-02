// The adapter: fundhub rows -> the engine's bureau shape.
//
// The two things most likely to be wrong here are both silent, and both produce
// numbers that look completely plausible:
//
//   * a factor of 100, because utilization is a FRACTION on this side of the
//     boundary and PERCENT UNITS on the engine's side;
//   * a factor of 100 again, because money is CENTS here and DOLLARS there.
//
// Getting either backwards makes every client look either spotless or maxed out,
// and nothing in the output says so. Both conversions are asserted below with
// numbers chosen so a wrong conversion cannot coincidentally match.
//
// The third thing is the one this whole integration exists to handle: an unknown
// must never arrive at the engine as a zero without being recorded as unknown.

import { test, describe } from "node:test";
import assert from "node:assert";

import { toBureaus, toEngineTradelines, clientUtilizationPct, BUREAUS } from "./adapter.mjs";

/* A `tradelines` row (054). Cents, and NULL is allowed on every measure. */
const line = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  org_id: "org", client_id: "cli",
  lender: "Chase", kind: "revolving",
  credit_limit_cents: 1_000_000,   // $10,000
  balance_cents: 250_000,          // $2,500
  apr: "0.1899",
  closed_at: null,
  ...over
});

/* A `crs_results` row as the endpoint selects it. */
const crs = (scores, created_at = "2026-01-02T00:00:00Z") => ({ result: { scores }, created_at });

const SCORES = { ex: 720, eq: 705, tu: 710 };

describe("cents -> dollars, exactly once", () => {
  test("a limit and a balance arrive at the engine in dollars", () => {
    const { lines } = toEngineTradelines([line()]);
    assert.equal(lines[0].limit, 10000, "1_000_000 cents is $10,000 — not 1,000,000 and not 100");
    assert.equal(lines[0].balance, 2500);
  });

  test("odd cents survive the conversion", () => {
    const { lines } = toEngineTradelines([line({ credit_limit_cents: 999_999, balance_cents: 1 })]);
    assert.equal(lines[0].limit, 9999.99);
    assert.equal(lines[0].balance, 0.01);
  });

  test("an unknown limit stays null and does NOT become 0", () => {
    const { lines, gaps } = toEngineTradelines([line({ credit_limit_cents: null })]);
    assert.equal(lines[0].limit, null, "a missing limit is unknown, never zero");
    assert.ok(gaps[0].missing.includes("credit_limit_cents"));
  });

  test("a negative balance is refused as unknown rather than passed through", () => {
    const { lines } = toEngineTradelines([line({ balance_cents: -5 })]);
    assert.equal(lines[0].balance, null);
  });
});

describe("utilization is percent units on the way out", () => {
  test("a quarter-used portfolio is 25, not 0.25", () => {
    const u = clientUtilizationPct([line({ credit_limit_cents: 1_000_000, balance_cents: 250_000 })]);
    assert.equal(u.pct, 25, "the engine compares against 30/50/80, so this must be 25");
    assert.equal(u.partial, false);
  });

  test("no readable line means null, never 0%", () => {
    const u = clientUtilizationPct([line({ credit_limit_cents: null, balance_cents: null })]);
    assert.equal(u.pct, null, "unknown utilization must not read as a client using none of their credit");
  });

  test("a partially readable portfolio is flagged partial", () => {
    const u = clientUtilizationPct([
      line({ id: "a", credit_limit_cents: 1_000_000, balance_cents: 500_000 }),
      line({ id: "b", credit_limit_cents: null, balance_cents: 100_000 })
    ]);
    assert.equal(u.pct, 50);
    assert.equal(u.partial, true, "one unreadable line makes the figure a floor, and it must say so");
  });
});

describe("tradeline type and status mapping", () => {
  test("revolving and installment map to the engine's own type names", () => {
    const { lines } = toEngineTradelines([
      line({ id: "a", kind: "revolving" }),
      line({ id: "b", kind: "installment" })
    ]);
    assert.equal(lines[0].type, "revolving");
    assert.equal(lines[1].type, "installment");
  });

  test("a line of credit is passed through untyped, NOT promoted to revolving", () => {
    // Promoting a LOC would let it become the client's anchor card and invent
    // card-stacking capacity. It must count toward file depth and nothing else.
    const { lines, gaps } = toEngineTradelines([line({ kind: "loc" })]);
    assert.equal(lines[0].type, "loc");
    assert.equal(gaps[0].passedThroughUntyped, true, "the pass-through must be visible in the response");
  });

  test("an open line reads open; a closed one reads closed", () => {
    const { lines } = toEngineTradelines([
      line({ id: "a", closed_at: null }),
      line({ id: "b", closed_at: "2026-01-01T00:00:00Z" })
    ]);
    assert.equal(lines[0].status, "open");
    assert.equal(lines[1].status, "closed");
  });

  test("charge-offs and collections come from the liability position", () => {
    const t = line({ id: "t1" });
    const { lines } = toEngineTradelines([t], [{ tradeline_id: "t1", payment_status: "charge_off" }]);
    assert.equal(lines[0].status, "open chargeoff",
      "the engine substring-matches 'chargeoff' to spot a derogatory account");
  });

  test("a 30-day late is NOT promoted to a derogatory status", () => {
    // The engine's derog list is charge-offs, collections, repossessions and
    // foreclosures. Adding lates to it would be this repo inventing a rule.
    const t = line({ id: "t1" });
    const { lines } = toEngineTradelines([t], [{ tradeline_id: "t1", payment_status: "late_30" }]);
    assert.equal(lines[0].status, "open");
  });

  test("a line with no opened_on reports `opened: null` and names the gap", () => {
    // The historical case: rows ingested before the 2026-08-01 mapping fix, or a
    // manual entry with no date given, have opened_on = null. That must still
    // read as unseasoned rather than being guessed at.
    const { lines, gaps } = toEngineTradelines([line(), line({ id: "b" })]);
    assert.deepEqual(lines.map((l) => l.opened), [null, null]);
    for (const g of gaps) assert.ok(g.missing.includes("opened"));
  });

  test("a line with a real opened_on passes it through, not null", () => {
    const { lines, gaps } = toEngineTradelines([line({ opened_on: "2020-12-11" })]);
    assert.equal(lines[0].opened, "2020-12-11");
    assert.ok(!gaps[0].missing.includes("opened"), "a known date must not be named as missing");
  });

  test("opened_on as a JS Date (what node-postgres returns for a `date` column) still converts", () => {
    // tradelines.opened_on is a `date` column; the pg driver parses a non-null
    // one into a local-time JS Date, not a string. If the adapter forgot to
    // convert, monthsSince() in the vendored engine would reject the Date
    // (it requires a string) and this would silently regress to "always null".
    const { lines } = toEngineTradelines([line({ opened_on: new Date(2020, 11, 11) })]);
    assert.equal(lines[0].opened, "2020-12-11");
  });

  test("a card with no stored liability position reports payment_status missing", () => {
    const { gaps } = toEngineTradelines([line()], []);
    assert.ok(gaps[0].missing.includes("payment_status"),
      "no liability row means derogatory standing is unknown, not clean");
  });
});

describe("toBureaus — which bureaus are supplied, and what is recorded missing", () => {
  test("a bureau with a score is supplied; one without is withheld entirely", () => {
    const out = toBureaus({ crsResults: [crs({ ex: 720 })], tradelines: [line()] });
    assert.deepEqual(out.available, ["experian"]);
    assert.ok(out.bureaus.experian, "experian has a score and must be passed to the engine");
    assert.equal(out.bureaus.equifax, undefined,
      "a bureau with no score must be absent, not an empty object — normalizeBureau would call " +
      "an empty object 'available' and the engine would report a score of 0");
    assert.equal(out.missing.equifax[0].field, "score");
  });

  test("all three bureaus come through when all three have scores", () => {
    const out = toBureaus({ crsResults: [crs(SCORES)], tradelines: [line()] });
    assert.deepEqual(out.available, BUREAUS);
    assert.equal(out.bureaus.experian.score, 720);
    assert.equal(out.bureaus.equifax.score, 705);
    assert.equal(out.bureaus.transunion.score, 710);
  });

  test("unentered negatives and late payments are recorded, not defaulted", () => {
    const out = toBureaus({ crsResults: [crs({ ex: 720 })], tradelines: [line()], customFields: {} });
    assert.equal(out.bureaus.experian.negatives, null, "NULL must survive to the boundary");
    assert.equal(out.bureaus.experian.late_payment_events, null);

    const fields = out.missing.experian.map((m) => m.field);
    assert.ok(fields.includes("negatives"));
    assert.ok(fields.includes("late_payment_events"));
    assert.ok(fields.includes("inquiries"));

    // The consequence is spelled out where it is lost, not left for a reader to
    // work out from the engine's source.
    const neg = out.missing.experian.find((m) => m.field === "negatives");
    assert.match(neg.effect, /fundable/,
      "the record must say that an unentered negatives count is what lets a client read as fundable");
  });

  test("entered values are read from the live custom-field names", () => {
    const out = toBureaus({
      crsResults: [crs(SCORES)],
      tradelines: [line()],
      customFields: {
        crs_inquiries_ex: 4, crs_inquiries_eq: 2, crs_inquiries_tu: 0,
        crs_negative_items_count: 3,
        crs_late_payments_count: 1,
        business_age_months: 18
      }
    });
    assert.equal(out.bureaus.experian.inquiries, 4);
    assert.equal(out.bureaus.equifax.inquiries, 2);
    assert.equal(out.bureaus.transunion.inquiries, 0, "a real zero is a value, not a gap");
    assert.equal(out.bureaus.experian.negatives, 3);
    assert.equal(out.bureaus.experian.late_payment_events, 1);
    assert.equal(out.businessAgeMonths, 18);

    // A real 0 must not be reported as missing.
    assert.ok(!out.missing.transunion.some((m) => m.field === "inquiries"));
  });

  test("client-wide figures are marked as not per-bureau", () => {
    const out = toBureaus({ crsResults: [crs(SCORES)], tradelines: [line()] });
    const note = out.missing.client.find((m) => m.field === "per_bureau_attribution");
    assert.ok(note, "three identical negatives counts are one number repeated and must say so");
    assert.equal(note.perBureau, false);
  });

  test("hasLLC is always reported missing at client level; opened is reported only when true", () => {
    // hasLLC has no code path that could ever fill it in — always missing.
    // opened is data-dependent since the mapping fix: this fixture's line has
    // no opened_on, so it is still missing here.
    const out = toBureaus({ crsResults: [crs(SCORES)], tradelines: [line()] });
    const fields = out.missing.client.map((m) => m.field);
    assert.ok(fields.includes("hasLLC"));
    assert.ok(fields.includes("opened"));
  });

  test("opened is NOT reported missing at client level once every line has a real date", () => {
    const out = toBureaus({
      crsResults: [crs(SCORES)],
      tradelines: [line({ opened_on: "2018-01-01" })]
    });
    const fields = out.missing.client.map((m) => m.field);
    assert.ok(!fields.includes("opened"), "a fully-dated file must not still claim the date is missing");
  });

  test("opened at client level names the partial count when only some lines lack a date", () => {
    const out = toBureaus({
      crsResults: [crs(SCORES)],
      tradelines: [line({ id: "a", opened_on: "2018-01-01" }), line({ id: "b" })]
    });
    const gap = out.missing.client.find((m) => m.field === "opened");
    assert.ok(gap, "one of two lines still lacks a date, so the gap must be named");
    assert.match(gap.reason, /1 of 2/);
  });

  test("no credit pull at all is its own finding", () => {
    const out = toBureaus({ crsResults: [], tradelines: [] });
    assert.deepEqual(out.available, []);
    assert.deepEqual(out.bureaus, {});
    assert.ok(out.missing.client.some((m) => m.field === "crs_results"));
  });

  test("business age absent is recorded and stays null", () => {
    const out = toBureaus({ crsResults: [crs(SCORES)], customFields: {} });
    assert.equal(out.businessAgeMonths, null, "never 0 — a 0-month-old business is a claim");
    assert.ok(out.missing.client.some((m) => m.field === "business_age_months"));
  });

  test("garbage in a numeric custom field reads as unknown, not as a number", () => {
    const out = toBureaus({
      crsResults: [crs({ ex: 720 })],
      tradelines: [line()],
      customFields: { crs_negative_items_count: "not a number", crs_inquiries_ex: -3 }
    });
    assert.equal(out.bureaus.experian.negatives, null);
    assert.equal(out.bureaus.experian.inquiries, null, "a negative inquiry count is a data error, not a count");
  });

  test("survives being called with nothing at all", () => {
    const out = toBureaus();
    assert.deepEqual(out.available, []);
    assert.equal(out.businessAgeMonths, null);
    assert.ok(Array.isArray(out.missing.client));
  });
});
