// Unit tests for the cash-flow projection and the payment window.
//
// PURE TESTS. No database, no clock, no fixtures — the module under test has no
// I/O, so neither do these. Every date is written out literally so a failure
// names a day a person can look at.
//
// WHAT THESE TESTS ARE ACTUALLY FOR. The two failures this module can produce
// both cost real money: a recommended date that overdraws the account, and a
// refusal to recommend when a date was available (which pushes a card payment
// late). So the assertions are weighted heavily toward the REFUSALS and the
// BOUNDARIES, not toward the happy path — the happy path is arithmetic and it
// is the easy part.
//
// AUDIT-FINDINGS.md, lesson 5: "Mutation-test the OVER-broad direction too.
// Several tests here asserted the defect and passed happily for months." So
// wherever a rule has two sides, both sides are asserted: a bill below the
// confidence floor is unconfirmed AND a bill at the floor is confirmed; a
// payment leaving exactly zero is allowed AND one leaving a cent less is not.

import { test } from "node:test";
import assert from "node:assert";
import { project, paymentWindow, recordReminders, CashflowInputError } from "./cashflow.mjs";

const NOW = "2026-08-01";

/** A projection request with the boring parts filled in. */
function req(overrides = {}) {
  return {
    balances: [{ accountId: "acct-1", label: "Checking", balanceCents: 100_000 }],
    now: NOW,
    horizonDays: 30,
    ...overrides
  };
}

const bill = (billId, date, amountCents, extra = {}) => ({
  billId,
  label: billId,
  occurrences: [{ date, amountCents }],
  ...extra
});

const inflow = (inflowId, date, amountCents, extra = {}) => ({
  inflowId,
  label: inflowId,
  occurrences: [{ date, amountCents }],
  ...extra
});

const dayOn = (p, date) => p.days.find((d) => d.date === date);

// ═══════════════════════════════════════════════════════════════════════════
// project() — malformed input throws. It never becomes NaN cents.
// ═══════════════════════════════════════════════════════════════════════════

test("project: a missing horizon throws rather than picking one", () => {
  assert.throws(() => project(req({ horizonDays: undefined })), CashflowInputError);
});

test("project: a non-integer, zero, negative or absurd horizon throws", () => {
  for (const bad of [0, -1, 1.5, "30", NaN, Infinity, 3651, null]) {
    assert.throws(
      () => project(req({ horizonDays: bad })),
      CashflowInputError,
      `horizonDays ${JSON.stringify(bad)} should have thrown`
    );
  }
});

test("project: a horizon of exactly 1 is allowed and yields exactly one day", () => {
  const p = project(req({ horizonDays: 1 }));
  assert.equal(p.ok, true);
  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].date, NOW);
  assert.equal(p.startDate, NOW);
  assert.equal(p.endDate, NOW);
});

test("project: the maximum horizon is allowed, one past it is not", () => {
  assert.equal(project(req({ horizonDays: 3650 })).days.length, 3650);
  assert.throws(() => project(req({ horizonDays: 3651 })), CashflowInputError);
});

test("project: a missing or unparseable `now` throws", () => {
  for (const bad of [undefined, null, "", "not-a-date", "01/08/2026", "2026-8-1", {}, []]) {
    assert.throws(
      () => project(req({ now: bad })),
      CashflowInputError,
      `now ${JSON.stringify(bad)} should have thrown`
    );
  }
});

test("project: a bare number for a date is refused — an epoch is ambiguous", () => {
  assert.throws(() => project(req({ now: 1_785_000_000_000 })), CashflowInputError);
  assert.throws(() => project(req({ now: 1_785_000_000 })), CashflowInputError);
});

test("project: a date that parses but is not a real calendar day throws", () => {
  // Date.UTC would roll these forward silently. A silently-shifted due date is
  // a missed payment, so they have to be refused.
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29", "0000-01-01"]) {
    assert.throws(
      () => project(req({ now: bad })),
      CashflowInputError,
      `${bad} should have thrown`
    );
  }
});

test("project: 2024-02-29 is a real day and is accepted", () => {
  const p = project(req({ now: "2024-02-29", horizonDays: 2 }));
  assert.equal(p.ok, true);
  assert.deepEqual(p.days.map((d) => d.date), ["2024-02-29", "2024-03-01"]);
});

test("project: an Invalid Date throws", () => {
  assert.throws(() => project(req({ now: new Date("nope") })), CashflowInputError);
});

test("project: a Date object is accepted and read in UTC", () => {
  const p = project(req({ now: new Date("2026-08-01T23:30:00Z"), horizonDays: 1 }));
  assert.equal(p.days[0].date, "2026-08-01");
});

test("project: an ISO datetime is accepted and truncated to its UTC day", () => {
  const p = project(req({ now: "2026-08-01T14:05:09.123Z", horizonDays: 1 }));
  assert.equal(p.days[0].date, "2026-08-01");
});

test("project: a money value that is not integer cents throws — never NaN cents", () => {
  for (const bad of [10.5, NaN, Infinity, -Infinity, "1000", "10.50", {}, [], true, 2 ** 53]) {
    assert.throws(
      () => project(req({ balances: [{ accountId: "a", balanceCents: bad }] })),
      CashflowInputError,
      `balanceCents ${JSON.stringify(bad)} should have thrown`
    );
  }
});

test("project: a numeric string is refused, not parsed — money.mjs reads it as dollars", () => {
  // toCents("1050") is $1,050. If this module read "1050" as $10.50 the repo
  // would hold two readings of one string, a factor of 100 apart.
  let caught = null;
  try {
    project(req({ balances: [{ accountId: "a", balanceCents: "1050" }] }));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof CashflowInputError, "a numeric string must be refused");
  assert.match(caught.message, /strings are refused/);
});

test("project: balances must be an array", () => {
  assert.throws(() => project(req({ balances: "lots" })), CashflowInputError);
  assert.throws(() => project(req({ balances: 5 })), CashflowInputError);
});

test("project: a bill without an occurrences array throws — no recurrence engine here", () => {
  assert.throws(
    () => project(req({ recurringBills: [{ billId: "b", amountCents: 1000, dayOfMonth: 15 }] })),
    CashflowInputError
  );
});

test("project: a negative outflow or inflow amount throws", () => {
  assert.throws(
    () => project(req({ recurringBills: [bill("b", "2026-08-05", -1)] })),
    CashflowInputError
  );
  assert.throws(
    () => project(req({ expectedInflows: [inflow("i", "2026-08-05", -1)] })),
    CashflowInputError
  );
});

test("project: a confidence outside 0..1 or of the wrong type throws", () => {
  for (const bad of [-0.1, 1.1, 2, "high", NaN, Infinity, {}]) {
    assert.throws(
      () => project(req({ recurringBills: [bill("b", "2026-08-05", 100, { confidence: bad })] })),
      CashflowInputError,
      `confidence ${JSON.stringify(bad)} should have thrown`
    );
  }
});

test("project: a malformed thresholds bag throws", () => {
  assert.throws(() => project(req({ thresholds: "none" })), CashflowInputError);
  assert.throws(() => project(req({ thresholds: [] })), CashflowInputError);
  assert.throws(
    () => project(req({ thresholds: { confidenceFloor: 1.5 } })),
    CashflowInputError
  );
  assert.throws(
    () => project(req({ thresholds: { minBufferCents: -1 } })),
    CashflowInputError
  );
  assert.throws(
    () => project(req({ thresholds: { settlementLeadDays: -1 } })),
    CashflowInputError
  );
  assert.throws(
    () => project(req({ thresholds: { settlementLeadDays: 1.5 } })),
    CashflowInputError
  );
});

test("project: a bad asOf on a balance throws rather than being ignored", () => {
  assert.throws(
    () => project(req({ balances: [{ accountId: "a", balanceCents: 1, asOf: "yesterday" }] })),
    CashflowInputError
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// project() — refusals. Null with a stated reason, never a number.
// ═══════════════════════════════════════════════════════════════════════════

test("project: no balances at all refuses with a reason", () => {
  const p = project(req({ balances: [] }));
  assert.equal(p.ok, false);
  assert.equal(p.reason.code, "NO_BALANCES");
  assert.equal(p.days, null);
  assert.equal(p.openingBalanceCents, null);
});

test("project: an unknown balance refuses — it is NOT read as zero", () => {
  const p = project(
    req({ balances: [{ accountId: "a", label: "Checking", balanceCents: null }] })
  );
  assert.equal(p.ok, false);
  assert.equal(p.reason.code, "UNKNOWN_BALANCE");
  assert.equal(p.days, null);
  assert.equal(p.openingBalanceCents, null);
  assert.match(p.reason.message, /not zero/);
  assert.deepEqual(p.reason.details.accounts, [{ accountId: "a", label: "Checking" }]);
});

test("project: one unknown balance among several still refuses the whole projection", () => {
  // Summing only the known accounts would produce a confidently-too-low number,
  // and a window built on it would be confidently too tight.
  const p = project(
    req({
      balances: [
        { accountId: "a", balanceCents: 500_00 },
        { accountId: "b", balanceCents: null },
        { accountId: "c", balanceCents: 200_00 }
      ]
    })
  );
  assert.equal(p.ok, false);
  assert.equal(p.reason.code, "UNKNOWN_BALANCE");
  assert.equal(p.openingBalanceCents, null);
  // The known accounts are still reported, so a person can see what IS known.
  assert.equal(p.accounts.length, 3);
  assert.equal(p.accounts[1].balanceCents, null);
  assert.equal(p.accounts[1].balance, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// project() — the arithmetic, and the explanation of it.
// ═══════════════════════════════════════════════════════════════════════════

test("project: the opening balance is the sum of the accounts, in exact cents", () => {
  const p = project(
    req({
      balances: [
        { accountId: "a", balanceCents: 123_45 },
        { accountId: "b", balanceCents: 67_89 }
      ]
    })
  );
  // 12,345c + 6,789c = 19,134c. Written as plain cents, not as dollar
  // separators, because 123_45 reads like $123.45 and is 12,345 cents.
  assert.equal(p.openingBalanceCents, 19_134);
  assert.equal(p.openingBalance, "191.34");
});

test("project: day 0 is `now` and the horizon runs to the last day inclusive", () => {
  const p = project(req({ horizonDays: 3 }));
  assert.deepEqual(p.days.map((d) => d.date), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.equal(p.endDate, "2026-08-03");
  assert.deepEqual(p.days.map((d) => d.dayIndex), [0, 1, 2]);
});

test("project: the horizon crosses a month and a year boundary correctly", () => {
  const p = project(req({ now: "2026-12-30", horizonDays: 4 }));
  assert.deepEqual(
    p.days.map((d) => d.date),
    ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]
  );
});

test("project: a confirmed bill lowers both tracks on its day and stays lowered", () => {
  const p = project(
    req({
      horizonDays: 3,
      recurringBills: [bill("rent", "2026-08-02", 40_000, { confirmed: true })]
    })
  );
  assert.equal(dayOn(p, "2026-08-01").closingCents, 100_000);
  assert.equal(dayOn(p, "2026-08-02").closingCents, 60_000);
  assert.equal(dayOn(p, "2026-08-03").closingCents, 60_000);
  assert.equal(dayOn(p, "2026-08-02").worstCaseClosingCents, 60_000);
  assert.equal(dayOn(p, "2026-08-02").committedOutflowCents, 40_000);
});

test("project: every day carries the components that produced it", () => {
  const p = project(
    req({
      horizonDays: 2,
      recurringBills: [bill("rent", "2026-08-02", 40_000, { confirmed: true })],
      expectedInflows: [inflow("payroll", "2026-08-02", 250_000, { confirmed: true })]
    })
  );
  const d = dayOn(p, "2026-08-02");
  assert.equal(d.components.length, 2);
  const rent = d.components.find((c) => c.sourceId === "rent");
  assert.deepEqual(
    { direction: rent.direction, kind: rent.kind, amountCents: rent.amountCents, amount: rent.amount },
    { direction: "out", kind: "bill", amountCents: 40_000, amount: "400.00" }
  );
  const pay = d.components.find((c) => c.sourceId === "payroll");
  assert.equal(pay.direction, "in");
  assert.equal(pay.amount, "2500.00");
  // The day's totals must be reproducible from the components alone. That is
  // what "explainable" has to mean or the components are decoration.
  const outs = d.components.filter((c) => c.direction === "out").reduce((s, c) => s + c.amountCents, 0);
  const ins = d.components.filter((c) => c.direction === "in").reduce((s, c) => s + c.amountCents, 0);
  assert.equal(d.closingCents, d.openingCents + ins - outs);
});

// ═══════════════════════════════════════════════════════════════════════════
// project() — the two tracks. A low-confidence bill never becomes certain.
// ═══════════════════════════════════════════════════════════════════════════

test("project: an unconfirmed bill moves the worst case only, never the committed track", () => {
  const p = project(
    req({
      horizonDays: 2,
      recurringBills: [bill("maybe-gym", "2026-08-02", 5_000, { confidence: 0.4 })],
      thresholds: { confidenceFloor: 0.9 }
    })
  );
  const d = dayOn(p, "2026-08-02");
  assert.equal(d.closingCents, 100_000, "committed track must not move");
  assert.equal(d.worstCaseClosingCents, 95_000, "worst case must include it");
  assert.equal(d.committedOutflowCents, 0);
  assert.equal(d.unconfirmedOutflowCents, 5_000);
  assert.equal(d.components[0].certainty, "unconfirmed");
  assert.equal(p.unconfirmed.length, 1);
  assert.equal(p.unconfirmed[0].sourceId, "maybe-gym");
  assert.match(p.unconfirmed[0].reason, /below the supplied floor/);
});

test("project: a bill exactly AT the confidence floor is confirmed — the boundary both ways", () => {
  const at = project(
    req({
      horizonDays: 2,
      recurringBills: [bill("b", "2026-08-02", 5_000, { confidence: 0.9 })],
      thresholds: { confidenceFloor: 0.9 }
    })
  );
  assert.equal(dayOn(at, "2026-08-02").closingCents, 95_000);
  assert.equal(at.unconfirmed.length, 0);

  const just_below = project(
    req({
      horizonDays: 2,
      recurringBills: [bill("b", "2026-08-02", 5_000, { confidence: 0.89 })],
      thresholds: { confidenceFloor: 0.9 }
    })
  );
  assert.equal(dayOn(just_below, "2026-08-02").closingCents, 100_000);
  assert.equal(just_below.unconfirmed.length, 1);
});

test("project: a bill with NO confidence is unconfirmed — absence is not certainty", () => {
  const p = project(
    req({ horizonDays: 2, recurringBills: [bill("b", "2026-08-02", 5_000)] })
  );
  assert.equal(dayOn(p, "2026-08-02").closingCents, 100_000);
  assert.equal(dayOn(p, "2026-08-02").worstCaseClosingCents, 95_000);
  assert.match(p.unconfirmed[0].reason, /no confidence was supplied/);
  // No confidence score was involved, so no floor was needed and none is missing.
  assert.equal(p.thresholdGaps.find((g) => g.name === "confidenceFloor"), undefined);
});

test("project: a scored bill with no floor is unconfirmed AND the missing row is reported", () => {
  // The hard rule: do not pick a number. The bill is still priced in the worst
  // case, so nothing is dropped and nothing is promoted to certain.
  const p = project(
    req({ horizonDays: 2, recurringBills: [bill("b", "2026-08-02", 5_000, { confidence: 0.99 })] })
  );
  assert.equal(dayOn(p, "2026-08-02").closingCents, 100_000);
  assert.equal(dayOn(p, "2026-08-02").worstCaseClosingCents, 95_000);
  const gap = p.thresholdGaps.find((g) => g.name === "confidenceFloor");
  assert.ok(gap, "the missing confidence floor must be reported");
  assert.match(gap.note, /operator policy and needs a row/);
  assert.match(p.unconfirmed[0].reason, /cannot be classified/);
});

test("project: `confirmed: true` makes a bill certain with no threshold in sight", () => {
  const p = project(
    req({ horizonDays: 2, recurringBills: [bill("b", "2026-08-02", 5_000, { confirmed: true })] })
  );
  assert.equal(dayOn(p, "2026-08-02").closingCents, 95_000);
  assert.equal(p.unconfirmed.length, 0);
  assert.equal(p.thresholdGaps.length, 0);
});

test("project: an unconfirmed INFLOW counts in neither track", () => {
  // Asymmetry on purpose: the worst case is that expected money does not arrive
  // and expected bills do. A maybe-paycheck in the pessimistic track would make
  // the pessimistic track optimistic.
  const p = project(
    req({ horizonDays: 2, expectedInflows: [inflow("maybe-bonus", "2026-08-02", 50_000)] })
  );
  const d = dayOn(p, "2026-08-02");
  assert.equal(d.closingCents, 100_000);
  assert.equal(d.worstCaseClosingCents, 100_000);
  assert.equal(d.unconfirmedInflowCents, 50_000);
  assert.equal(d.inflowCents, 0);
});

test("project: no inflows at all is safe — the projection only falls", () => {
  const p = project(
    req({ horizonDays: 3, recurringBills: [bill("b", "2026-08-02", 5_000, { confirmed: true })] })
  );
  const closings = p.days.map((d) => d.closingCents);
  for (let i = 1; i < closings.length; i += 1) {
    assert.ok(closings[i] <= closings[i - 1], "with no inflows the balance must never rise");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// project() — card liabilities and blind spots.
// ═══════════════════════════════════════════════════════════════════════════

test("project: a card's minimum is charged on its due date as a committed outflow", () => {
  const p = project(
    req({
      horizonDays: 10,
      cardLiabilities: [
        { liabilityId: "amex", label: "Amex", dueDate: "2026-08-05", minimumPaymentCents: 3_500 }
      ]
    })
  );
  assert.deepEqual(p.blindSpots, []);
  const d = dayOn(p, "2026-08-05");
  assert.equal(d.committedOutflowCents, 3_500);
  assert.equal(d.closingCents, 96_500);
  assert.equal(d.components[0].kind, "card_minimum");
});

test("project: the statement balance is NOT charged — only the minimum", () => {
  const p = project(
    req({
      horizonDays: 10,
      cardLiabilities: [
        {
          liabilityId: "amex",
          dueDate: "2026-08-05",
          minimumPaymentCents: 3_500,
          statementBalanceCents: 250_000
        }
      ]
    })
  );
  assert.equal(dayOn(p, "2026-08-05").committedOutflowCents, 3_500);
});

test("project: a card with no due date is a BLIND SPOT, not a zero", () => {
  const p = project(
    req({ cardLiabilities: [{ liabilityId: "visa", label: "Visa", minimumPaymentCents: 2_500 }] })
  );
  assert.equal(p.ok, true);
  assert.equal(p.blindSpots.length, 1);
  assert.equal(p.blindSpots[0].sourceId, "visa");
  assert.match(p.blindSpots[0].reason, /no due date/);
});

test("project: a card with a due date but no minimum is a BLIND SPOT", () => {
  const p = project(
    req({ cardLiabilities: [{ liabilityId: "visa", label: "Visa", dueDate: "2026-08-10" }] })
  );
  assert.equal(p.blindSpots.length, 1);
  assert.match(p.blindSpots[0].reason, /unknown amount is not zero/);
  // and it charged nothing, rather than charging zero and calling it known
  assert.equal(dayOn(p, "2026-08-10").committedOutflowCents, 0);
});

test("project: a card already past due is a blind spot, not silently dropped", () => {
  const p = project(
    req({
      cardLiabilities: [
        { liabilityId: "visa", dueDate: "2026-07-20", minimumPaymentCents: 2_500 }
      ]
    })
  );
  assert.equal(p.blindSpots.length, 1);
  assert.match(p.blindSpots[0].reason, /already passed/);
});

test("project: a card due after the horizon is excluded, and that is not a blind spot", () => {
  const p = project(
    req({
      horizonDays: 5,
      cardLiabilities: [
        { liabilityId: "visa", dueDate: "2026-09-20", minimumPaymentCents: 2_500 }
      ]
    })
  );
  assert.deepEqual(p.blindSpots, []);
  assert.equal(p.excluded.length, 1);
  assert.match(p.excluded[0].reason, /after the end of the horizon/);
});

test("project: a card minimum of exactly zero is known, not a blind spot", () => {
  const p = project(
    req({
      cardLiabilities: [
        { liabilityId: "paid-off", dueDate: "2026-08-05", minimumPaymentCents: 0 }
      ]
    })
  );
  assert.deepEqual(p.blindSpots, []);
  assert.equal(dayOn(p, "2026-08-05").committedOutflowCents, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// project() — dates at the edges of the horizon.
// ═══════════════════════════════════════════════════════════════════════════

test("project: an occurrence on the first day and on the last day are both included", () => {
  const p = project(
    req({
      horizonDays: 3,
      recurringBills: [
        bill("first", "2026-08-01", 1_000, { confirmed: true }),
        bill("last", "2026-08-03", 2_000, { confirmed: true })
      ]
    })
  );
  assert.deepEqual(p.excluded, []);
  assert.equal(dayOn(p, "2026-08-01").committedOutflowCents, 1_000);
  assert.equal(dayOn(p, "2026-08-03").committedOutflowCents, 2_000);
  assert.equal(p.days[2].closingCents, 97_000);
});

test("project: one day either side of the horizon is excluded with a reason", () => {
  const p = project(
    req({
      horizonDays: 3,
      recurringBills: [
        bill("yesterday", "2026-07-31", 1_000, { confirmed: true }),
        bill("tomorrow", "2026-08-04", 2_000, { confirmed: true })
      ]
    })
  );
  assert.equal(p.excluded.length, 2);
  assert.match(
    p.excluded.find((e) => e.sourceId === "yesterday").reason,
    /before the projection starts/
  );
  assert.match(
    p.excluded.find((e) => e.sourceId === "tomorrow").reason,
    /after the end of the horizon/
  );
  assert.equal(p.days[2].closingCents, 100_000, "neither may touch the balance");
});

test("project: the lowest points of both tracks are found and dated", () => {
  const p = project(
    req({
      horizonDays: 5,
      recurringBills: [
        bill("big", "2026-08-03", 90_000, { confirmed: true }),
        bill("maybe", "2026-08-04", 5_000)
      ],
      expectedInflows: [inflow("pay", "2026-08-05", 200_000, { confirmed: true })]
    })
  );
  assert.equal(p.lowestClosingCents, 10_000);
  assert.equal(p.lowestClosingDate, "2026-08-03");
  assert.equal(p.lowestWorstCaseClosingCents, 5_000);
  assert.equal(p.lowestWorstCaseClosingDate, "2026-08-04");
});

test("project: a projection that goes below zero says so on the day", () => {
  const p = project(
    req({ horizonDays: 3, recurringBills: [bill("huge", "2026-08-02", 150_000, { confirmed: true })] })
  );
  assert.equal(dayOn(p, "2026-08-02").belowZero, true);
  assert.equal(dayOn(p, "2026-08-02").closingCents, -50_000);
  assert.equal(dayOn(p, "2026-08-02").closingBalance, "-500.00");
  assert.equal(dayOn(p, "2026-08-01").belowZero, false);
});

test("project: cents stay exact across many odd additions — no float drift", () => {
  const occurrences = [];
  for (let i = 0; i < 100; i += 1) {
    occurrences.push({ date: "2026-08-02", amountCents: 1 });
  }
  const p = project(
    req({
      horizonDays: 3,
      balances: [{ accountId: "a", balanceCents: 3 }],
      recurringBills: [{ billId: "pennies", occurrences, confirmed: true }]
    })
  );
  assert.equal(dayOn(p, "2026-08-02").closingCents, -97);
  assert.equal(dayOn(p, "2026-08-02").closingBalance, "-0.97");
});

// ═══════════════════════════════════════════════════════════════════════════
// paymentWindow() — refusals. This is the part that stops an overdraft.
// ═══════════════════════════════════════════════════════════════════════════

test("paymentWindow: no due date returns null with a stated reason", () => {
  const p = project(req());
  const w = paymentWindow({ projectedBalances: p, minimumPaymentCents: 3_500 });
  assert.equal(w.ok, false);
  assert.equal(w.recommendedDate, null);
  assert.equal(w.earliestDate, null);
  assert.equal(w.latestDate, null);
  assert.equal(w.reason.code, "MISSING_DUE_DATE");
  assert.match(w.reason.message, /no due date/);
  assert.equal(w.reason.details.field, "dueDate");
});

test("paymentWindow: a missing projection refuses", () => {
  for (const bad of [null, undefined]) {
    const w = paymentWindow({ projectedBalances: bad, dueDate: "2026-08-20", minimumPaymentCents: 1 });
    assert.equal(w.ok, false);
    assert.equal(w.reason.code, "PROJECTION_UNAVAILABLE");
  }
});

test("paymentWindow: a refused projection carries its reason through", () => {
  const p = project(req({ balances: [{ accountId: "a", balanceCents: null }] }));
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", minimumPaymentCents: 1 });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "PROJECTION_UNAVAILABLE");
  assert.equal(w.reason.details.projectionReason.code, "UNKNOWN_BALANCE");
  assert.equal(w.recommendedDate, null);
});

test("paymentWindow: a blind spot refuses the window outright", () => {
  // The whole point. An obligation of unknown size makes every date a guess.
  const p = project(
    req({
      cardLiabilities: [
        { liabilityId: "amex", label: "Amex", dueDate: "2026-08-20", minimumPaymentCents: 3_500 },
        { liabilityId: "visa", label: "Visa", dueDate: "2026-08-15" }
      ]
    })
  );
  assert.equal(p.blindSpots.length, 1);
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "PROJECTION_HAS_BLIND_SPOTS");
  assert.equal(w.recommendedDate, null);
  assert.match(w.reason.message, /would be a guess/);
  assert.equal(w.reason.details.blindSpots[0].label, "Visa");
});

test("paymentWindow: no payment amount of any kind refuses", () => {
  const p = project(req());
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20" });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "UNKNOWN_PAYMENT_AMOUNT");
  assert.match(w.reason.message, /unknown amount is not zero/);
});

test("paymentWindow: a due date already past refuses", () => {
  const p = project(req());
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-07-25",
    now: NOW,
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "DUE_DATE_IN_PAST");
});

test("paymentWindow: a due date past the end of the horizon refuses", () => {
  const p = project(req({ horizonDays: 5 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-09-15",
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "DUE_DATE_BEYOND_HORIZON");
  assert.equal(w.reason.details.horizonEnds, "2026-08-05");
});

test("paymentWindow: a due date on the very last projected day is allowed", () => {
  const p = project(req({ horizonDays: 5 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-05",
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, true);
  assert.equal(w.latestDate, "2026-08-05");
});

test("paymentWindow: a statement that closes after the due date refuses", () => {
  const p = project(req());
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    statementClose: "2026-08-11",
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "STATEMENT_CLOSE_AFTER_DUE_DATE");
});

test("paymentWindow: a statement closing exactly on the due date is allowed", () => {
  const p = project(req());
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    statementClose: "2026-08-10",
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, true);
  assert.equal(w.earliestDate, "2026-08-10");
});

test("paymentWindow: a payment that would overdraw on every date is REFUSED", () => {
  const p = project(
    req({
      horizonDays: 10,
      balances: [{ accountId: "a", balanceCents: 20_000 }]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-08",
    paymentAmountCents: 50_000
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "WOULD_OVERDRAW");
  assert.equal(w.recommendedDate, null);
  assert.equal(w.earliestDate, null);
  assert.equal(w.reason.details.shortfallCents, 30_000);
  assert.equal(w.reason.details.shortfall, "300.00");
  assert.ok(w.candidates.length > 0, "the refusal still shows its working");
  assert.ok(w.candidates.every((c) => c.feasible === false));
});

test("paymentWindow: the window opening after the due date refuses", () => {
  const p = project(req({ now: "2026-08-10", horizonDays: 10 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-05",
    now: "2026-08-01",
    minimumPaymentCents: 1_000
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "NO_CANDIDATE_DATES");
});

// ═══════════════════════════════════════════════════════════════════════════
// paymentWindow() — the window itself.
// ═══════════════════════════════════════════════════════════════════════════

test("paymentWindow: an affordable payment yields a window ending at the due date", () => {
  const p = project(req({ horizonDays: 20 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-15",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.ok, true);
  assert.equal(w.earliestDate, "2026-08-01");
  assert.equal(w.latestDate, "2026-08-15");
  assert.equal(w.recommendedDate, "2026-08-15", "the latest feasible date keeps cash longest");
  assert.equal(w.amountCents, 3_500);
  assert.equal(w.amount, "35.00");
  assert.equal(w.amountBasis, "minimum");
});

test("paymentWindow: an explicit amount beats the minimum and says so", () => {
  const p = project(req({ horizonDays: 20 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-15",
    minimumPaymentCents: 3_500,
    paymentAmountCents: 90_000
  });
  assert.equal(w.amountCents, 90_000);
  assert.equal(w.amountBasis, "explicit");
});

test("paymentWindow: feasibility looks at the WHOLE tail, not just the payment day", () => {
  // $1,000 today, rent of $900 on the 10th. Paying $500 on the 2nd looks fine
  // on the 2nd and overdraws on the 10th. A module that checked only the
  // payment day would clear it. That is the overdraft this exists to stop.
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 100_000 }],
      recurringBills: [bill("rent", "2026-08-10", 90_000, { confirmed: true })]
    })
  );
  assert.equal(dayOn(p, "2026-08-02").closingCents, 100_000);
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-08",
    paymentAmountCents: 50_000
  });
  assert.equal(w.ok, false, "must refuse: the 10th goes to -$400");
  assert.equal(w.reason.code, "WOULD_OVERDRAW");
  assert.equal(w.reason.details.shortfallCents, 40_000);
});

test("paymentWindow: a payment leaving exactly zero is allowed; one cent more is not", () => {
  const exact = paymentWindow({
    projectedBalances: project(req({ horizonDays: 10, balances: [{ accountId: "a", balanceCents: 50_000 }] })),
    dueDate: "2026-08-05",
    paymentAmountCents: 50_000
  });
  assert.equal(exact.ok, true, "landing on exactly zero is not below zero");
  assert.equal(exact.candidates[0].lowestBalanceAfterPaymentCents, 0);

  const overBy1 = paymentWindow({
    projectedBalances: project(req({ horizonDays: 10, balances: [{ accountId: "a", balanceCents: 50_000 }] })),
    dueDate: "2026-08-05",
    paymentAmountCents: 50_001
  });
  assert.equal(overBy1.ok, false);
  assert.equal(overBy1.reason.details.shortfallCents, 1);
});

test("paymentWindow: an unconfirmed bill narrows the window — the pessimistic track rules", () => {
  const bills = [bill("maybe", "2026-08-06", 60_000)];
  const p = project(
    req({ horizonDays: 15, balances: [{ accountId: "a", balanceCents: 100_000 }], recurringBills: bills })
  );
  // The committed track never dips below $1,000 all month.
  assert.equal(p.lowestClosingCents, 100_000);
  // The worst case dips to $400.
  assert.equal(p.lowestWorstCaseClosingCents, 40_000);

  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 50_000
  });
  assert.equal(w.ok, false, "a $500 payment must be refused while a maybe-$600 bill is outstanding");
  assert.equal(w.reason.code, "WOULD_OVERDRAW");
  assert.equal(w.reason.details.shortfallCents, 10_000);
});

test("paymentWindow: confirming that same bill re-opens the window when it fits", () => {
  const p = project(
    req({
      horizonDays: 15,
      balances: [{ accountId: "a", balanceCents: 200_000 }],
      recurringBills: [bill("known", "2026-08-06", 60_000, { confirmed: true })]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 50_000
  });
  assert.equal(w.ok, true);
  assert.equal(w.recommendedDate, "2026-08-10");
});

test("paymentWindow: the window opens at the statement close, not before it", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-25",
    statementClose: "2026-08-05",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.ok, true);
  assert.equal(w.earliestDate, "2026-08-05");
  assert.equal(w.statementCloseKnown, true);
  assert.ok(
    !w.notes.some((n) => /may not settle the statement balance/.test(n)),
    "a known close date must not raise the unknown-close note"
  );
});

test("paymentWindow: no statement close is flagged in a note rather than guessed", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-25",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.statementCloseKnown, false);
  assert.ok(w.notes.some((n) => /may not settle the statement balance/.test(n)));
});

test("paymentWindow: the recommendation landing on the due date is flagged as slackless", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-25",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.recommendedDate, "2026-08-25");
  assert.ok(w.notes.some((n) => /no slack/.test(n)));
});

// ═══════════════════════════════════════════════════════════════════════════
// paymentWindow() — thresholds are rows. Absences are reported, never filled.
// ═══════════════════════════════════════════════════════════════════════════

test("paymentWindow: with no buffer row the floor is the zero the task states, and the gap is reported", () => {
  const p = project(req({ horizonDays: 10 }));
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-05", minimumPaymentCents: 1 });
  assert.equal(w.floorCents, 0);
  assert.equal(w.floorSource, "spec-zero");
  const gap = w.thresholdGaps.find((g) => g.name === "minBufferCents");
  assert.ok(gap, "the missing buffer row must be reported");
  assert.match(gap.note, /needs a row/);
});

test("paymentWindow: a supplied buffer raises the floor and binds", () => {
  const base = () => project(req({ horizonDays: 10, balances: [{ accountId: "a", balanceCents: 50_000 }] }));
  const noBuffer = paymentWindow({
    projectedBalances: base(),
    dueDate: "2026-08-05",
    paymentAmountCents: 50_000
  });
  assert.equal(noBuffer.ok, true);

  const withBuffer = paymentWindow({
    projectedBalances: base(),
    dueDate: "2026-08-05",
    paymentAmountCents: 50_000,
    thresholds: { minBufferCents: 10_000 }
  });
  assert.equal(withBuffer.ok, false);
  assert.equal(withBuffer.floorCents, 10_000);
  assert.equal(withBuffer.floorSource, "buffer-supplied");
  assert.equal(withBuffer.reason.details.shortfallCents, 10_000);
  assert.equal(withBuffer.thresholdGaps.find((g) => g.name === "minBufferCents"), undefined);
});

test("paymentWindow: a payment landing exactly ON the buffer is allowed", () => {
  const w = paymentWindow({
    projectedBalances: project(req({ horizonDays: 10, balances: [{ accountId: "a", balanceCents: 60_000 }] })),
    dueDate: "2026-08-05",
    paymentAmountCents: 50_000,
    thresholds: { minBufferCents: 10_000 }
  });
  assert.equal(w.ok, true);
  assert.equal(w.candidates[0].lowestBalanceAfterPaymentCents, 10_000);
});

test("paymentWindow: with no settlement lead row it will not say when to START the payment", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-25",
    minimumPaymentCents: 3_500
  });
  assert.equal(w.ok, true);
  assert.equal(w.recommendedDate, "2026-08-25");
  assert.equal(w.initiateByDate, null, "no lead-time row means no initiate-by date");
  assert.equal(w.initiateByReason.code, "MISSING_SETTLEMENT_LEAD_TIME");
  assert.ok(w.thresholdGaps.some((g) => g.name === "settlementLeadDays"));
});

test("paymentWindow: a supplied settlement lead gives an initiate-by date", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-25",
    minimumPaymentCents: 3_500,
    thresholds: { settlementLeadDays: 3 }
  });
  assert.equal(w.initiateByDate, "2026-08-22");
  assert.equal(w.initiateByReason, null);
  assert.equal(w.thresholdGaps.find((g) => g.name === "settlementLeadDays"), undefined);
});

test("paymentWindow: a zero settlement lead is a decision and is honoured", () => {
  const w = paymentWindow({
    projectedBalances: project(req({ horizonDays: 30 })),
    dueDate: "2026-08-25",
    minimumPaymentCents: 3_500,
    thresholds: { settlementLeadDays: 0 }
  });
  assert.equal(w.initiateByDate, "2026-08-25");
});

test("paymentWindow: a projection's threshold gaps surface on the window too", () => {
  const p = project(
    req({ horizonDays: 30, recurringBills: [bill("b", "2026-08-04", 100, { confidence: 0.5 })] })
  );
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-25", minimumPaymentCents: 1 });
  assert.ok(w.thresholdGaps.some((g) => g.name === "confidenceFloor"));
});

// ═══════════════════════════════════════════════════════════════════════════
// paymentWindow() — the double-count trap.
// ═══════════════════════════════════════════════════════════════════════════

test("paymentWindow: without excludeSourceIds the card's own minimum is counted twice", () => {
  // This test documents the trap rather than a defect: project() correctly
  // charges the minimum on the due date, so a caller asking "when do I pay this
  // card" must say which components are that card. Left in because a future
  // reader WILL wonder why excludeSourceIds exists.
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 60_000 }],
      cardLiabilities: [
        { liabilityId: "amex", dueDate: "2026-08-10", minimumPaymentCents: 35_000 }
      ]
    })
  );
  const doubled = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 35_000
  });
  assert.equal(doubled.ok, false, "$350 charged twice against $600 overdraws");

  const correct = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 35_000,
    excludeSourceIds: ["amex"]
  });
  assert.equal(correct.ok, true, "excluding the card's own component clears it");
  assert.equal(correct.recommendedDate, "2026-08-10");
  assert.equal(correct.candidates.at(-1).lowestBalanceAfterPaymentCents, 25_000);
});

test("paymentWindow: excluding a card must not start counting maybe-money as arrived", () => {
  // excludeSourceIds recomputes the pessimistic balance on a separate path, and
  // that path has to keep the same rule as the main one: an unconfirmed inflow
  // is worth nothing. If it started counting, a maybe-paycheck would rescue a
  // payment that genuinely overdraws.
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 60_000 }],
      cardLiabilities: [
        { liabilityId: "amex", dueDate: "2026-08-10", minimumPaymentCents: 1_000 }
      ],
      expectedInflows: [inflow("maybe-bonus", "2026-08-02", 100_000)]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 100_000,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.ok, false, "a maybe-bonus must not clear a $1,000 payment against $600");
  assert.equal(w.reason.code, "WOULD_OVERDRAW");
  assert.equal(w.reason.details.shortfallCents, 40_000);
});

test("paymentWindow: excluding a card still counts CONFIRMED inflows on that path", () => {
  // The other side of the same rule, so the fix above cannot be "ignore every
  // inflow", which would refuse dates that were genuinely fine.
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 60_000 }],
      cardLiabilities: [
        { liabilityId: "amex", dueDate: "2026-08-10", minimumPaymentCents: 1_000 }
      ],
      expectedInflows: [inflow("payroll", "2026-08-02", 100_000, { confirmed: true })]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 100_000,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.ok, true);
  assert.equal(w.earliestDate, "2026-08-02", "not payable until the confirmed money lands");
  assert.equal(w.latestDate, "2026-08-10");
});

test("paymentWindow: excluding one card leaves every OTHER card still charged", () => {
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 60_000 }],
      cardLiabilities: [
        { liabilityId: "amex", dueDate: "2026-08-10", minimumPaymentCents: 35_000 },
        { liabilityId: "visa", dueDate: "2026-08-12", minimumPaymentCents: 30_000 }
      ]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-10",
    paymentAmountCents: 35_000,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.ok, false, "the Visa minimum on the 12th must still bind");
  assert.equal(w.reason.details.shortfallCents, 5_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// paymentWindow() — the plain-array input.
// ═══════════════════════════════════════════════════════════════════════════

test("paymentWindow: a plain [{date, closingCents}] array works", () => {
  const w = paymentWindow({
    projectedBalances: [
      { date: "2026-08-01", closingCents: 100_000 },
      { date: "2026-08-02", closingCents: 90_000 },
      { date: "2026-08-03", closingCents: 80_000 }
    ],
    dueDate: "2026-08-03",
    paymentAmountCents: 80_000
  });
  assert.equal(w.ok, true);
  assert.equal(w.recommendedDate, "2026-08-03");
});

test("paymentWindow: a plain array with a gap in the dates throws, not misreads", () => {
  assert.throws(
    () =>
      paymentWindow({
        projectedBalances: [
          { date: "2026-08-01", closingCents: 100_000 },
          { date: "2026-08-03", closingCents: 80_000 }
        ],
        dueDate: "2026-08-03",
        paymentAmountCents: 1
      }),
    CashflowInputError
  );
});

test("paymentWindow: excludeSourceIds against a plain array throws — nothing to exclude", () => {
  assert.throws(
    () =>
      paymentWindow({
        projectedBalances: [{ date: "2026-08-01", closingCents: 100_000 }],
        dueDate: "2026-08-01",
        paymentAmountCents: 1,
        excludeSourceIds: ["amex"]
      }),
    CashflowInputError
  );
});

test("paymentWindow: a plain array with garbage cents throws", () => {
  assert.throws(
    () =>
      paymentWindow({
        projectedBalances: [{ date: "2026-08-01", closingCents: "100000" }],
        dueDate: "2026-08-01",
        paymentAmountCents: 1
      }),
    CashflowInputError
  );
});

test("paymentWindow: an empty projection refuses rather than dividing by nothing", () => {
  const w = paymentWindow({
    projectedBalances: [],
    dueDate: "2026-08-01",
    paymentAmountCents: 1
  });
  assert.equal(w.ok, false);
  assert.equal(w.reason.code, "PROJECTION_UNAVAILABLE");
});

test("paymentWindow: a garbage projection type throws", () => {
  for (const bad of ["projection", 42, true]) {
    assert.throws(
      () => paymentWindow({ projectedBalances: bad, dueDate: "2026-08-01", paymentAmountCents: 1 }),
      CashflowInputError
    );
  }
});

test("paymentWindow: a malformed payment amount throws rather than becoming NaN cents", () => {
  const p = project(req());
  for (const bad of [10.5, NaN, Infinity, "3500", -1]) {
    assert.throws(
      () => paymentWindow({ projectedBalances: p, dueDate: "2026-08-10", paymentAmountCents: bad }),
      CashflowInputError,
      `paymentAmountCents ${JSON.stringify(bad)} should have thrown`
    );
  }
});

test("paymentWindow: every candidate date carries its own working", () => {
  const p = project(
    req({
      horizonDays: 20,
      balances: [{ accountId: "a", balanceCents: 100_000 }],
      recurringBills: [bill("rent", "2026-08-06", 80_000, { confirmed: true })]
    })
  );
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-05",
    paymentAmountCents: 15_000
  });
  assert.equal(w.ok, true);
  assert.equal(w.candidates.length, 5);
  for (const c of w.candidates) {
    assert.equal(typeof c.date, "string");
    assert.equal(typeof c.lowestBalanceAfterPaymentCents, "number");
    assert.equal(c.feasible, true);
    // $1,000 - $800 rent - $150 payment = $50 left at the low point, every date.
    assert.equal(c.lowestBalanceAfterPaymentCents, 5_000);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// recordReminders() — turning findings into rows. Still pure; still sends
// nothing. The rows are handed to src/banking/reminders.mjs to be stored.
// ═══════════════════════════════════════════════════════════════════════════

const card = (over = {}) => ({
  liabilityId: "amex",
  label: "Amex Blue Business",
  dueDate: "2026-08-20",
  minimumPaymentCents: 3_500,
  ...over
});

test("recordReminders: a missing or malformed projection throws", () => {
  for (const bad of [undefined, null, "projection", 42, []]) {
    assert.throws(() => recordReminders({ projection: bad }), CashflowInputError);
  }
});

test("recordReminders: a refused projection produces no rows and says why", () => {
  const p = project(req({ balances: [{ accountId: "a", balanceCents: null }] }));
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  assert.deepEqual(out.reminders, []);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].reminderKind, "input_missing");
  assert.match(out.skipped[0].reason, /UNKNOWN_BALANCE/);
});

test("recordReminders: a blind spot becomes an input_missing row against that card", () => {
  const p = project(req({ cardLiabilities: [card({ minimumPaymentCents: undefined })] }));
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  assert.equal(out.reminders.length, 1);
  const r = out.reminders[0];
  assert.equal(r.reminderKind, "input_missing");
  assert.equal(r.subjectKind, "card_liability");
  assert.equal(r.subjectId, "amex");
  assert.equal(r.subjectLabel, "Amex Blue Business");
  assert.equal(r.orgId, "o");
  assert.equal(r.clientId, "c");
  assert.equal(r.surfaceAt, "2026-08-01T00:00:00.000Z", "an unknown fact surfaces now");
  assert.match(r.body, /no payment date is being estimated/);
});

test("recordReminders: a projected shortfall is attributed to the largest outflow that day", () => {
  const p = project(
    req({
      horizonDays: 10,
      balances: [{ accountId: "a", balanceCents: 10_000 }],
      recurringBills: [
        bill("small", "2026-08-03", 2_000, { confirmed: true }),
        bill("rent", "2026-08-03", 50_000, { confirmed: true })
      ]
    })
  );
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  const short = out.reminders.find((r) => r.reminderKind === "projected_shortfall");
  assert.ok(short, "a below-zero projection must produce a shortfall reminder");
  assert.equal(short.subjectKind, "recurring_bill");
  assert.equal(short.subjectId, "rent", "the biggest outflow, not the first one");
  assert.match(short.body, /-420\.00/);
  assert.match(short.body, /estimate/i);
});

test("recordReminders: a shortfall with nothing leaving that day is skipped, not guessed at", () => {
  // The account was already short before anything moved. There is no card or
  // bill to attribute it to and `subject_kind` has no third value.
  const p = project(req({ balances: [{ accountId: "a", balanceCents: -5_000 }], horizonDays: 3 }));
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  assert.deepEqual(out.reminders, []);
  const skip = out.skipped.find((s) => s.reminderKind === "projected_shortfall");
  assert.ok(skip);
  assert.match(skip.reason, /nothing leaves the account/);
});

test("recordReminders: an unconfirmed bill can trigger a shortfall — the worst case counts", () => {
  const p = project(
    req({
      horizonDays: 10,
      balances: [{ accountId: "a", balanceCents: 10_000 }],
      recurringBills: [bill("maybe", "2026-08-03", 50_000)]
    })
  );
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  assert.ok(out.reminders.some((r) => r.reminderKind === "projected_shortfall"));
});

test("recordReminders: with no window, only projection-level findings are produced", () => {
  const p = project(req({ cardLiabilities: [card()] }));
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p });
  assert.deepEqual(out.reminders, []);
  assert.deepEqual(out.skipped, []);
});

test("recordReminders: a window with no named subject is skipped, not attributed to a guess", () => {
  const p = project(req({ horizonDays: 30 }));
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", minimumPaymentCents: 3_500 });
  const out = recordReminders({ orgId: "o", clientId: "c", projection: p, window: w });
  assert.deepEqual(out.reminders, []);
  assert.match(out.skipped.find((s) => s.reminderKind === "payment_due").reason, /no subject card was named/);
});

test("recordReminders: a good window becomes a payment_due row on the recommended date", () => {
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.ok, true);
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const due = out.reminders.find((r) => r.reminderKind === "payment_due");
  assert.ok(due);
  assert.equal(due.surfaceAt, "2026-08-20T00:00:00.000Z");
  assert.equal(due.subjectKind, "card_liability");
  assert.match(due.body, /Estimated best date/);
  assert.match(due.body, /\$?35\.00/);
});

test("recordReminders: a refused window still produces a row — silence is the wrong answer", () => {
  const p = project(req({ horizonDays: 30, balances: [{ accountId: "a", balanceCents: 100 }] }));
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", paymentAmountCents: 500_000 });
  assert.equal(w.ok, false);
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const miss = out.reminders.find((r) => r.reminderKind === "input_missing");
  assert.ok(miss, "a window we could not compute must still reach a person");
  assert.match(miss.body, /cannot estimate a safe payment date/i);
  assert.equal(miss.surfaceAt, "2026-08-01T00:00:00.000Z");
});

test("recordReminders: a statement close in the future becomes a row on that date", () => {
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    statementClose: "2026-08-05",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business", statementClose: "2026-08-05" }
  });
  const closed = out.reminders.find((r) => r.reminderKind === "statement_closed");
  assert.ok(closed);
  assert.equal(closed.surfaceAt, "2026-08-05T00:00:00.000Z");
});

test("recordReminders: a statement that closed before today is not announced", () => {
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business", statementClose: "2026-07-25" }
  });
  assert.equal(out.reminders.find((r) => r.reminderKind === "statement_closed"), undefined);
});

test("recordReminders: payment_window_closing is never emitted, and the reason is stated", () => {
  // Paying later is never worse than paying earlier, so the safe window always
  // ends on the due date. There is no earlier last-safe-day to warn about.
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.latestDate, "2026-08-20", "the window always runs to the due date");
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  assert.equal(out.reminders.find((r) => r.reminderKind === "payment_window_closing"), undefined);
  assert.match(
    out.skipped.find((s) => s.reminderKind === "payment_window_closing").reason,
    /paying later is never worse/
  );
});

test("recordReminders: missing threshold rows surface on the output", () => {
  const p = project(
    req({ horizonDays: 30, recurringBills: [bill("b", "2026-08-04", 100, { confidence: 0.5 })] })
  );
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", minimumPaymentCents: 1 });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex" }
  });
  const names = out.thresholdGaps.map((g) => g.name).sort();
  assert.deepEqual(names, ["confidenceFloor", "minBufferCents", "settlementLeadDays"]);
});

test("recordReminders: every row is shaped for createReminder, with no extra keys", () => {
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business", statementClose: "2026-08-05" }
  });
  assert.ok(out.reminders.length >= 2);
  const expected = [
    "orgId",
    "clientId",
    "subjectKind",
    "subjectId",
    "subjectLabel",
    "reminderKind",
    "body",
    "surfaceAt"
  ].sort();
  for (const r of out.reminders) {
    assert.deepEqual(Object.keys(r).sort(), expected, JSON.stringify(r));
    assert.equal(typeof r.body, "string");
    assert.ok(r.body.trim().length > 0, "the database refuses an empty body");
    assert.ok(["card_liability", "recurring_bill"].includes(r.subjectKind));
    assert.match(r.surfaceAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  }
});

test("COMPLIANCE: every figure quoted to a client is marked as an estimate", () => {
  // A regulated consumer-finance product must not present a projection as a
  // fact. This asserts the wording rule the module header commits to, so it
  // cannot be edited out for brevity without the suite failing.
  const p = project(
    req({
      horizonDays: 30,
      balances: [{ accountId: "a", balanceCents: 10_000 }],
      cardLiabilities: [card()],
      recurringBills: [bill("rent", "2026-08-03", 50_000, { confirmed: true })]
    })
  );
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", minimumPaymentCents: 3_500 });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business", statementClose: "2026-08-05" }
  });
  assert.ok(out.reminders.length > 0);
  for (const r of out.reminders) {
    if (/\d+\.\d{2}/.test(r.body)) {
      assert.match(
        r.body,
        /estimat|projected/i,
        `a body quoting a figure must say it is an estimate: ${r.body}`
      );
    }
  }
});

test("COMPLIANCE: no reminder claims anything about credit scores or outcomes", () => {
  // Never draft customer-facing claims about credit outcomes. These sentences
  // describe arithmetic and absence, and nothing else.
  const p = project(
    req({
      horizonDays: 30,
      balances: [{ accountId: "a", balanceCents: 10_000 }],
      cardLiabilities: [card(), card({ liabilityId: "visa", label: "Visa", minimumPaymentCents: undefined })],
      recurringBills: [bill("rent", "2026-08-03", 50_000, { confirmed: true })]
    })
  );
  const w = paymentWindow({ projectedBalances: p, dueDate: "2026-08-20", minimumPaymentCents: 3_500 });
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const forbidden = /credit score|fico|vantage|improve your credit|boost|guarantee|will raise|will increase your|repair your credit|remove.*from your report/i;
  for (const r of out.reminders) {
    assert.doesNotMatch(r.body, forbidden, `body makes a credit claim: ${r.body}`);
  }
});

test("recordReminders: with a settlement lead, the payment reminder surfaces on the START date", () => {
  // A reminder that arrives on the day the money must LAND is a reminder that
  // arrives too late to act on. With a lead time known, it moves earlier.
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"],
    thresholds: { settlementLeadDays: 3 }
  });
  assert.equal(w.initiateByDate, "2026-08-17");
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const due = out.reminders.find((r) => r.reminderKind === "payment_due");
  assert.equal(due.surfaceAt, "2026-08-17T00:00:00.000Z", "three days before it must land");
  assert.match(due.body, /Start the payment/);
  assert.match(due.body, /by 2026-08-17/);
  assert.match(due.body, /lands by the estimated best date of 2026-08-20/);
});

test("recordReminders: with NO settlement lead, it says plainly that the date is a landing date", () => {
  const p = project(req({ horizonDays: 30, cardLiabilities: [card()] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"]
  });
  assert.equal(w.initiateByDate, null);
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const due = out.reminders.find((r) => r.reminderKind === "payment_due");
  assert.equal(due.surfaceAt, "2026-08-20T00:00:00.000Z");
  assert.match(due.body, /to LAND is 2026-08-20/);
  assert.match(due.body, /not recorded in this system/, "it must not imply a same-day post");
  assert.doesNotMatch(due.body, /Start the payment/);
});

test("recordReminders: a lead time longer than the window still lands on a real date", () => {
  // Boundary: a 10-day lead against a window that opens today. The start date
  // can legitimately fall before the window opens — that is information, not an
  // error, and it must not silently clamp to today and lose the warning.
  const p = project(req({ horizonDays: 30, cardLiabilities: [card({ dueDate: "2026-08-05" })] }));
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-05",
    minimumPaymentCents: 3_500,
    excludeSourceIds: ["amex"],
    thresholds: { settlementLeadDays: 10 }
  });
  assert.equal(w.initiateByDate, "2026-07-26", "ten days before the 5th, even though that is in the past");
  const out = recordReminders({
    orgId: "o",
    clientId: "c",
    projection: p,
    window: w,
    subject: { subjectId: "amex", subjectLabel: "Amex Blue Business" }
  });
  const due = out.reminders.find((r) => r.reminderKind === "payment_due");
  assert.equal(due.surfaceAt, "2026-07-26T00:00:00.000Z");
});
