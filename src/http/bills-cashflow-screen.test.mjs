/* Tests for the inline wiring script in public/app/bills-cashflow.html.
 *
 * WHY A SCREEN TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing has LOOKED at this page. What can still be proved
 * without a browser is what the page DECIDES to put on screen, and that is where
 * the expensive mistakes live — so the real wiring script is lifted out of the
 * .html file and run against a stub DOM, exactly the way
 * src/http/subscriptions-screen.test.mjs and
 * src/http/banking-surface-screen.test.mjs do it. If the script drifts, this goes
 * red rather than the screen going quietly wrong. It proves nothing about layout,
 * colour or whether anything is legible; a human still has to open it.
 *
 * THE FIVE RULES UNDER TEST, ALL OF WHICH HAVE ALREADY COST SOMEBODY SOMETHING:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Audit M8: banking-surface.html left two
 *      invented dollar figures on screen under a real client's name when the read
 *      came back empty. This screen ships no sample figures at all, and every way
 *      a read can end — rows, no rows, no answer, a refusal — is asserted to
 *      leave no money on the page the response did not contain.
 *
 *   2. A LOW-CONFIDENCE GUESS IS NOT A BILL. The detector, the store, the seam
 *      and the endpoint all keep them apart; a screen that draws them in one
 *      table undoes all four at once. The candidate block has to be visibly
 *      separate and has to say it is not a list of bills.
 *
 *   3. A MISSING NEXT DATE SAYS WHY. 086 makes it a CHECK that a bill has a date
 *      OR a reason, never neither. A blank cell would read as "no date", which is
 *      a claim; the stored reason has to reach the page.
 *
 *   4. A REFUSAL IS THE ANSWER, NOT AN ERROR. project() comes back ok:false for
 *      an unknown balance and the reason is the whole point. A screen that
 *      renders nothing for it, or renders the days and drops the blind spots, is
 *      showing a confident number built on holes.
 *
 *   5. EVERYTHING IS ESCAPED. A merchant name comes off a bank statement and a
 *      lender name is typed by a person. There are 252 innerHTML sites across
 *      public/app; a screen that interpolates a record without esc() turns a
 *      statement line into markup.
 *
 * And one more, specific to this screen: WITH NO BANK HISTORY IT MUST SAY SO AND
 * POINT SOMEWHERE. Drawing an empty projection for a client whose transactions
 * were never entered tells the owner the client has no outgoings, which nobody
 * has checked. That is the M8 defect wearing a different hat.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/bills-cashflow.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const LIA = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "bills-cashflow.html no longer has an inline wiring script");
  return m[1];
}

/* ── the browser stub ─────────────────────────────────────────────────────── */

function makeEl(id, html = "") {
  return {
    id,
    innerHTML: html,
    className: "",
    textContent: "",
    value: "",
    checked: false,
    style: { cssText: "" },
    // Listeners are KEPT rather than dropped, so a test can press the one
    // control this screen is built around — the Project button. Without that,
    // everything below only ever exercises the first paint, and the repaint
    // after a horizon is chosen is the half a person actually uses.
    _on: {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { (this._on[type] = this._on[type] || []).push(fn); },
    appendChild() {},
    querySelectorAll() { return []; }
  };
}

/** Fire every handler bound to `type` on an element, and drain the queue.
 *
 * The listener list is COPIED before it is walked. The handler re-renders, the
 * re-render calls bind() again, and iterating the live array meant each press
 * added a handler that was then pressed, which added a handler — an infinite
 * loop that hung the whole test run. A real event dispatch snapshots too. */
async function fire(el, type) {
  const fns = [...((el._on && el._on[type]) || [])];
  for (const fn of fns) fn({ preventDefault() {} });
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path)` answers each GET the screen issues. Elements are created on
 * demand, so the forms the script binds to after a render exist without this file
 * having to know their ids — what is asserted is the HTML the script produced,
 * not the wiring of a fake DOM.
 */
async function runScreen({ search = `?client_id=${CID}`, respond } = {}) {
  const els = {};
  const calls = [];

  /* A REPAINT DESTROYS THE CONTROLS, AND THE STUB HAS TO MODEL THAT.
     `mount.innerHTML = ...` in a real browser throws away every element inside
     it, listeners and all, and the next getElementById returns a brand new one.
     A stub that hands back the same cached object forever accumulates a listener
     per render, so one press of Project fires three times and the "did it
     repaint" assertion below passes for the wrong reason. Setting the mount's
     innerHTML therefore clears the element cache, keeping only the two elements
     that live OUTSIDE the mount in the real page plus the banner data.js appends
     to <body>. */
  const KEEP = new Set(["cashflowMount", "cashflowMountSource", "fh-data-banner"]);
  const mountEl = makeEl("cashflowMount");
  let mountHtml = "";
  Object.defineProperty(mountEl, "innerHTML", {
    get: () => mountHtml,
    set: (v) => {
      mountHtml = v;
      for (const k of Object.keys(els)) if (!KEEP.has(k)) delete els[k];
    }
  });
  els.cashflowMount = mountEl;
  els.cashflowMountSource = makeEl("cashflowMountSource");

  const sandbox = {
    console,
    document: {
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl(""),
      querySelectorAll: () => [],
      body: { appendChild: (el) => { els[el.id] = el; } }
    },
    localStorage: {
      getItem: (k) => (k === "fh_token" ? "t0ken" : null),
      setItem() {}, removeItem() {}
    },
    location: { search },
    URLSearchParams,
    Promise,
    Array,
    Number,
    String,
    JSON,
    fetch: (p) => {
      calls.push(p);
      const r = respond(p);
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  vm.runInContext(inlineScript(), sandbox, { filename: SCREEN + "#wiring" });

  // The wiring does not hand back its promise, so drain the microtask queue.
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));

  return {
    els,
    calls,
    /* Elements are created on demand by the wiring, so a control the script has
       not looked at yet does not exist in `els`. This mints it the same way
       document.getElementById does, which is how a test can type into a box
       before the handler that reads it has ever run. */
    el: (id) => (els[id] || (els[id] = makeEl(id))),
    html: () => els.cashflowMount.innerHTML,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : "")
  };
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const BILL = (over = {}) => ({
  id: "bill-1", merchant_key: "netflix", merchant_display: "NETFLIX.COM",
  cadence: "monthly", typical_amount_cents: -1599, typical_amount_display: "-15.99",
  next_expected_on: "2026-08-12", next_expected_unknown_reason: null,
  confidence_pct: 82, confidence_label: "high",
  occurrence_count: 6, first_seen_on: "2026-02-12", last_seen_on: "2026-07-12",
  ...over
});

const BILLS_BODY = (over = {}) => ({
  ok: true, client_id: CID, bank_account_id: null,
  bills: [BILL()], candidates: [], candidates_included: false, candidate_count: 0,
  accounts: [{ id: "acc-1", name: "Everyday Checking", mask: "1234", closed_at: null }],
  transaction_count: 412,
  ...over
});

const CASH_BODY = (over = {}) => ({
  ok: true, client_id: CID, as_of: "2026-07-31", horizon_days: 45, end_date: "2026-09-13",
  balance_column: "current_balance_cents",
  accounts_used: [{ accountId: "acc-1", label: "Everyday Checking", balanceCents: 250000 }],
  accounts_excluded: [],
  bills_projected: 1, bills_skipped: [], candidates_included: false, candidate_count: 0,
  thresholds: { minBufferCents: 0, confidenceFloor: 0.55, settlementLeadDays: 3 },
  card_liabilities: [], card_liability_id: null,
  projection: {
    ok: true, reason: null, startDate: "2026-07-31", endDate: "2026-09-13",
    openingBalanceCents: 250000, openingBalance: "2500.00",
    days: [
      { date: "2026-07-31", dayIndex: 0, closingCents: 250000, closingBalance: "2500.00",
        worstCaseClosingCents: 250000, worstCaseClosingBalance: "2500.00",
        belowZero: false, worstCaseBelowZero: false, components: [] },
      { date: "2026-08-12", dayIndex: 12, closingCents: 248401, closingBalance: "2484.01",
        worstCaseClosingCents: 248401, worstCaseClosingBalance: "2484.01",
        belowZero: false, worstCaseBelowZero: false,
        components: [{ direction: "out", kind: "bill", sourceId: "b1", label: "NETFLIX.COM",
                       amountCents: 1599, amount: "15.99", certainty: "confirmed", confidence: 0.82 }] },
      { date: "2026-09-13", dayIndex: 44, closingCents: 248401, closingBalance: "2484.01",
        worstCaseClosingCents: 248401, worstCaseClosingBalance: "2484.01",
        belowZero: false, worstCaseBelowZero: false, components: [] }
    ],
    lowestClosingCents: 248401, lowestClosingDate: "2026-08-12",
    lowestWorstCaseClosingCents: 248401, lowestWorstCaseClosingDate: "2026-08-12",
    blindSpots: [], excluded: [], unconfirmed: [], thresholdGaps: []
  },
  window: null,
  reminders_due: [], reminder_candidates: [], reminder_skipped: [],
  ...over
});

const SETTINGS_BODY = (over = {}) => ({
  ok: true, view: "settings",
  thresholds: { minBufferCents: 0, confidenceFloor: 0.55, settlementLeadDays: 3 },
  set: { min_buffer_cents: true, confidence_floor: true, settlement_lead_days: true },
  min_buffer_display: "0.00",
  gaps: [],
  ...over
});

/* respondWith — one place that knows which of the three GETs is which. */
function respondWith({ bills, cash, settings, billsStatus = 200, cashStatus = 200, settingsStatus = 200 } = {}) {
  return (p) => {
    if (p.indexOf("/api/finance/cashflow?view=settings") === 0) {
      return { status: settingsStatus, body: settingsStatus === 200 ? (settings || SETTINGS_BODY()) : settings };
    }
    if (p.indexOf("/api/finance/cashflow") === 0) {
      return { status: cashStatus, body: cashStatus === 200 ? (cash || CASH_BODY()) : cash };
    }
    if (p.indexOf("/api/finance/bills") === 0) {
      return { status: billsStatus, body: billsStatus === 200 ? (bills || BILLS_BODY()) : bills };
    }
    throw new Error("the screen called an endpoint nobody expected: " + p);
  };
}

/* Any run of digits with a decimal point — the shape of money on this page. Used
   to prove that a screen with no data shows no money, without having to list
   every figure that could have been invented and without having to know what a
   future version of the page might invent. */
const MONEY_SHAPED = /\b\d[\d,]*\.\d{2}\b/;

/* THE PART OF THE PAGE THAT IS ABOUT THIS CLIENT.
 *
 * The last section — "Settings for this company" — is org-level: it holds the
 * three operator thresholds, they come from a DIFFERENT read, and they carry real
 * numbers (a buffer of "0.00", a confidence floor of "0.55") whichever client is
 * open. Running the "no invented money" check over the whole document would
 * therefore fire on figures the server genuinely sent about the company, and the
 * honest fix is to scope the check rather than to loosen it: what must never
 * carry an unbacked figure is the part of the page that is about a named person.
 */
function clientPart(html) {
  const cut = html.indexOf("Settings for this company");
  return cut === -1 ? html : html.slice(0, cut);
}

/* ══════════════════════════════════════════════════════════════════════════
 * What the screen asks for
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — the reads it issues", () => {

  test("with no client in the URL it asks for nothing and invents nothing", async () => {
    const s = await runScreen({ search: "", respond: () => { throw new Error("no read expected"); } });
    assert.deepEqual(s.calls, [], "the screen read the API with no client to read about");
    assert.ok(/client_id/.test(s.html()), "the page does not say what is missing");
    assert.ok(!MONEY_SHAPED.test(s.html()), "money is on screen with no client named:\n" + s.html());
    assert.match(s.banner(), /no client named/);
  });

  test("with a client it reads the bills and the settings, and does NOT project unasked", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.ok(s.calls.some((c) => c.indexOf("/api/finance/bills?client_id=" + CID) === 0));
    assert.ok(s.calls.some((c) => c.indexOf("/api/finance/cashflow?view=settings") === 0));
    assert.ok(!s.calls.some((c) => /horizon_days=/.test(c)),
      "the screen picked a number of days on the owner's behalf — a default horizon is " +
      "a policy nobody stated and it changes every figure on the page");
  });

  test("a horizon in the address bar is honoured, so a saved link opens the same view", async () => {
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({})
    });
    const cash = s.calls.find((c) => /horizon_days=45/.test(c));
    assert.ok(cash, "a horizon in the URL was ignored");
    assert.ok(cash.indexOf("/api/finance/cashflow?client_id=" + CID) === 0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rule 1 — no number the server did not send
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — a named client never sees invented money", () => {

  test("no bank accounts: it says so and points at the bank accounts screen", async () => {
    const s = await runScreen({
      respond: respondWith({ bills: BILLS_BODY({ accounts: [], bills: [], transaction_count: 0 }) })
    });
    const html = s.html();
    assert.ok(!MONEY_SHAPED.test(clientPart(html)),
      "money on screen for a client with no accounts:\n" + clientPart(html));
    assert.match(html, /no bank accounts on file/i);
    assert.match(html, new RegExp("bank-accounts\\.html\\?client_id=" + CID),
      "the empty state does not point anywhere — the owner is told what is missing and " +
      "not where to fix it");
  });

  test("accounts but no transactions: a different sentence, and still no figures", async () => {
    const s = await runScreen({
      respond: respondWith({ bills: BILLS_BODY({ bills: [], transaction_count: 0 }) })
    });
    const html = s.html();
    assert.match(html, /No transactions have been entered/i);
    assert.match(html, /nothing in this system reads a bank/i);
    assert.ok(!MONEY_SHAPED.test(clientPart(html)),
      "money on screen with no transactions:\n" + clientPart(html));
  });

  test("412 charges and no pattern is a DIFFERENT answer from no charges at all", async () => {
    const s = await runScreen({
      respond: respondWith({ bills: BILLS_BODY({ bills: [], transaction_count: 412 }) })
    });
    const html = s.html();
    assert.match(html, /No repeating bills were found/i);
    assert.match(html, /412 charge/,
      "the count is missing, so 'nothing entered' and 'nothing repeating' read the same");
    assert.ok(!/No transactions have been entered/i.test(html),
      "the two empty states have been collapsed into one");
  });

  test("a read that fails leaves no figures behind and says why in the banner", async () => {
    const s = await runScreen({
      respond: respondWith({ billsStatus: 500, bills: { ok: false, error: "internal_error" } })
    });
    assert.ok(!MONEY_SHAPED.test(clientPart(s.html())),
      "money survived a failed read:\n" + clientPart(s.html()));
    assert.match(s.banner(), /something went wrong on our side/,
      "a crashed handler is being reported as a database outage (audit m17)");
  });

  test("a 501 reads as 'not built yet', never as an outage", async () => {
    const s = await runScreen({
      respond: respondWith({ billsStatus: 501, bills: { ok: false, error: "not_implemented" } })
    });
    assert.match(s.banner(), /not built yet/);
    assert.ok(!/database/i.test(s.banner()));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rule 2 — a guess is not a bill
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — a low-confidence guess is drawn as a guess", () => {

  test("guesses that were not asked for are counted, not drawn", async () => {
    const s = await runScreen({
      respond: respondWith({ bills: BILLS_BODY({ candidate_count: 3 }) })
    });
    const html = s.html();
    assert.match(html, /3 merchant\(s\) looked like they might be bills/);
    assert.ok(!/fh-guess/.test(html), "the guess block was drawn without the rows to fill it");
  });

  test("guesses that were asked for land in their own block, labelled as not bills", async () => {
    const guess = BILL({
      id: "bill-2", merchant_key: "gym", merchant_display: "CITY GYM",
      confidence_label: "low", confidence_pct: 41,
      next_expected_on: null, next_expected_unknown_reason: "confidence_too_low_to_predict_a_date"
    });
    const s = await runScreen({
      respond: respondWith({
        bills: BILLS_BODY({ candidates: [guess], candidates_included: true, candidate_count: 1 })
      })
    });
    const html = s.html();
    assert.match(html, /fh-guess/, "the guesses were drawn in the same block as the bills");
    assert.match(html, /These are not bills/,
      "nothing on the page says the guess block is not a list of bills");

    // The guess must sit AFTER the "not confident enough" heading, not inside the
    // bills table above it.
    const heading = html.indexOf("Not confident enough to call these bills");
    assert.ok(heading > 0, "the heading is missing");
    assert.ok(html.indexOf("CITY GYM") > heading,
      "a low-confidence guess is being drawn inside the bills table");
    assert.ok(html.indexOf("NETFLIX.COM") < heading,
      "a confident bill fell into the guess block");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rule 3 — a missing date says why
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — an unknown is an em dash with a reason", () => {

  test("a bill with no next date shows the dash AND the stored reason in English", async () => {
    const s = await runScreen({
      respond: respondWith({
        bills: BILLS_BODY({
          bills: [BILL({
            next_expected_on: null,
            next_expected_unknown_reason: "no_occurrence_in_recent_periods_bill_may_have_ended"
          })]
        })
      })
    });
    const html = s.html();
    assert.match(html, /—/, "no em dash for a missing date");
    assert.match(html, /this bill may have stopped/,
      "the stored reason did not reach the page — a blank cell reads as 'no date', " +
      "which is a claim nobody made");
    assert.ok(!/no_occurrence_in_recent_periods/.test(html),
      "the raw token is on screen instead of a sentence");
  });

  test("a reason token nobody has worded yet is printed raw rather than swallowed", async () => {
    const s = await runScreen({
      respond: respondWith({
        bills: BILLS_BODY({
          bills: [BILL({ next_expected_on: null, next_expected_unknown_reason: "some_future_reason" })]
        })
      })
    });
    assert.match(s.html(), /some_future_reason/,
      "an unrecognised reason vanished — 'we know why and have not written it down' " +
      "became 'there is no reason'");
  });

  test("an unknown amount is an em dash, never 0.00", async () => {
    const s = await runScreen({
      respond: respondWith({
        bills: BILLS_BODY({
          bills: [BILL({ typical_amount_cents: null, typical_amount_display: null })]
        })
      })
    });
    const html = s.html();
    assert.match(html, /is-unknown/);
    assert.ok(!/0\.00/.test(html),
      "an unknown amount rendered as zero — 'we do not know' and 'it is nothing' are " +
      "different facts about somebody's money and only one is a claim");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rule 4 — a refusal is the answer, and the holes are printed
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — the projection", () => {

  test("with no horizon chosen it asks rather than projecting", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /Say how many days ahead to look/);
    assert.ok(!MONEY_SHAPED.test(clientPart(s.html()).split("Can they cover it")[1] || ""),
      "figures are on screen before anybody said how far ahead to look");
  });

  test("pressing Project reads with the horizon typed in AND repaints with the answer", async () => {
    /* THE BUG THIS CATCHES SHIPPED IN THE FIRST DRAFT OF THIS SCREEN. The submit
       handler called loadBills() and loadCash() and never rendered again — both
       only put rows into state — so pressing Project fetched the projection and
       left the page exactly as it was. The reader would have concluded the button
       did nothing, or worse, read the previous horizon's figures as the answer to
       the horizon they had just typed. */
    const s = await runScreen({ respond: respondWith({}) });
    assert.ok(!s.calls.some((c) => /horizon_days=/.test(c)), "it projected before being asked");

    s.el("horizonDays").value = "45";
    await fire(s.el("viewForm"), "submit");

    assert.ok(s.calls.some((c) => /horizon_days=45/.test(c)),
      "pressing Project did not ask for the horizon that was typed in");
    assert.match(s.html(), /2,484\.01/,
      "the projection came back and the page was never repainted with it");
    assert.ok(!/Say how many days ahead to look/.test(s.html()),
      "the 'choose a horizon' prompt is still on screen after a horizon was chosen");
  });

  test("a refused projection prints the reason at full size", async () => {
    const refused = CASH_BODY({
      projection: {
        ok: false,
        reason: {
          code: "UNKNOWN_OPENING_BALANCE",
          message: "1 account balance is unknown, so the opening balance is unknown. An unknown balance is not zero.",
          details: {}
        },
        days: null, blindSpots: [], excluded: [], unconfirmed: [], thresholdGaps: []
      },
      accounts_used: [],
      accounts_excluded: [{ id: "acc-2", label: "Old Savings", reason: "this account is recorded as closed" }]
    });
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({ cash: refused })
    });
    const html = s.html();
    assert.match(html, /No projection was produced/);
    assert.match(html, /An unknown balance is not zero/,
      "the model's refusal did not reach the page — the reason IS the answer here");
    assert.match(html, /Old Savings/, "the excluded account was not named");
    assert.match(s.banner(), /refused/);
  });

  test("a good projection prints only figures the server sent", async () => {
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({})
    });
    const html = s.html();
    assert.match(html, /2,500\.00/, "the opening balance is missing");
    assert.match(html, /2,484\.01/, "the lowest balance is missing");
    // Nothing on the page may be money that was not in the response. 15.99 is a
    // component amount the server sent; 2500.00 and 2484.01 are its balances.
    const seen = clientPart(html).match(/\b\d[\d,]*\.\d{2}\b/g) || [];
    const allowed = new Set(["2,500.00", "2,484.01", "15.99"]);
    for (const n of seen) {
      assert.ok(allowed.has(n), `a figure the server never sent is on screen: ${n}`);
    }
  });

  test("blind spots, skipped bills and threshold gaps are all printed", async () => {
    const holey = CASH_BODY({
      bills_skipped: [{ billId: "acc:gym:monthly", reason: "no_confident_next_date_so_no_occurrences_were_projected" }],
      projection: Object.assign(CASH_BODY().projection, {
        blindSpots: [{ kind: "card", sourceId: LIA, label: "Amex Blue",
                       reason: "this card has a due date but no minimum payment, so the amount that must leave the account is unknown — and an unknown amount is not zero" }],
        unconfirmed: [{ kind: "bill", sourceId: "b2", label: "CITY GYM", confidence: 0.41,
                        reason: "its confidence is below the floor" }],
        thresholdGaps: [{ name: "settlementLeadDays", note: "No settlement lead time was supplied." }]
      })
    });
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({ cash: holey })
    });
    const html = s.html();
    assert.match(html, /Amex Blue/, "a blind spot was dropped");
    assert.match(html, /an unknown amount is not zero/);
    assert.match(html, /no confident next date/, "a skipped bill was dropped");
    assert.match(html, /CITY GYM/, "an unconfirmed bill was dropped");
    assert.match(html, /settlementLeadDays/, "a threshold gap was dropped");
  });

  test("a day the account goes below zero is marked, not left to be spotted", async () => {
    const short = CASH_BODY();
    short.projection.days[1].belowZero = true;
    short.projection.days[1].worstCaseBelowZero = true;
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({ cash: short })
    });
    assert.match(s.html(), /<tr class="short">/,
      "the day the balance goes negative is drawn like every other day");
  });

  test("a 400 from the endpoint is shown ON the page, not only in the banner", async () => {
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=9999`,
      respond: respondWith({
        cashStatus: 400,
        cash: { ok: false, error: "horizon_days must be a whole number of days between 1 and 365, got \"9999\"" }
      })
    });
    assert.match(s.html(), /between 1 and 365/,
      "the endpoint's sentence is only in the banner — it is the answer to what the " +
      "person just asked for and belongs where they are looking");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The payment window and the thresholds
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — the payment window and the settings", () => {

  test("a refused window prints its reason instead of a date", async () => {
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45&card_liability_id=${LIA}`,
      respond: respondWith({
        cash: CASH_BODY({
          card_liabilities: [{ liabilityId: LIA, label: "Amex Blue", dueDate: null,
                               statementClose: null, minimumPaymentCents: 3500, statementBalanceCents: 120000 }],
          card_liability_id: LIA,
          window: {
            ok: false,
            reason: { code: "MISSING_DUE_DATE",
                      message: "This card has no due date, so there is no window to compute. A date invented here would be a guess about when a real payment is late.",
                      details: {} },
            thresholdGaps: []
          }
        })
      })
    });
    const html = s.html();
    assert.match(html, /No payment date can be recommended/);
    assert.match(html, /A date invented here would be a guess/);
  });

  test("a good window shows the dates and the floor the server formatted", async () => {
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45&card_liability_id=${LIA}`,
      respond: respondWith({
        cash: CASH_BODY({
          card_liabilities: [{ liabilityId: LIA, label: "Amex Blue", dueDate: "2026-08-15",
                               statementClose: "2026-07-20", minimumPaymentCents: 3500,
                               statementBalanceCents: 120000 }],
          card_liability_id: LIA,
          window: {
            ok: true, reason: null,
            earliestDate: "2026-07-31", latestDate: "2026-08-15", recommendedDate: "2026-08-15",
            initiateByDate: "2026-08-12", initiateByReason: null,
            amountCents: 3500, amount: "35.00", amountBasis: "minimum",
            floorCents: 0, floor_display: "0.00", floorSource: "spec-zero",
            statementCloseKnown: true, candidates: [], notes: [], thresholdGaps: []
          }
        })
      })
    });
    const html = s.html();
    assert.match(html, /2026-08-12/, "the initiate-by date is missing");
    assert.match(html, /35\.00/, "the payment amount is missing");
    assert.match(html, /zero — no buffer has been set/,
      "the floor does not say whether it is the specified zero or a buffer somebody chose");
  });

  test("the settings form warns that a bigger buffer is NOT the safe direction", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    const html = s.html();
    assert.match(html, /Raising this is not the safe direction/,
      "088 section B's warning is not next to the field — a bigger buffer refuses more " +
      "payment dates, which pushes the payment later, which risks the late payment it " +
      "was meant to prevent");
    assert.match(html, /fraction, not a percentage/,
      "nothing tells the reader the confidence floor is 0.8 and not 80");
    assert.match(html, /Err high/, "the settlement lead's asymmetry is not stated");
  });

  test("an unset threshold leaves its box EMPTY rather than showing a zero", async () => {
    const s = await runScreen({
      respond: respondWith({
        settings: SETTINGS_BODY({
          thresholds: { confidenceFloor: 0.55 },
          set: { min_buffer_cents: false, confidence_floor: true, settlement_lead_days: false },
          min_buffer_display: null,
          gaps: [{ org_id: "o", setting: "cashflow_settings.min_buffer_cents", value: "null",
                   status: "UNSET", consequence: "the model falls back to zero" }]
        })
      })
    });
    const html = s.html();
    assert.match(html, /id="setBuffer" type="text" value=""/,
      "an unset threshold was prefilled with a number, which turns 'nobody has decided " +
      "this' into 'somebody decided that'");
    assert.match(html, /Not signed off yet/);
    assert.match(html, /cashflow_settings\.min_buffer_cents/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Rule 5 — escaping
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills-cashflow.html — record data is never markup", () => {

  test("a merchant name off a bank statement cannot become a tag", async () => {
    const nasty = '<img src=x onerror="alert(1)">';
    const s = await runScreen({
      respond: respondWith({
        bills: BILLS_BODY({ bills: [BILL({ merchant_display: nasty })] })
      })
    });
    const html = s.html();
    assert.ok(!html.includes(nasty), "an unescaped merchant name reached the page");
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"),
      "the merchant name is not on the page at all, escaped or otherwise");
  });

  test("a lender name and a reminder body are escaped too", async () => {
    const nasty = "</td><script>alert(1)</script>";
    const s = await runScreen({
      search: `?client_id=${CID}&horizon_days=45`,
      respond: respondWith({
        cash: CASH_BODY({
          reminders_due: [{
            id: "r1", subject_label: nasty, reminder_kind: "input_missing",
            surface_at: "2026-07-31T00:00:00.000Z", body: nasty
          }]
        })
      })
    });
    assert.ok(!s.html().includes("<script>alert(1)</script>"),
      "a reminder body reached the page as markup");
  });
});
