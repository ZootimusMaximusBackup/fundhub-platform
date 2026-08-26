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
// The engine, the reader and the seed, all real. The last two blocks in this
// file check the adapter's claims against what actually happens downstream and
// upstream of it, rather than against a fixture written to agree with them.
// None of these touches a database at import time — src/db.mjs builds its pool
// lazily, on the first query.
import { computeUnderwrite } from "./engine.mjs";
import { triMerge } from "../http/client-detail.mjs";
import { normalizeFromCrs } from "../tradelines/index.mjs";
import { buildSimulatedCrsPayload } from "../demo/simulate-client.mjs";

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
    // work out from the engine's source. WHICH consequence it has to name is
    // asserted further down, against the engine itself; this only pins that the
    // sentence mentions `fundable` at all.
    const neg = out.missing.experian.find((m) => m.field === "negatives");
    assert.match(neg.effect, /fundable/,
      "the record must say what an unentered negatives count does to `fundable`");
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
    assert.deepEqual(out.businessAges, [18]);

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
    assert.deepEqual(out.businessAges, []);
    assert.ok(out.missing.client.some((m) => m.field === "business_age_months"));
  });

  test("two saved companies reuse the client age when rows have no age_months", () => {
    const out = toBureaus({
      crsResults: [crs(SCORES)],
      customFields: { business_age_months: 30 },
      businesses: [{ name: "One LLC" }, { name: "Two LLC" }]
    });
    assert.equal(out.businessAgeMonths, 30);
    assert.deepEqual(out.businessAges, [30, 30]);
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

/* ═══════════════════════════════════════════════════════════════════════════════
   THE RECORDED EFFECT OF A GAP MUST BE WHAT THE ENGINE ACTUALLY DOES

   These `effect` sentences are not internal notes. They are read by an operator
   off a screen, and they are the only explanation anyone gets for why a client
   shows $0. Three of them stated the OPPOSITE of the engine's behaviour until
   2026-08-19: they said an unentered count is read as zero and therefore helps
   the client, when in fact it is kept as null and fails every `=== 0` gate the
   engine has, which withholds funding.

   A wrong sentence here is worse than no sentence: it sends an operator looking
   for a credit problem that does not exist. So each claim below is checked
   against the engine's own output rather than against itself.

   `opened` dates here follow the rule in ./fixtures.test.mjs: null (never
   seasoned) or 1990 (seasoned for centuries). Never a date near the 24-month
   boundary, which would make these tests start failing on their own.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("what a gap costs, checked against the engine and not against itself", () => {
  const scoredCrs = [crs(SCORES)];
  const clean = { crs_negative_items_count: 0, crs_late_payments_count: 0 };

  test("an unentered negatives count reads NOT fundable — it is not mistaken for a clean file", () => {
    const withCount = toBureaus({ crsResults: scoredCrs, tradelines: [line()], customFields: clean });
    const without = toBureaus({ crsResults: scoredCrs, tradelines: [line()], customFields: {} });

    assert.equal(computeUnderwrite(withCount.bureaus, null).fundable, true,
      "a MEASURED zero, with a 720 score and 25% utilization, is fundable");
    assert.equal(computeUnderwrite(without.bureaus, null).fundable, false,
      "an UNMEASURED zero is not — null fails `neg === 0`");

    const effect = without.missing.experian.find((m) => m.field === "negatives").effect;
    assert.match(effect, /NOT fundable/,
      "the sentence must tell the operator the client reads NOT fundable, which is what happens");
    assert.doesNotMatch(effect, /counts 0|reports zero/i,
      "the engine does not count 0 here — saying so sends the operator looking for the wrong problem");
  });

  test("an unentered late-payment count WITHHOLDS loan funding rather than granting it", () => {
    const loan = line({ kind: "installment", credit_limit_cents: 2_000_000, opened_on: "1990-01-01" });
    const withCount = toBureaus({ crsResults: scoredCrs, tradelines: [loan], customFields: clean });
    const without = toBureaus({ crsResults: scoredCrs, tradelines: [loan], customFields: {} });

    assert.equal(computeUnderwrite(withCount.bureaus, null).personal.can_loan_stack, true,
      "a $20,000 seasoned installment loan and a measured zero lates can loan-stack");
    assert.equal(computeUnderwrite(without.bureaus, null).personal.loan_funding, 0,
      "with the count unknown the same loan produces nothing");

    const effect = without.missing.experian.find((m) => m.field === "late_payment_events").effect;
    assert.match(effect, /withheld/,
      "the sentence must say the funding is withheld, not that a condition is met");
  });

  test("one bureau's unentered inquiry count makes the WHOLE total unknown, not that bureau's zero", () => {
    const out = toBureaus({
      crsResults: scoredCrs,
      tradelines: [line()],
      customFields: { crs_inquiries_ex: 3, crs_inquiries_eq: 2 } // transunion left blank
    });
    const metrics = computeUnderwrite(out.bureaus, null).metrics;
    assert.equal(metrics.inquiries.tu, null, "the blank bureau's slot is unknown, not 0");
    assert.equal(metrics.inquiries.total, null,
      "and the total refuses to add up — 3 + 2 + unknown is not 5");

    const effect = out.missing.transunion.find((m) => m.field === "inquiries").effect;
    assert.match(effect, /whole inquiry total/,
      "the sentence must say one blank bureau blanks the whole figure");
    assert.doesNotMatch(effect, /could only raise the total/,
      "there is no total to raise — it is unknown");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   THE DEMO SEED'S OWN PAYLOAD, PLANTED RAW

   Every other test in this file plants an already-flat fixture. That is what let
   a seed writing its scores into a key no reader reads ship green: the demo
   client showed score 0 and $0 funding on UnderwriteIQ and nothing failed.

   So this one takes the seed's REAL output — buildSimulatedCrsPayload(), the
   same function POST /api/demo/simulate stores — normalizes its tradelines
   through the REAL ingest normalizer, and reads the result. No database, no
   emit step, no hand-written fixture in the middle. If the seed and the reader
   ever disagree about where a score lives again, this fails.

   (The seeded open dates are 2019-2022 and only get older, so nothing here can
   drift across the engine's 24-month seasoning boundary.)
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("the demo seed writes a payload this adapter can actually read", () => {
  const payload = buildSimulatedCrsPayload({ email: "sim@demo.fundhub.local", name: "Simulated Client" });
  const crsRow = { result: payload, created_at: "2026-08-19T00:00:00Z" };
  // The real normalizer, so this proves the stored rows and not a guess at them.
  const stored = normalizeFromCrs(crsRow);

  test("all three bureau scores are where triMerge looks for them", () => {
    const scores = triMerge([crsRow]);
    assert.equal(scores.experian, 718);
    assert.equal(scores.equifax, 724);
    assert.equal(scores.transunion, 731);
    assert.equal(scores.source, "crs_results");
  });

  test("the payload never stamps itself `sandbox`", () => {
    assert.notEqual(String(payload.environment || "").toLowerCase(), "sandbox",
      "triMerge skips a sandbox row whole (src/http/client-detail.mjs:76), which would " +
      "put the demo client back at score 0 with everything else here still correct");
  });

  test("the four seeded lines normalize with a limit, a balance, a rate and an open date", () => {
    assert.equal(stored.length, 4);
    for (const row of stored) {
      assert.ok(row.credit_limit_cents > 0, `${row.lender} must carry a limit`);
      assert.ok(row.balance_cents !== null, `${row.lender} must carry a balance`);
      assert.ok(row.apr !== null, `${row.lender} must carry a rate — an unpriced line sorts last`);
      assert.match(row.opened_on, /^\d{4}-\d{2}-\d{2}$/, `${row.lender} must carry an open date`);
      assert.ok(row.account_ref, `${row.lender} must carry an account_ref or its position cannot attach`);
    }
  });

  test("planted raw, the seed produces three available bureaus and real funding", () => {
    const out = toBureaus({ tradelines: stored, crsResults: [crsRow], customFields: {} });
    assert.deepEqual(out.available, BUREAUS,
      "all three bureaus answered in the seeded pull — none may be lost on the way in");

    const underwrite = computeUnderwrite(out.bureaus, out.businessAgeMonths);
    assert.equal(underwrite.metrics.score, 731, "TransUnion is the highest of the three");
    // $25,000 is the largest seasoned open revolving limit; the engine multiplies
    // it by 5.5, and with no bureau fundable yet there is no 1/3 scaling.
    assert.equal(underwrite.totals.total_combined_funding, 412500,
      "the headline figure the demo client showed as $0");
  });
});
