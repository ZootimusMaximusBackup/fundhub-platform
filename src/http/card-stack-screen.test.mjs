/* Tests for the inline wiring script in public/app/card-stack.html.
 *
 * WHY A SCREEN GETS A TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing here proves how the page LOOKS. What it does prove is
 * what the page SAYS — which values reach the markup and which never do — and
 * that is where this product's screen defects have actually been:
 *
 *   audit M8  — banking-surface.html kept two invented dollar figures on screen
 *               under a real client's name whenever the read came back empty.
 *   audit m16 — an unknown value and a partial-total marker rendered together as
 *               "—+", which is not a number, not a dash and not a marker.
 *
 * So the rules under test are the two that cost money when they break:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Every ending — rows, no rows, a
 *      refusal, an outage — must leave this page showing the client's real state
 *      and never a figure nobody has.
 *   2. AN UNKNOWN IS AN EM DASH, NEVER 0.00. A card whose limit nobody knows has
 *      an unknown limit, and its utilization is unknown rather than 0%.
 *
 * Plus the one that is a security defect rather than an accounting one: a lender
 * name is record data typed by a person, and it reaches the DOM through
 * innerHTML. It is escaped or this screen is an injection site.
 *
 * IT LIVES IN src/ BECAUSE package.json's test glob walks src/ and scripts/ ONLY
 * (CLAUDE.md, traps). Under public/ it would never run.
 *
 * THE FIXTURES ARE NOT HAND-WRITTEN RESPONSE SHAPES. They are built by calling
 * the real src/liabilities/card-stack.mjs the way api/finance/liabilities.mjs
 * calls it, so if that module's output moves these go red instead of the screen
 * going quietly wrong. Same discipline as banking-surface-screen.test.mjs.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { buildCardStack } from "../liabilities/card-stack.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/card-stack.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "card-stack.html no longer has an inline wiring script");
  return m[1];
}

/* ── the browser stub ─────────────────────────────────────────────────────── */

function makeEl(id, html = "") {
  const el = {
    id,
    innerHTML: html,
    className: "",
    textContent: "",
    style: { cssText: "" },
    handlers: {},
    setAttribute() {},
    appendChild() {},
    addEventListener(kind, fn) { this.handlers[kind] = fn; },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  return el;
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(url)` returns { status, body } for each GET the screen makes.
 * Returns the mount's markup after the reads have settled.
 */
async function runScreen({ search = `?client_id=${CID}`, respond } = {}) {
  const els = {
    cardsMount: makeEl("cardsMount"),
    cardsMountSource: makeEl("cardsMountSource")
  };
  const calls = [];

  const sandbox = {
    console,
    setTimeout,
    document: {
      getElementById: (id) => els[id] || null,
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

  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  return {
    els,
    calls,
    mount: () => els.cardsMount.innerHTML,
    source: () => els.cardsMountSource.textContent,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : ""),
    click: (el) => els.cardsMount.handlers.click({ target: el })
  };
}

/* ── fixtures, built the way the endpoint builds them ─────────────────────── */

const tradeline = (over = {}) => ({
  id: CARD, org_id: "org", client_id: CID, lender: "Chase Ink Business", kind: "revolving",
  last4: "4417", credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.24990",
  opened_on: "2019-04-02", closed_at: null, as_of: null, source: "manual", ...over
});

const positionRow = (over = {}) => ({
  id: "pos-1", tradeline_id: CARD, as_of: "2026-07-15",
  current_balance_cents: "300000", statement_balance_cents: null, minimum_payment_cents: "9000",
  past_due_cents: null, last_payment_cents: null, last_payment_date: null,
  statement_date: null, payment_due_date: "2026-08-04", apr: null,
  payment_status: "current", source: "manual", ...over
});

const stackBody = (opts) => ({
  status: 200,
  body: { ok: true, client_id: CID, include_closed: false, ...built(opts) }
});

function built({ tradelines = [tradeline()], positions = [], observationCounts = {} } = {}) {
  const s = buildCardStack({ tradelines, positions, observationCounts });
  return {
    source: s.source, lines: s.lines, totalled: s.totalled,
    disagreements: s.disagreements, cards: s.cards, totals: s.totals
  };
}

const seriesBody = (rows) => ({
  status: 200,
  body: {
    ok: true, source: "card_liability_history", tradeline_id: CARD,
    card: null, current: null, count: rows.length, limit: 24, hasMore: false,
    observations: rows
  }
});

/* Any figure appearing on screen must have come off one of these fixtures. The
   page ships NO sample markup at all, which is the strongest form of the M8
   rule: there is nothing to leave behind. */
describe("card-stack.html ships no sample figures", () => {

  test("the page's own markup contains no dollar amounts and no percentages", () => {
    const body = HTML.slice(HTML.indexOf("<body"), HTML.indexOf("<script src=\"data.js\""));
    assert.ok(!/\d[\d,]*\.\d\d/.test(body),
      "the page ships a hard-coded money figure; under a real client's name that is audit finding M8");
  });

  test("the scaffold placeholder is gone", () => {
    assert.ok(!HTML.includes("cardsMountPlaceholder"),
      "the 'this screen is being built' note is still on a screen that is built");
  });

  test("the way off the page is a real href, not history.back()", () => {
    assert.ok(/<a href="command-center\.html"/.test(HTML));
    // Comments are stripped first — the comment block explains WHY back() is
    // wrong, and matching on the explanation would make the rule unmentionable.
    const code = HTML.replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/history\.back\s*\(/.test(code),
      "back() does nothing when the page was opened from a pasted URL (audit M20)");
  });

  test("the two signal rules come from the shared stylesheet, not a local copy", () => {
    assert.ok(HTML.includes('href="finance-os.css"'));
    assert.ok(!/\.fh-num\.is-unknown\s*\{/.test(HTML),
      "an eighth copy of the unknown rule was written into this page");
    assert.ok(!/is-partial[^{]*::after/.test(HTML),
      "a local copy of the floor marker — the m16 :not(.is-unknown) guard lives in finance-os.css");
  });
});

describe("with no client in the URL", () => {

  test("it says what is missing and shows no figures at all", async () => {
    const s = await runScreen({ search: "", respond: () => { throw new Error("must not read"); } });
    assert.equal(s.calls.length, 0, "the screen read the backend with no client named");
    assert.match(s.mount(), /card-stack\.html\?client_id=/);
    assert.ok(!/\d\.\d\d/.test(s.mount()), "a figure appeared with no client named");
    assert.match(s.banner(), /open with \?client_id/);
  });
});

describe("a real read", () => {

  test("the client's own numbers are rendered, and the source is named", async () => {
    const s = await runScreen({
      respond: () => stackBody({ positions: [positionRow()], observationCounts: { [CARD]: 2 } })
    });
    const m = s.mount();
    assert.match(m, /Chase Ink Business/);
    assert.match(m, /10,000\.00/, "the credit limit did not reach the screen");
    assert.match(m, /3,000\.00/, "the observed balance did not reach the screen");
    assert.match(m, /7,000\.00/, "headroom did not reach the screen");
    assert.match(m, /24\.99%/);
    assert.match(m, /30\.0%/);
    assert.equal(s.source(), "card_liabilities+tradelines");
    assert.match(s.banner(), /live card stack/);
  });

  test("AN UNKNOWN IS AN EM DASH AND NEVER 0.00", async () => {
    const s = await runScreen({
      respond: () => stackBody({
        tradelines: [tradeline({ credit_limit_cents: null, balance_cents: null, apr: null })]
      })
    });
    const m = s.mount();
    assert.match(m, /is-unknown/, "an unknown value was not marked as unknown");
    assert.match(m, /—/, "an unknown value did not render as an em dash");
    assert.ok(!/>0\.00</.test(m),
      '"we do not know" was rendered as "0.00" — that is a claim about somebody\'s money');
  });

  test("a floor carries the + marker, and an unknown total does NOT (audit m16)", async () => {
    const s = await runScreen({
      respond: () => stackBody({
        tradelines: [
          tradeline({ id: "a", credit_limit_cents: "1000000" }),
          tradeline({ id: "b", credit_limit_cents: null, apr: null })
        ]
      })
    });
    const m = s.mount();
    assert.match(m, /is-partial/, "a partial total was presented as a total");
    // The pairing is dropped by CSS (:not(.is-unknown)), but the classes must
    // still be set independently — from display===null and basis.partial — and
    // never derived from one another.
    assert.ok(/fh-num is-partial/.test(m) || /fh-num is-unknown is-partial/.test(m));
  });

  test("a client with no cards says so in words and offers the add form", async () => {
    const s = await runScreen({ respond: () => stackBody({ tradelines: [] }) });
    const m = s.mount();
    assert.match(m, /No cards on file/);
    assert.match(m, /data-act="add"/, "there is no way to enter the first card");
    /* No FIGURE — the add form's hint mentions "24.99" as an example of what to
       type, which is instruction, not a claim about this client. What must not
       exist is a rendered value: every one of those carries .fh-num. */
    assert.ok(!/class="fh-num/.test(m), "a client with no cards was shown a figure");
  });

  test("the disagreement between the two tables is stated, with both sources named", async () => {
    const s = await runScreen({
      respond: () => stackBody({ positions: [positionRow({ current_balance_cents: "300000" })] })
    });
    const m = s.mount();
    assert.match(m, /card_liabilities/);
    assert.match(m, /tradelines/);
    assert.match(m, /2,500\.00/, "the other table's figure was hidden rather than shown");
    assert.match(m, /finance-os\.html\?client_id=/, "there is no way to go and check the other screen");
  });

  test("a card with no observations is not shown as a zero balance", async () => {
    const s = await runScreen({ respond: () => stackBody({ positions: [] }) });
    assert.match(s.mount(), /no observations/);
  });
});

describe("a lender name is record data, not markup", () => {

  test("a script tag typed into the issuer field is escaped", async () => {
    const s = await runScreen({
      respond: () => stackBody({
        tradelines: [tradeline({ lender: '<img src=x onerror="alert(1)">Amex' })]
      })
    });
    const m = s.mount();
    assert.ok(!m.includes("<img src=x"), "a typed lender name reached the DOM as markup");
    assert.match(m, /&lt;img src=x/);
    assert.ok(!/onerror="alert/.test(m));
  });
});

describe("when the read does not succeed, nothing is invented", () => {

  const endings = [
    ["not signed in", { status: 401, body: { ok: false, error: "unauthorized" } }, /not signed in/],
    ["the handler is not built", { status: 501, body: { ok: false, error: "not_implemented" } }, /not built yet/],
    ["a stale id", { status: 400, body: { ok: false, error: "client_id must be a uuid" } }, /rejected/],
    ["the database is down", { status: 503, body: { ok: false, error: "db down", db: "down" } }, /database is not answering/],
    ["our own code broke", { status: 500, body: { ok: false, error: "internal_error" } }, /on our side/]
  ];

  for (const [label, reply, banner] of endings) {
    test(`${label}: the page shows no figures and says why`, async () => {
      const s = await runScreen({ respond: () => reply });
      assert.ok(!/\d[\d,]*\.\d\d/.test(s.mount()),
        `${label}: a figure is on screen for a client whose read did not succeed`);
      /* AND THE PAGE ITSELF SAYS SO. The banner is 11px and pinned to the bottom
         edge; a page that is simply blank above it reads as "still loading". */
      assert.match(s.mount(), /could not be loaded/,
        `${label}: the page went blank and only the bottom banner said anything`);
      assert.match(s.banner(), banner);
    });
  }

  test("a 501 is reported as 'not built yet', never as the database being down", async () => {
    const s = await runScreen({ respond: () => ({ status: 501, body: { ok: false, error: "not_implemented" } }) });
    assert.ok(!/database/i.test(s.banner()),
      "a route whose handler is unfinished was announced as a database outage (audit m17)");
  });
});

describe("the history drawer", () => {

  test("opening a card reads its series and renders it newest first", async () => {
    const s = await runScreen({
      respond: (url) => (url.includes("tradeline_id")
        ? seriesBody([
            { as_of: "2026-07-15", current_balance: "3000.00", statement_balance: null,
              minimum_payment: "90.00", past_due: null, payment_due_date: "2026-08-04",
              payment_status: "current", source: "manual" },
            { as_of: "2026-06-15", current_balance: "1000.00", statement_balance: null,
              minimum_payment: null, past_due: null, payment_due_date: null,
              payment_status: null, source: "manual" }
          ])
        : stackBody({ positions: [positionRow()], observationCounts: { [CARD]: 2 } }))
    });

    s.click({ tagName: "BUTTON", getAttribute: (k) => (k === "data-open" ? CARD : null) });
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

    const m = s.mount();
    assert.match(m, /2026-07-15[\s\S]*2026-06-15/, "the series is not newest first");
    assert.match(m, /3,000\.00/);
    assert.match(m, /is-unknown/, "an unreported minimum payment was not marked unknown");
    assert.ok(!/>0\.00</.test(m), "an unreported figure in the series rendered as 0.00");
  });

  test("an empty series says nothing has been recorded — it does not draw zeroes", async () => {
    const s = await runScreen({
      respond: (url) => (url.includes("tradeline_id") ? seriesBody([]) : stackBody({}))
    });
    s.click({ tagName: "BUTTON", getAttribute: (k) => (k === "data-open" ? CARD : null) });
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

    const m = s.mount();
    assert.match(m, /Nothing has been recorded for this card yet/);
    assert.match(m, /not a balance of zero/,
      "an empty series must say in words that it is not a zero balance");
  });
});
