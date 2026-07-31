// Unit tests for cash-flow projection and payment timing. Pure, no database.
//
// paymentWindow() tells a person when to move their money. So the tests that
// matter most are not the ones proving it computes a window — they are the ones
// proving it REFUSES to, and names why, in every case where the inputs do not
// support an answer. A date invented to fill a gap is a wrong instruction about
// money delivered with the same confidence as a right one.

import { test } from "node:test";
import assert from "node:assert";
import {
  project, paymentWindow, buildReminders, recordReminders,
  WINDOW_REASONS, WINDOW_REASON_TEXT, dayNumber, isoDate
} from "./cashflow.mjs";

const TODAY = "2026-07-01";
const money = (d) => Math.round(d * 100);

/* ------------------------------- dayNumber -------------------------------- */

test("dayNumber refuses what new Date() would accept", () => {
  assert.equal(dayNumber("2026"), null);
  assert.equal(dayNumber("07/01"), null);
  assert.equal(dayNumber("2026-02-30"), null);
  assert.equal(dayNumber("soon"), null);
  assert.equal(dayNumber(null), null);
  assert.ok(dayNumber("2026-07-01") != null);
});

test("isoDate round-trips a day number", () => {
  assert.equal(isoDate(dayNumber("2026-07-01")), "2026-07-01");
});

/* -------------------------------- project --------------------------------- */

test("a projection runs the balance forward day by day", () => {
  const p = project({
    openingBalanceCents: money(1000), from: TODAY, horizonDays: 5,
    outflows: [{ date: "2026-07-03", amountCents: money(200), label: "Rent" }]
  });
  assert.equal(p.days.length, 6, "inclusive of both ends");
  assert.equal(p.days[0].balanceCents, money(1000));
  assert.equal(p.days[2].balanceCents, money(800), "the outflow lands on its day");
  assert.equal(p.endingBalanceCents, money(800));
});

test("A NULL OPENING BALANCE PROJECTS NOTHING — IT DOES NOT PROJECT FROM ZERO", () => {
  const p = project({ openingBalanceCents: null, from: TODAY, horizonDays: 5 });
  assert.deepEqual(p.days, []);
  assert.equal(p.endingBalanceCents, null);
  assert.equal(p.reason, WINDOW_REASONS.NO_BALANCE,
    "starting from zero would draw a chart showing somebody overdrawn on day one");
});

test("a projection with no start date refuses rather than assuming today", () => {
  const p = project({ openingBalanceCents: money(100), from: null });
  assert.deepEqual(p.days, []);
  assert.equal(p.reason, "no_start_date");
});

test("inflows are added and outflows subtracted, once", () => {
  const p = project({
    openingBalanceCents: money(100), from: TODAY, horizonDays: 3,
    outflows: [{ date: "2026-07-02", amountCents: money(50) }],
    inflows: [{ date: "2026-07-03", amountCents: money(500) }]
  });
  assert.equal(p.endingBalanceCents, money(550));
});

test("an outflow given negative is still an outflow — the sign flip happens once", () => {
  const p = project({
    openingBalanceCents: money(100), from: TODAY, horizonDays: 2,
    outflows: [{ date: "2026-07-01", amountCents: -money(40) }]
  });
  assert.equal(p.days[0].balanceCents, money(60), "a double flip would show a bill as income");
});

test("unreadable movements are dropped, never guessed", () => {
  const p = project({
    openingBalanceCents: money(100), from: TODAY, horizonDays: 3,
    outflows: [
      { date: "nope", amountCents: money(50) },
      { date: "2026-07-02", amountCents: null },
      { date: "2026-07-02", amountCents: money(10) }
    ]
  });
  assert.equal(p.endingBalanceCents, money(90));
});

test("the lowest point of the projection is reported", () => {
  const p = project({
    openingBalanceCents: money(500), from: TODAY, horizonDays: 5,
    outflows: [{ date: "2026-07-02", amountCents: money(450) }],
    inflows: [{ date: "2026-07-04", amountCents: money(900) }]
  });
  assert.equal(p.lowest.balanceCents, money(50));
  assert.equal(p.lowest.date, "2026-07-02");
});

/* ------------------- paymentWindow: THE REFUSALS --------------------------- */

const base = {
  today: TODAY, dueDate: "2026-07-20", amountCents: money(200),
  balanceCents: money(1000), balanceAsOf: TODAY
};

test("EVERY REFUSAL RETURNS A NULL WINDOW AND A NAMED REASON", () => {
  const cases = [
    [{ ...base, dueDate: null }, WINDOW_REASONS.NO_DUE_DATE],
    [{ ...base, dueDate: "the 15th" }, WINDOW_REASONS.NO_DUE_DATE],
    [{ ...base, amountCents: null }, WINDOW_REASONS.NO_AMOUNT],
    [{ ...base, amountCents: 0 }, WINDOW_REASONS.NO_AMOUNT],
    [{ ...base, balanceCents: null }, WINDOW_REASONS.NO_BALANCE],
    [{ ...base, balanceAsOf: null }, WINDOW_REASONS.STALE_BALANCE],
    [{ ...base, balanceAsOf: "2026-06-01" }, WINDOW_REASONS.STALE_BALANCE],
    [{ ...base, dueDate: "2026-06-15" }, WINDOW_REASONS.DUE_DATE_PASSED],
    [{ ...base, amountCents: money(50000) }, WINDOW_REASONS.INSUFFICIENT_FUNDS],
    [{ ...base, today: null }, WINDOW_REASONS.NO_DUE_DATE]
  ];
  for (const [input, expected] of cases) {
    const r = paymentWindow(input);
    assert.equal(r.window, null, `expected no window for ${expected}`);
    assert.equal(r.reason, expected);
    assert.ok(r.reasonText && r.reasonText.length > 10, "every refusal must be sayable to the person whose money it is");
  }
});

test("A REFUSAL NEVER PRODUCES A DATE — NOT THE DUE DATE, NOT THE 15th, NOT TODAY", () => {
  for (const input of [{ ...base, dueDate: null }, { ...base, balanceCents: null }, { ...base, amountCents: money(50000) }]) {
    const r = paymentWindow(input);
    const serialized = JSON.stringify(r.window);
    assert.equal(serialized, "null", `a window appeared where none was computed: ${serialized}`);
  }
});

test("every reason code has wording, and no wording is orphaned", () => {
  const codes = Object.values(WINDOW_REASONS).sort();
  const worded = Object.keys(WINDOW_REASON_TEXT).sort();
  assert.deepEqual(worded, codes, "two screens must not word the same refusal differently");
});

test("a stale balance names its age rather than just refusing", () => {
  const r = paymentWindow({ ...base, balanceAsOf: "2026-06-01" });
  assert.equal(r.reason, WINDOW_REASONS.STALE_BALANCE);
  assert.equal(r.evidence.ageDays, 30);
  assert.equal(r.evidence.maxBalanceAgeDays, 7);
});

test("the staleness limit is configurable", () => {
  const r = paymentWindow({ ...base, balanceAsOf: "2026-06-25", maxBalanceAgeDays: 30 });
  assert.ok(r.window, "a caller who knows better may widen the limit");
});

test("insufficient funds reports the lowest point it found", () => {
  const r = paymentWindow({ ...base, amountCents: money(50000) });
  assert.equal(r.reason, WINDOW_REASONS.INSUFFICIENT_FUNDS);
  assert.equal(r.evidence.lowestProjectedCents, money(1000));
});

/* ------------------- paymentWindow: THE ANSWERS --------------------------- */

test("a straightforward payment can be made any day up to the due date", () => {
  const r = paymentWindow(base);
  assert.equal(r.reason, null);
  assert.equal(r.window.earliest, "2026-07-01");
  assert.equal(r.window.latest, "2026-07-20");
  assert.equal(r.window.recommended, "2026-07-01");
});

test("A DAY IS ONLY SAFE IF EVERY LATER DAY IN THE WINDOW STAYS SAFE", () => {
  // Affordable today, but rent lands on the 10th and would overdraw them after.
  const r = paymentWindow({
    ...base,
    balanceCents: money(1000),
    amountCents: money(200),
    outflows: [{ date: "2026-07-10", amountCents: money(900), label: "Rent" }]
  });
  assert.equal(r.window, null);
  assert.equal(r.reason, WINDOW_REASONS.INSUFFICIENT_FUNDS,
    "a payment that is affordable today and overdraws you on Thursday is not affordable");
});

test("known incoming money opens a window that would otherwise be closed", () => {
  const withoutPay = paymentWindow({ ...base, balanceCents: money(50), amountCents: money(300) });
  assert.equal(withoutPay.reason, WINDOW_REASONS.INSUFFICIENT_FUNDS);

  const withPay = paymentWindow({
    ...base, balanceCents: money(50), amountCents: money(300),
    inflows: [{ date: "2026-07-15", amountCents: money(2000), label: "Payroll" }]
  });
  assert.equal(withPay.window.earliest, "2026-07-15", "the window opens the day the money lands");
  assert.equal(withPay.window.latest, "2026-07-20");
});

test("INCOME IS NEVER PREDICTED — only what the caller supplied is counted", () => {
  const r = paymentWindow({ ...base, balanceCents: money(50), amountCents: money(300) });
  assert.equal(r.window, null,
    "assuming money will arrive is exactly what turns 'you can afford this' into a wrong answer");
});

test("the recommendation is the earliest safe day, not the latest", () => {
  const r = paymentWindow(base);
  assert.equal(r.window.recommended, r.window.earliest);
  assert.notEqual(r.window.recommended, r.window.latest,
    "holding cash longer means one missed reminder is a late payment; the float is available as `latest`");
});

test("a safety buffer is respected and is zero unless asked for", () => {
  const noBuffer = paymentWindow({ ...base, balanceCents: money(200), amountCents: money(200) });
  assert.ok(noBuffer.window, "paying to exactly zero is allowed when nobody set a buffer");

  const buffered = paymentWindow({ ...base, balanceCents: money(200), amountCents: money(200), safetyBufferCents: money(100) });
  assert.equal(buffered.reason, WINDOW_REASONS.INSUFFICIENT_FUNDS,
    "a buffer this module invented would be silently spending somebody's money");
});

test("a payment due today is still answerable", () => {
  const r = paymentWindow({ ...base, dueDate: TODAY });
  assert.equal(r.window.earliest, TODAY);
  assert.equal(r.window.latest, TODAY);
});

test("paymentWindow has no clock — the same input gives the same output", () => {
  assert.deepEqual(paymentWindow(base), paymentWindow(base));
});

test("the window carries the evidence it was computed from", () => {
  const r = paymentWindow(base);
  assert.equal(r.evidence.balanceAsOf, TODAY);
  assert.equal(r.evidence.balanceAgeDays, 0);
  assert.equal(r.evidence.dueDate, "2026-07-20");
  assert.ok(r.evidence.safeDayCount > 0);
});

/* ----------------------------- buildReminders ----------------------------- */

test("a reported card due date becomes a reminder with no confidence", () => {
  const { reminders } = buildReminders({
    today: TODAY,
    liabilities: [{ id: "liab-1", next_payment_due_date: "2026-07-20", minimum_payment_cents: money(35) }]
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].kind, "card_payment");
  assert.equal(reminders[0].basis, "reported");
  assert.equal(reminders[0].confidence, null, "a reported date is not an estimate");
  assert.equal(reminders[0].remindOn, "2026-07-15", "five days' lead for a reported date");
});

test("an inferred bill becomes a reminder that CARRIES ITS CONFIDENCE", () => {
  const { reminders } = buildReminders({
    today: TODAY,
    bills: [{ id: "bill-1", merchantName: "Insurance Co", nextExpectedDate: "2026-07-20", amountCents: money(87.4), confidence: 0.32, cadence: "monthly" }]
  });
  assert.equal(reminders[0].basis, "inferred");
  assert.equal(reminders[0].confidence, 0.32,
    "the guess must stay visibly a guess all the way to the screen");
  assert.equal(reminders[0].remindOn, "2026-07-13", "seven days' lead for an inference — more time to check it");
});

test("A SUBJECT WITH NO DUE DATE PRODUCES NO REMINDER", () => {
  const { reminders, skipped } = buildReminders({
    today: TODAY,
    bills: [{ id: "bill-1", merchantName: "Chaos Co", nextExpectedDate: null, confidence: 0.2 }],
    liabilities: [{ id: "liab-1", next_payment_due_date: null }]
  });
  assert.deepEqual(reminders, [], "not a reminder dated today, and not one dated 'soon'");
  assert.equal(skipped.length, 2);
  assert.ok(skipped.every((s) => s.reason === WINDOW_REASONS.NO_DUE_DATE));
});

test("a due date already past produces no reminder", () => {
  const { reminders, skipped } = buildReminders({
    today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-06-01" }]
  });
  assert.deepEqual(reminders, []);
  assert.equal(skipped[0].reason, WINDOW_REASONS.DUE_DATE_PASSED);
});

test("remind_on is never before today, so 087's CHECK always holds", () => {
  const { reminders } = buildReminders({
    today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-07-02" }]
  });
  assert.equal(reminders[0].remindOn, TODAY);
  assert.ok(reminders[0].remindOn <= reminders[0].dueDate);
});

test("the dedupe key is stable across recomputes for the same obligation", () => {
  const args = { today: TODAY, liabilities: [{ id: "liab-1", next_payment_due_date: "2026-07-20" }] };
  assert.equal(buildReminders(args).reminders[0].dedupeKey, buildReminders(args).reminders[0].dedupeKey);
});

test("a moved due date is a different reminder", () => {
  const a = buildReminders({ today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-07-20" }] });
  const b = buildReminders({ today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-07-25" }] });
  assert.notEqual(a.reminders[0].dedupeKey, b.reminders[0].dedupeKey);
});

test("reminders come back in the order they should be surfaced", () => {
  const { reminders } = buildReminders({
    today: TODAY,
    liabilities: [{ id: "late", next_payment_due_date: "2026-07-28" }, { id: "soon", next_payment_due_date: "2026-07-08" }]
  });
  assert.equal(reminders[0].subjectId, "soon");
});

test("buildReminders has no clock and refuses without one", () => {
  const { reminders, skipped } = buildReminders({ liabilities: [{ id: "l", next_payment_due_date: "2026-07-20" }] });
  assert.deepEqual(reminders, []);
  assert.equal(skipped[0].reason, "no_today");
});

/* ---------------------------- recordReminders ----------------------------- */

function stubDb() {
  const calls = [];
  return {
    calls,
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [{ id: "reminder-1" }] };
    }
  };
}

test("recordReminders requires an org and a client", async () => {
  await assert.rejects(() => recordReminders(stubDb(), { clientId: "c", reminders: [{}] }), /orgId is required/);
  await assert.rejects(() => recordReminders(stubDb(), { orgId: "o", reminders: [{}] }), /clientId is required/);
});

test("recording nothing writes nothing", async () => {
  const db = stubDb();
  assert.deepEqual(await recordReminders(db, { orgId: "o", clientId: "c", reminders: [] }), []);
  assert.equal(db.calls.length, 0);
});

test("a nightly recompute updates rather than duplicating", async () => {
  const db = stubDb();
  const { reminders } = buildReminders({ today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-07-20" }] });
  await recordReminders(db, { orgId: "o", clientId: "c", reminders });
  assert.match(db.calls[0].sql, /ON CONFLICT \(client_id, kind, dedupe_key\)/);
  assert.match(db.calls[0].sql, /DO UPDATE SET/);
});

test("NOTHING IS MARKED SENT — nothing in this repository transmits", async () => {
  const db = stubDb();
  const { reminders } = buildReminders({ today: TODAY, liabilities: [{ id: "l", next_payment_due_date: "2026-07-20" }] });
  await recordReminders(db, { orgId: "o", clientId: "c", reminders });
  assert.doesNotMatch(db.calls[0].sql, /sent_at/, "sent_at must stay NULL — NULL means not sent");
});
