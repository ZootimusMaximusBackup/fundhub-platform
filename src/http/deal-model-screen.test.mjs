/* Tests for the inline wiring script in public/app/deal-model.html.
 *
 * WHY A SCREEN TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing has LOOKED at this page. What can still be proved
 * without a browser is what the page DECIDES to put on screen, and that is where
 * the expensive mistakes live — so the real wiring script is lifted out of the
 * .html file and run against a stub DOM, the same way
 * src/http/subscriptions-screen.test.mjs and banking-surface-screen.test.mjs do
 * it. If the script drifts, this goes red rather than the screen going quietly
 * wrong. It proves nothing about layout, colour or whether anything is legible;
 * a human still has to open it.
 *
 * THE RULES UNDER TEST, ALL OF WHICH HAVE ALREADY COST SOMEBODY SOMETHING:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Audit M8: banking-surface.html left
 *      two invented dollar figures on screen under a real client's name when the
 *      read came back empty. This screen ships no sample figures at all, and
 *      every way a run can end — answered, refused, unreachable — is asserted to
 *      leave no money on the page that the response did not contain. Including
 *      the case that is easy to miss: a FAILED run after a successful one must
 *      clear the old figures rather than leave them under the new inputs.
 *
 *   2. AN UNKNOWN IS AN EM DASH, NEVER 0.00. A card with no recorded limit and a
 *      card with a zero limit are different facts about somebody's credit.
 *
 *   3. THE TWO GUARDRAIL VERDICTS READ DIFFERENTLY. "This draw crosses the line"
 *      and "they were already over" get different words and different advice,
 *      because a pre-existing balance is not a reason to refuse this deal
 *      (src/calculators/deal-funding.mjs:101). A screen that shows them the same
 *      way throws away the whole reason the calculator separates them.
 *
 *   4. EVERYTHING IS ESCAPED. A lender name is record data, out of a bureau file
 *      or typed by a person. There are 252 innerHTML sites across public/app.
 *
 *   5. THE ORG IS NEVER SENT. The request carries the client id from the address
 *      bar and nothing else that identifies a tenant; the endpoint takes the org
 *      from the session and refuses a body that names one.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/deal-model.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "deal-model.html no longer has an inline wiring script");
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
    style: { cssText: "" },
    /* Handlers are KEPT, not swallowed. The stub in the neighbouring screen
       tests drops them, which is fine for a page that only reads on load — this
       one recomputes on demand, and "what does the page show on the SECOND
       answer" is a question worth being able to ask. */
    listeners: {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    appendChild() {},
    querySelectorAll() { return []; }
  };
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path, body)` answers the POST the screen issues. `values` pre-fills
 * input boxes, since the script reads them by id at the moment it builds the
 * request — which is what lets this file assert on the REQUEST as well as on
 * what came back.
 */
async function runScreen({ search = `?client_id=${CID}`, values = {}, respond, demo = false } = {}) {
  const els = {
    modelMount: makeEl("modelMount"),
    modelMountSource: makeEl("modelMountSource")
  };
  for (const [id, v] of Object.entries(values)) {
    els[id] = makeEl(id);
    els[id].value = v;
  }
  const sent = [];

  const sandbox = {
    console,
    document: {
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl(""),
      querySelectorAll: () => [],
      body: { appendChild: (el) => { els[el.id] = el; } }
    },
    localStorage: {
      getItem: (k) => (k === "fh_token" ? "t0ken" : (k === "fh_demo" ? (demo ? "1" : null) : null)),
      setItem() {}, removeItem() {}
    },
    location: { search },
    URLSearchParams,
    Promise,
    Array,
    Object,
    Number,
    String,
    JSON,
    setTimeout,
    clearTimeout,
    fetch: (p, opts) => {
      sent.push({ path: p, method: opts && opts.method, body: JSON.parse((opts && opts.body) || "{}") });
      const r = respond(p, JSON.parse((opts && opts.body) || "{}"));
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  vm.runInContext(inlineScript(), sandbox, { filename: SCREEN + "#wiring" });

  // The wiring does not hand back its promise, so drain the microtask queue.
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  /** fire — run the handlers the page bound to an element, then drain again. */
  async function fire(id, type) {
    const el = els[id];
    assert.ok(el, `no element ${id} was created`);
    for (const fn of (el.listeners[type] || [])) fn({ preventDefault() {} });
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
  }

  return {
    els,
    sent,
    fire,
    html: () => els.modelMount.innerHTML + (els.modelResults ? els.modelResults.innerHTML : ""),
    results: () => (els.modelResults ? els.modelResults.innerHTML : ""),
    msg: () => (els.modelMsg ? els.modelMsg.textContent : ""),
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : "")
  };
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/* A complete answer in the shape api/finance/model.mjs returns. Written out in
   full rather than merged from fragments, because the thing being tested is
   whether the SCREEN reads the real shape — a fixture that drifts towards what
   the screen wants proves nothing. */
const ANSWER = (over = {}) => ({
  ok: true,
  units: "dollars",
  client_id: CID,
  guardrail_threshold: { value: 0.30, source: "default", note: null },
  deal: {
    cashPosition: {
      netCashToClient: 222000,
      deposit: 3000,
      fee: { total: 25000, paidDown: 0, fromProceeds: 25000 }
    },
    monthly: {
      intro: { month1Payment: 5000, balanceAtIntroExpiry: 196000, schedule: [], note: "" },
      postIntro: { interestOnlyMonthly: 4067 },
      amort: { fundingAmount: 0, monthlyPayment: null, amortApr: null, amortTermMonths: null }
    },
    cliff: { triggered: false, interest: 4067, minPayment: 3920, message: null }
  },
  net: {
    approved_funding: 250000,
    success_fee: 25000,
    fee_from_proceeds: 25000,
    fee_paid_out_of_pocket: 0,
    deposit: 3000,
    net_cash_to_client: 222000,
    existing_debts: null,
    existing_debts_source: null,
    net_cash_after_debts: null
  },
  funding: {
    totalAvailableCredit: 15000,
    allocation: {
      requestedAmount: 12000,
      totalDrawn: 12000,
      shortfall: 0,
      fullyFunded: true,
      draws: [
        { lender: "Amex", creditLimit: 10000, currentBalance: 0, availableHeadroom: 10000, apr: 0.1899, draw: 10000 },
        { lender: "Chase Ink", creditLimit: 5000, currentBalance: 0, availableHeadroom: 5000, apr: 0.2499, draw: 2000 }
      ]
    },
    payMethodComparison: null,
    guardrail: {
      threshold: 0.30,
      aggregateUtilizationBefore: 0,
      aggregateUtilization: 0.8,
      aggregateUtilizationDelta: 0.8,
      aggregateBreaches: true,
      perCard: [
        { lender: "Amex", utilizationBefore: 0, utilizationAfter: 1, utilizationDelta: 1,
          causedBreach: true, preExistingOver: false, breaches: true },
        { lender: "Chase Ink", utilizationBefore: 0, utilizationAfter: 0.4, utilizationDelta: 0.4,
          causedBreach: true, preExistingOver: false, breaches: true }
      ],
      hardStop: true,
      message: "HARD STOP: this draw pushes aggregate utilization across 30%."
    }
  },
  cards: {
    source: "tradelines",
    on_file: 2,
    considered: 2,
    excluded_installment: 0,
    excluded_no_credit_limit: 0,
    balance_unknown: 0,
    apr_unknown: 0,
    list: [
      { id: "a", lender: "Amex", credit_limit: 10000, current_balance: 0, balance_known: true, apr: 0.1899 },
      { id: "b", lender: "Chase Ink", credit_limit: 5000, current_balance: 0, balance_known: true, apr: 0.2499 }
    ]
  },
  reasons: [],
  ...over
});

/* An answer with no client and nothing typed — the state the screen opens in. */
const EMPTY_ANSWER = () => ANSWER({
  client_id: null,
  deal: { cashPosition: { netCashToClient: null, fee: null, deposit: null }, monthly: null, cliff: null },
  net: {
    approved_funding: null, success_fee: null, fee_from_proceeds: null,
    fee_paid_out_of_pocket: null, deposit: null, net_cash_to_client: null,
    existing_debts: null, existing_debts_source: null, net_cash_after_debts: null
  },
  funding: null,
  cards: null,
  reasons: ["no_client_named", "no_approved_funding"]
});

const ok = (body) => () => ({ status: 200, body });
const failWith = (status, body) => () => ({ status, body });

/* Any run of digits with a decimal point — the shape of money on this page.
   A shape test rather than a list, so it catches a figure nobody thought to
   forbid. It caught a money-shaped placeholder on the subscriptions screen the
   first time it ran. */
const MONEY_SHAPED = /\b\d[\d,]*\.\d{2}\b/;

/* ── what the screen asks for ─────────────────────────────────────────────── */

describe("deal-model.html — the request it makes", () => {

  test("it asks once on load, by POST, with the client from the address bar", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].path, "/api/finance/model");
    assert.equal(s.sent[0].method, "POST");
    assert.equal(s.sent[0].body.client_id, CID);
  });

  test("it never sends an org — that comes from the session and the endpoint refuses one", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    assert.ok(!("org_id" in s.sent[0].body), "the screen sent an org_id");
    assert.ok(!("orgId" in s.sent[0].body));
  });

  test("empty boxes are LEFT OUT, not sent as zero", async () => {
    // A screen that sends 0 for an empty deposit box has decided something on
    // the client's behalf; the calculator's own defaults are the only defaults.
    const s = await runScreen({ respond: ok(EMPTY_ANSWER()) });
    assert.deepEqual(Object.keys(s.sent[0].body), ["client_id"]);
  });

  test("what somebody typed is what gets sent, untouched", async () => {
    const s = await runScreen({
      values: { dmFunding: "250000", dmFeePct: "0.1", dmDeposit: "3000", dmRequested: "12000",
                dmThreshold: "0.25", dmDebts: "12000" },
      respond: ok(ANSWER())
    });
    const b = s.sent[0].body;
    assert.equal(b.approved_funding, "250000");
    assert.equal(b.fee_pct, "0.1", "the fee rate was converted in the browser");
    assert.equal(b.down_payment, "3000");
    assert.equal(b.existing_debts, "12000");
    assert.equal(b.requested_amount, "12000");
    assert.equal(b.utilization_threshold, "0.25");
  });

  test("with no client in the URL it still models, and sends no client id", async () => {
    const s = await runScreen({ search: "", respond: ok(EMPTY_ANSWER()) });
    assert.equal(s.sent.length, 1);
    assert.ok(!("client_id" in s.sent[0].body));
  });
});

/* ── rule 1: no number the server did not send ────────────────────────────── */

describe("deal-model.html — nobody ever sees an invented number", () => {

  test("the page carries no money at all before an answer arrives", async () => {
    // Nothing has resolved yet at the moment the form is written, so this is the
    // state a person sees for the first few hundred milliseconds.
    const s = await runScreen({ respond: ok(EMPTY_ANSWER()) });
    const form = s.els.modelMount.innerHTML;
    assert.ok(!MONEY_SHAPED.test(form),
      "a money-shaped figure is sitting in the form, placeholder or not:\n" + form);
  });

  test("an empty answer produces words, not figures", async () => {
    const s = await runScreen({ search: "", respond: ok(EMPTY_ANSWER()) });
    assert.ok(!MONEY_SHAPED.test(s.html()), "money appeared with nothing typed:\n" + s.results());
    assert.match(s.results(), /approved funding amount/i);
    assert.match(s.results(), /No client is named/);
  });

  test("a refused request shows the server's own sentence and no figures", async () => {
    const s = await runScreen({
      values: { dmFeePct: "10" },
      // The sentence is the server's, verbatim, minus its own worked example —
      // that example is money-shaped and would defeat the shape test below,
      // which is the point of the shape test rather than a fault in it.
      respond: failWith(400, { ok: false, error: "fee_pct is a fraction, not a percentage" })
    });
    assert.ok(!MONEY_SHAPED.test(s.results()), "a refusal left money on screen:\n" + s.results());
    assert.match(s.results(), /fraction, not a percentage/,
      "the only part of the answer somebody can act on was thrown away");
  });

  test("a crashed handler is not reported as a database outage (audit m17)", async () => {
    const s = await runScreen({ respond: failWith(500, { ok: false, error: "internal_error" }) });
    assert.match(s.banner(), /something went wrong on our side/);
    assert.ok(!MONEY_SHAPED.test(s.results()));
  });

  test("a route that is registered but unfinished reads as 'not built yet', not an outage", async () => {
    const s = await runScreen({ respond: failWith(501, { ok: false, error: "not_implemented" }) });
    assert.match(s.banner(), /not built yet/);
  });

  test("a signed-out session says so and shows nothing", async () => {
    const s = await runScreen({ respond: failWith(403, { ok: false, error: "forbidden" }) });
    assert.match(s.results(), /not signed in|cannot model/);
    assert.ok(!MONEY_SHAPED.test(s.results()));
  });

  test("a demo session does not reach the server at all", async () => {
    const s = await runScreen({ demo: true, respond: () => { throw new Error("a demo session wrote"); } });
    assert.deepEqual(s.sent, []);
    assert.ok(!MONEY_SHAPED.test(s.results()));
  });
});

/* ── rule 2: the em dash ──────────────────────────────────────────────────── */

describe("deal-model.html — an unknown is an em dash", () => {

  test("a card with no recorded limit shows a dash, not 0.00", async () => {
    const a = ANSWER();
    a.cards.list[1] = { id: "b", lender: "Chase Ink", credit_limit: null, current_balance: null,
                        balance_known: false, apr: null };
    a.cards.excluded_no_credit_limit = 1;
    a.cards.considered = 1;
    a.cards.balance_unknown = 1;
    a.cards.apr_unknown = 1;
    a.funding.allocation = null;   // no amount asked for, so the list is shown
    const s = await runScreen({ respond: ok(a) });
    /* Assert on the ROW, not on the page: Amex genuinely has a zero balance in
       this fixture, and "0.00" appearing somewhere on screen is correct for it.
       What must never happen is the unknown card rendering as a figure. */
    const chaseRow = s.results().split("<tr").find((r) => r.indexOf("<td>Chase Ink</td>") !== -1);
    assert.ok(chaseRow, "the unknown card was not rendered at all");
    assert.equal((chaseRow.match(/is-unknown/g) || []).length, 3,
      "rate, limit and balance are all unknown and all three must be em dashes:\n" + chaseRow);
    assert.ok(!/0\.00/.test(chaseRow), "an unknown was rendered as 0.00:\n" + chaseRow);
  });

  test("a total over cards with holes in it is marked as a floor, not a total", async () => {
    const a = ANSWER();
    a.cards.excluded_no_credit_limit = 1;
    a.cards.considered = 1;
    a.funding.allocation = null;
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /is-partial/, "the floor marker is missing from a partial total");
    assert.match(s.results(), /this is a floor/);
  });

  test("a card with no recorded balance is called out — the guardrail is optimistic about it", async () => {
    const a = ANSWER();
    a.cards.balance_unknown = 1;
    a.cards.list[0].balance_known = false;
    a.cards.list[0].current_balance = null;
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /no recorded balance/);
    assert.match(s.results(), /more forgiving than it should be/,
      "the screen showed an optimistic verdict without saying it was optimistic");
  });

  test("no debts typed means the debts lines do not appear at all", async () => {
    // An em dash here would read as "we do not know this client's debts", which
    // is a much larger claim than "no payoff was typed into this model".
    const s = await runScreen({ respond: ok(ANSWER()) });
    assert.ok(!/Debts to pay off/.test(s.results()));
    assert.ok(!/Cash left after debts/.test(s.results()));
  });

  test("debts typed produce their own line and their own total", async () => {
    const a = ANSWER();
    a.net.existing_debts = 12000;
    a.net.net_cash_after_debts = 210000;
    a.net.existing_debts_source = "entered_on_this_screen";
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /Debts to pay off/);
    assert.match(s.results(), /210,000\.00/);
    assert.match(s.results(), /typed into this screen/,
      "an operator's assumption is presented as a stored deal term");
  });
});

/* ── the four lines of the sum ────────────────────────────────────────────── */

describe("deal-model.html — the net cash figure can be taken apart", () => {

  test("funding, fee, deposit and the total are each on screen", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    const h = s.results();
    assert.match(h, /Approved funding/);
    assert.match(h, /250,000\.00/);
    assert.match(h, /Success fee/);
    assert.match(h, /25,000\.00/);
    assert.match(h, /Deposit taken up front/);
    assert.match(h, /3,000\.00/);
    assert.match(h, /Cash to the client/);
    assert.match(h, /222,000\.00/);
  });

  test("the monthly obligation and the cliff verdict are shown", async () => {
    const a = ANSWER();
    a.deal.cliff = { triggered: true, interest: 4067, minPayment: 3920,
                     message: "Post-intro interest exceeds the minimum payment." };
    const s = await runScreen({ respond: ok(a) });
    // The apostrophe is escaped on the way out, which is the point of esc().
    assert.match(s.results(), /First month&#39;s minimum payment/);
    assert.match(s.results(), /Balance grows after the intro rate ends/);
    assert.match(s.results(), /Post-intro interest exceeds the minimum payment\./);
  });
});

/* ── rule 3: the two verdicts are different verdicts ──────────────────────── */

describe("deal-model.html — hard stop and pre-existing are not the same sentence", () => {

  test("a draw that crosses the line names the cards that caused it", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    assert.match(s.results(), /Hard stop — this draw crosses the line/);
    assert.match(s.results(), /Caused by/);
    assert.match(s.results(), /Amex/);
    assert.match(s.results(), /draw less/i);
  });

  test("a client already over the line is a note, and is not called a hard stop", async () => {
    const a = ANSWER();
    a.funding.guardrail = {
      threshold: 0.30,
      aggregateUtilizationBefore: 0.307, aggregateUtilization: 0.373, aggregateUtilizationDelta: 0.067,
      aggregateBreaches: false,
      perCard: [
        { lender: "Amex", utilizationBefore: 0, utilizationAfter: 0.1, utilizationDelta: 0.1,
          causedBreach: false, preExistingOver: false, breaches: false },
        { lender: "Chase Ink", utilizationBefore: 0.92, utilizationAfter: 0.92, utilizationDelta: 0,
          causedBreach: false, preExistingOver: true, breaches: false }
      ],
      hardStop: false,
      message: "NOTE: 1 card(s) already above 30% on existing balances before any draw."
    };
    const s = await runScreen({ respond: ok(a) });
    assert.ok(!/Hard stop/.test(s.results()),
      "a pre-existing balance was presented as a block on this deal:\n" + s.results());
    assert.match(s.results(), /already over/);
    assert.match(s.results(), /pre-existing condition/);
    assert.match(s.results(), /Chase Ink/);
    assert.match(s.results(), /pay-down conversation/);
  });

  test("clear is clear, with nothing hedged into it", async () => {
    const a = ANSWER();
    a.funding.guardrail.hardStop = false;
    a.funding.guardrail.aggregateBreaches = false;
    a.funding.guardrail.message = null;
    a.funding.guardrail.perCard = a.funding.guardrail.perCard.map((c) => ({
      ...c, causedBreach: false, preExistingOver: false, breaches: false
    }));
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /No card crosses the line because of this draw/);
    assert.ok(!/Hard stop/.test(s.results()));
  });

  test("the line the verdict was measured against is on the page, with where it came from", async () => {
    const a = ANSWER();
    a.guardrail_threshold = { value: 0.25, source: "request", note: null };
    a.funding.guardrail.threshold = 0.25;
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /Measured against 25%/);
    assert.match(s.results(), /typed into the box/);
  });
});

/* ── the waterfall ────────────────────────────────────────────────────────── */

describe("deal-model.html — the waterfall", () => {

  test("the draws are listed in the order the server sent them, with the amounts", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    const h = s.results();
    assert.ok(h.indexOf("Amex") < h.indexOf("Chase Ink"), "the waterfall was reordered on screen");
    assert.match(h, /10,000\.00/);
    assert.match(h, /Drawn in total/);
  });

  test("a draw that cannot be filled says so and shows the shortfall", async () => {
    const a = ANSWER();
    a.funding.allocation.requestedAmount = 18000;
    a.funding.allocation.totalDrawn = 15000;
    a.funding.allocation.shortfall = 3000;
    a.funding.allocation.fullyFunded = false;
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /cannot be filled/);
    assert.match(s.results(), /Short by/);
    assert.match(s.results(), /3,000\.00/);
  });

  test("a client with no cards is sent to the card stack, not modelled against nothing", async () => {
    const a = ANSWER({ funding: null, reasons: ["no_tradelines_on_file"] });
    a.cards = { source: "tradelines", on_file: 0, considered: 0, excluded_installment: 0,
                excluded_no_credit_limit: 0, balance_unknown: 0, apr_unknown: 0, list: [] };
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /No cards are on file/);
    assert.match(s.results(), new RegExp('href="card-stack\\.html\\?client_id=' + CID + '"'),
      "there is no way from here to the screen that fixes it");
  });

  test("instalment-only lines get their own sentence — an auto loan is not drawable", async () => {
    const a = ANSWER({ funding: null, reasons: ["no_drawable_cards_on_file"] });
    a.cards = { source: "tradelines", on_file: 1, considered: 0, excluded_installment: 1,
                excluded_no_credit_limit: 0, balance_unknown: 0, apr_unknown: 0, list: [] };
    const s = await runScreen({ respond: ok(a) });
    assert.match(s.results(), /cannot be borrowed from/);
  });
});

/* ── rule 4: escaping ─────────────────────────────────────────────────────── */

describe("deal-model.html — record data is never markup", () => {

  test("a lender name carrying a tag is escaped everywhere it appears", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const a = ANSWER();
    a.funding.allocation.draws[0].lender = evil;
    a.funding.guardrail.perCard[0].lender = evil;
    a.cards.list[0].lender = evil;
    const s = await runScreen({ respond: ok(a) });
    assert.ok(!/<img/.test(s.results()), "a lender name reached the page as markup:\n" + s.results());
    assert.match(s.results(), /&lt;img/);
  });

  test("a server error message is escaped too", async () => {
    const s = await runScreen({
      respond: failWith(400, { ok: false, error: '<script>alert(1)</script>' })
    });
    assert.ok(!/<script>alert/.test(s.results()));
  });
});

/* ── rule 1, the case that is easy to miss ────────────────────────────────── */

describe("deal-model.html — a failed run clears the last good answer", () => {

  test("the figures do not survive a failure under changed inputs", async () => {
    /* Two runs in one page: the first answers, the second fails. Leaving the
       first answer's money on screen would show a figure that answers a question
       nobody asked — the M8 shape with an extra step. The screen state is
       exercised through the wiring itself: the second call is made by the same
       script, so this asserts on what the page ENDS UP showing. */
    let call = 0;
    const s = await runScreen({
      respond: () => {
        call += 1;
        return call === 1
          ? { status: 200, body: ANSWER() }
          : { status: 500, body: { ok: false, error: "internal_error" } };
      }
    });
    assert.match(s.results(), /222,000\.00/, "the first answer never rendered");

    // Press the button again, through the page's own handler.
    await s.fire("modelForm", "submit");
    assert.equal(s.sent.length, 2, "the button did not ask again");
    assert.ok(!MONEY_SHAPED.test(s.results()),
      "the last good answer is still on screen after a failed run:\n" + s.results());
    assert.match(s.results(), /something went wrong on our side/);
  });

  test("typing schedules a run rather than firing one per keystroke", async () => {
    const s = await runScreen({ respond: ok(ANSWER()) });
    assert.equal(s.sent.length, 1);
    await s.fire("modelForm", "input");
    assert.equal(s.sent.length, 1, "a keystroke went straight to the server");
    await new Promise((r) => setTimeout(r, 600));
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
    assert.equal(s.sent.length, 2, "the debounced run never fired");
  });
});

/* ── the way out ──────────────────────────────────────────────────────────── */

describe("deal-model.html — the frame", () => {

  test("there is a real href back to the Command Center, not a scripted back step", async () => {
    assert.match(HTML, /href="command-center\.html"/);
    // The check is against the WIRING, not the whole file: the comment above the
    // link names the defect it exists to avoid, which is house style here, and a
    // test that forbids the word forbids explaining it.
    assert.ok(!/history\s*\.\s*back\s*\(/.test(inlineScript()),
      "a scripted back step does nothing when the page was opened from a pasted URL (audit M20)");
  });

  test("the scaffold placeholder is gone", async () => {
    assert.ok(!/modelMountPlaceholder/.test(HTML));
    assert.ok(!/not built yet/.test(HTML.split("<script>")[0]),
      "the page still tells a reader it is unbuilt");
  });

  test("the shared stylesheet is linked, so the em-dash rule is the shared one", async () => {
    assert.match(HTML, /href="finance-os\.css"/);
  });

  test("it says nothing here is saved — the endpoint writes nothing", async () => {
    assert.match(HTML, /Nothing on this page is saved/);
  });
});
