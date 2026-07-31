/* The card stack's arithmetic and its presentation decisions, without a
 * database.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. Three rules, all of which have already
 * cost this repo money somewhere else:
 *
 *   1. NULL IS UNKNOWN AND MUST SURVIVE. A card with no reported limit has an
 *      unknown limit, not a zero one, and its utilization is unknown rather than
 *      0%. A total across cards where some did not report is a FLOOR and says so
 *      through basis.partial. The screen renders unknown as an em dash and a
 *      floor with a "+", and it can only do that if this module keeps the two
 *      apart all the way out.
 *
 *   2. TWO TABLES HOLD A BALANCE AND THEY DISAGREE. tradelines.balance_cents is
 *      the facility; card_liabilities.current_balance_cents is the dated billing
 *      position. Picking one silently is how the Finance OS grid and this screen
 *      end up showing one client two numbers with no explanation. Every row here
 *      names the source of its headline balance and reports the disagreement
 *      when there is one.
 *
 *   3. THE WEIGHTED APR IS COMPUTED TWICE IN THIS REPO. os-grid.mjs computes it
 *      over drawable tradelines; buildCardStack() computes it over the card
 *      stack, which can include closed cards and reads its balances elsewhere,
 *      so the first cannot simply be called by the second. The last test in this
 *      file is the drift guard: one set of rows into both modules, and the two
 *      answers must match. If somebody changes the weighting rule in one place
 *      this test is what tells them about the other.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import {
  buildCardStack, shapeCard, shapePosition, compareCards, isoDay
} from "./card-stack.mjs";
import { financeOsGrid } from "../finance/os-grid.mjs";

const card = (o = {}) => ({
  id: o.id || "t1",
  lender: o.lender || "Chase",
  kind: o.kind || "revolving",
  last4: o.last4 ?? null,
  credit_limit_cents: o.credit_limit_cents === undefined ? 1000000 : o.credit_limit_cents,
  balance_cents: o.balance_cents === undefined ? 250000 : o.balance_cents,
  apr: o.apr === undefined ? 0.1899 : o.apr,
  opened_on: o.opened_on ?? null,
  closed_at: o.closed_at ?? null,
  as_of: o.as_of ?? null,
  source: o.source || "manual"
});

const position = (o = {}) => ({
  id: o.id || "p1",
  tradeline_id: o.tradeline_id || "t1",
  as_of: o.as_of || "2026-07-01",
  current_balance_cents: o.current_balance_cents === undefined ? 300000 : o.current_balance_cents,
  statement_balance_cents: o.statement_balance_cents ?? null,
  minimum_payment_cents: o.minimum_payment_cents ?? null,
  past_due_cents: o.past_due_cents ?? null,
  last_payment_cents: o.last_payment_cents ?? null,
  last_payment_date: o.last_payment_date ?? null,
  statement_date: o.statement_date ?? null,
  payment_due_date: o.payment_due_date ?? null,
  apr: o.apr ?? null,
  payment_status: o.payment_status ?? null,
  source: o.source || "crs",
  raw: { anything: "at all" }
});

describe("unknown is not zero", () => {

  test("a card with no reported limit has an unknown limit, not a zero one", () => {
    const c = shapeCard(card({ credit_limit_cents: null }), null);
    assert.equal(c.credit_limit_cents, null);
    assert.equal(c.credit_limit, null, "an unknown limit rendered as a number");
  });

  test("utilization against an unknown limit is unknown, not 0%", () => {
    const c = shapeCard(card({ credit_limit_cents: null }), null);
    assert.equal(c.utilization, null);
    assert.equal(c.utilization_display, null);
  });

  test("utilization against a ZERO limit is unknown, not 0% — the ratio is undefined", () => {
    const c = shapeCard(card({ credit_limit_cents: 0 }), null);
    assert.equal(c.utilization, null,
      "dividing by a zero limit produced a figure; 0.0% would tell a closer this card is untouched");
  });

  test("headroom needs BOTH numbers — a limit minus an unknown balance is not headroom", () => {
    const c = shapeCard(card({ balance_cents: null }), null);
    assert.equal(c.headroom_cents, null);
    assert.equal(c.headroom, null);
  });

  test("an over-limit card offers no headroom, and does not offer negative headroom", () => {
    const c = shapeCard(card({ credit_limit_cents: 100000, balance_cents: 150000 }), null);
    assert.equal(c.headroom_cents, 0,
      "a negative headroom would cancel out another card's real headroom in the total");
  });

  test("a total over cards with holes is a FLOOR and says so", () => {
    const s = buildCardStack({
      tradelines: [
        card({ id: "a", credit_limit_cents: 1000000 }),
        card({ id: "b", credit_limit_cents: null })
      ]
    });
    const limit = s.totals.find((t) => t.key === "credit_limit");
    assert.equal(limit.display, "10000.00");
    assert.equal(limit.basis.partial, true, "a partial sum was presented as a total");
    assert.equal(limit.basis.counted, 1);
    assert.equal(limit.basis.unknown, 1);
  });

  test("a total where NOTHING was reported is unknown, not 0.00", () => {
    const s = buildCardStack({
      tradelines: [card({ id: "a", credit_limit_cents: null }), card({ id: "b", credit_limit_cents: null })]
    });
    const limit = s.totals.find((t) => t.key === "credit_limit");
    assert.equal(limit.value, null);
    assert.equal(limit.display, null,
      '"we have no idea what this client\'s limits are" must not render as $0.00');
  });

  test("a client with no cards at all totals to unknown, and to no rows", () => {
    const s = buildCardStack({ tradelines: [] });
    assert.equal(s.cards.length, 0);
    for (const t of s.totals) {
      if (t.key === "avg_apr" || t.unit === "usd") assert.equal(t.display, null, `${t.key} invented a number`);
    }
  });
});

describe("two tables hold a balance", () => {

  test("a dated position beats the undated facility figure, and the row says which", () => {
    const c = shapeCard(card({ balance_cents: 250000 }), position({ current_balance_cents: 300000 }));
    assert.equal(c.balance_cents, 300000);
    assert.equal(c.balance_source, "card_liabilities");
  });

  test("with no position at all the facility figure is used, and the row still says which", () => {
    const c = shapeCard(card({ balance_cents: 250000 }), null);
    assert.equal(c.balance_cents, 250000);
    assert.equal(c.balance_source, "tradelines",
      "the source must be named on every row, not only when the two disagree");
  });

  test("a disagreement is REPORTED with both figures and both sources, not averaged away", () => {
    const c = shapeCard(card({ balance_cents: 250000 }), position({ current_balance_cents: 300000 }));
    assert.ok(c.disagreement);
    assert.equal(c.disagreement.card_liabilities, "3000.00");
    assert.equal(c.disagreement.tradelines, "2500.00");
    assert.equal(c.disagreement.difference, "500.00");
    assert.equal(c.disagreement.as_of, "2026-07-01");
  });

  test("agreement is not a disagreement", () => {
    const c = shapeCard(card({ balance_cents: 300000 }), position({ current_balance_cents: 300000 }));
    assert.equal(c.disagreement, null);
  });

  test("a card nobody has observed is not a disagreement either — it is an absence", () => {
    const c = shapeCard(card(), null);
    assert.equal(c.disagreement, null);
    assert.equal(c.observations, 0);
  });

  test("the facility APR leads, because an old statement's rate is not today's rate", () => {
    const c = shapeCard(card({ apr: 0.1899 }), position({ apr: 0 }));
    assert.equal(c.apr, 0.1899);
    assert.equal(c.apr_source, "tradelines");
    assert.equal(c.apr_display, "18.99%");
  });

  test("with no facility rate the position's rate is used, and is labelled as such", () => {
    const c = shapeCard(card({ apr: null }), position({ apr: 0.2499 }));
    assert.equal(c.apr, 0.2499);
    assert.equal(c.apr_source, "card_liabilities");
  });
});

describe("ordering — the most expensive money first", () => {

  test("the highest rate heads the stack", () => {
    const s = buildCardStack({
      tradelines: [
        card({ id: "cheap", lender: "Amex", apr: 0.1199 }),
        card({ id: "dear", lender: "Store", apr: 0.2999 })
      ]
    });
    assert.deepEqual(s.cards.map((c) => c.tradeline_id), ["dear", "cheap"]);
  });

  test("an UNKNOWN rate sorts LAST, never first", () => {
    const s = buildCardStack({
      tradelines: [
        card({ id: "unpriced", apr: null }),
        card({ id: "priced", apr: 0.0999 })
      ]
    });
    assert.deepEqual(s.cards.map((c) => c.tradeline_id), ["priced", "unpriced"],
      '"we do not know what this costs" was presented as "this costs the most"');
  });

  test("the order is stable between two identical reads", () => {
    const rows = [
      card({ id: "a", lender: "Bravo", apr: 0.1, balance_cents: 100 }),
      card({ id: "b", lender: "Alpha", apr: 0.1, balance_cents: 100 })
    ];
    const one = buildCardStack({ tradelines: rows }).cards.map((c) => c.tradeline_id);
    const two = buildCardStack({ tradelines: [...rows].reverse() }).cards.map((c) => c.tradeline_id);
    assert.deepEqual(one, two);
  });

  test("compareCards puts a known rate ahead of an unknown one in both argument orders", () => {
    const known = { apr: 0.1, balance_cents: 0, lender: "a" };
    const unknown = { apr: null, balance_cents: 0, lender: "b" };
    assert.ok(compareCards(known, unknown) < 0);
    assert.ok(compareCards(unknown, known) > 0);
  });
});

describe("closed and installment lines are listed but not totalled", () => {

  test("a closed card stays on the stack and stays out of the totals", () => {
    const s = buildCardStack({
      tradelines: [
        card({ id: "open", credit_limit_cents: 1000000, balance_cents: 0 }),
        card({ id: "shut", credit_limit_cents: 5000000, balance_cents: 0, closed_at: "2025-01-01" })
      ]
    });
    assert.equal(s.cards.length, 2, "the closed card disappeared from the list");
    assert.equal(s.totalled, 1);
    assert.equal(s.totals.find((t) => t.key === "credit_limit").display, "10000.00",
      "a closed card's limit was added to available credit");
  });

  test("an installment line is not drawable and is not totalled", () => {
    const s = buildCardStack({
      tradelines: [
        card({ id: "card", credit_limit_cents: 1000000 }),
        card({ id: "auto", kind: "installment", credit_limit_cents: 3000000 })
      ]
    });
    assert.equal(s.totalled, 1);
    assert.equal(s.totals.find((t) => t.key === "credit_limit").display, "10000.00");
  });
});

describe("shaping a position", () => {

  test("every unknown measure stays null — none of them become zero", () => {
    const p = shapePosition(position({
      current_balance_cents: null, minimum_payment_cents: null, past_due_cents: null
    }));
    assert.equal(p.current_balance, null);
    assert.equal(p.minimum_payment, null,
      'an unknown minimum payment rendered as a figure — "no payment required" is a claim we cannot make');
    assert.equal(p.past_due, null);
  });

  test("a reported zero is NOT an unknown — the bureau affirming 'nothing past due' survives", () => {
    const p = shapePosition(position({ past_due_cents: 0 }));
    assert.equal(p.past_due_cents, 0);
    assert.equal(p.past_due, "0.00",
      "a reported zero was flattened into an unknown; they are different facts");
  });

  test("the unparsed bureau record never reaches the wire", () => {
    const p = shapePosition(position());
    assert.equal(p.raw, undefined);
  });

  test("an unrecognised payment status is not guessed at", () => {
    const p = shapePosition(position({ payment_status: null }));
    assert.equal(p.payment_status, null);
  });

  test("a Date from the driver and a string from a CTE both render as one day", () => {
    /* new Date(y, m, d) is LOCAL midnight — exactly what pg hands back for a
       `date` column, and the case toISOString() gets wrong by a day east of UTC.
       Built this way the assertion holds in every timezone, which is the point:
       a due date that renders a day early is a whole billing cycle of wrong. */
    assert.equal(isoDay(new Date(2026, 6, 1)), "2026-07-01");
    assert.equal(isoDay(new Date(2026, 0, 5)), "2026-01-05", "the month or day lost its leading zero");
    assert.equal(isoDay("2026-07-01"), "2026-07-01");
    assert.equal(isoDay("2026-07-01T12:00:00.000Z"), "2026-07-01");
    assert.equal(isoDay(null), null);
    assert.equal(isoDay(""), null);
    assert.equal(isoDay(new Date("nonsense")), null, '"Invalid Date" reached the screen');
  });

  test("pg returning bigint as a string is still money, not a hole", () => {
    const c = shapeCard(card({ credit_limit_cents: "1000000", balance_cents: "250000" }), null);
    assert.equal(c.credit_limit, "10000.00");
    assert.equal(c.headroom, "7500.00");
  });
});

/* ── THE DRIFT GUARD ───────────────────────────────────────────────────────── */

describe("the two weighted-APR implementations agree", () => {

  test("buildCardStack and financeOsGrid return the same limit-weighted APR for the same cards", () => {
    /* Open, drawable, priced by the facility and with no liability positions at
       all — the one input where the two modules are answering the SAME question
       and are therefore required to give the same answer. */
    const rows = [
      card({ id: "a", lender: "Amex", credit_limit_cents: 5000000, balance_cents: 100000, apr: 0.1199 }),
      card({ id: "b", lender: "Store", credit_limit_cents: 50000, balance_cents: 40000, apr: 0.2999 }),
      card({ id: "c", lender: "Chase", credit_limit_cents: 1000000, balance_cents: 0, apr: null })
    ];

    const stack = buildCardStack({ tradelines: rows });
    const grid = financeOsGrid(rows);

    const mine = stack.totals.find((t) => t.key === "avg_apr");
    const theirs = grid.rows.find((r) => r.key === "avg_apr");

    assert.equal(mine.value, theirs.value,
      "src/liabilities/card-stack.mjs and src/finance/os-grid.mjs now weight APR differently — " +
      "two screens are about to show one client two average rates");
    assert.equal(mine.display, theirs.display);
    assert.equal(mine.basis.partial, theirs.basis.partial,
      "one module calls this total a floor and the other calls it a figure");
    assert.equal(mine.basis.unknown, theirs.basis.unknown);
  });

  test("...and the same total credit limit and total balance, when the balances come from the same table", () => {
    const rows = [
      card({ id: "a", credit_limit_cents: 5000000, balance_cents: 100000, apr: 0.1199 }),
      card({ id: "b", credit_limit_cents: null, balance_cents: 40000, apr: 0.2999 })
    ];
    const stack = buildCardStack({ tradelines: rows });
    const grid = financeOsGrid(rows);

    for (const key of ["credit_limit", "balance"]) {
      const mine = stack.totals.find((t) => t.key === key);
      const theirs = grid.rows.find((r) => r.key === key);
      assert.equal(mine.display, theirs.display, `${key} disagrees between the card stack and Finance OS`);
      assert.equal(mine.basis.partial, theirs.basis.partial, `${key}'s floor marker disagrees`);
    }
    // "Total headroom" here and "Available credit" there are the same measure
    // under two names; the names differ because the screens read differently.
    assert.equal(
      stack.totals.find((t) => t.key === "headroom").display,
      grid.rows.find((r) => r.key === "available").display
    );
  });

  test("a card_liabilities balance IS allowed to move this screen's total away from the grid's", () => {
    /* The opposite guard: the two agreeing is required only when they are
       reading the same facts. When a dated position exists it is a better
       answer, this screen uses it, and the difference is the thing the screen
       is built to show — not a bug to be tuned away. */
    const rows = [card({ id: "a", credit_limit_cents: 1000000, balance_cents: 250000 })];
    const stack = buildCardStack({
      tradelines: rows,
      positions: [position({ tradeline_id: "a", current_balance_cents: 900000 })]
    });
    assert.equal(stack.totals.find((t) => t.key === "balance").display, "9000.00");
    assert.equal(financeOsGrid(rows).rows.find((r) => r.key === "balance").display, "2500.00");
    assert.equal(stack.disagreements, 1, "the screen must be able to say the two sources disagree");
  });
});
