/* Tests for public/app/finance-os.html — the client hub.
 *
 * WHAT THIS SCREEN WAS, AND WHY IT WAS REBUILT. finance-os.html was a seven-row
 * read-only credit grid and nothing else. Six tracks then built six screens over
 * six live endpoints, and the result was six separate pages with no way in and no
 * way between them: the only method of naming a client anywhere in the Finance OS
 * was to paste a uuid into the address bar, and the first click lost it. This
 * file is the hub those six hang off — a client picker, one real headline number
 * per area read from that area's own endpoint, and a link through to each
 * carrying the client.
 *
 * THE RULES UNDER TEST, ALL THREE LEARNED EXPENSIVELY:
 *
 *   1. A SCREEN NEVER SHOWS A NUMBER THE SERVER DID NOT SEND. The old file
 *      carried seven rows of invented money — 15,000.00, 3,500.00, 19.74% — so
 *      that it "never blanks", and those figures stayed on screen under a real
 *      client's name whenever the read failed. That is audit finding M8. Every
 *      card here starts as the word "Loading" and every empty state is a
 *      sentence.
 *   2. UNKNOWN IS AN EM DASH, NEVER 0.00. "We do not know what this client pays"
 *      and "this client pays nothing" are different facts and only one of them
 *      is a claim about somebody's money.
 *   3. A TOTAL WITH HOLES IN IT IS A FLOOR AND SAYS SO. The "+" is the same
 *      signal the grid below it uses, drawn by the same shared stylesheet.
 *
 * HOW IT IS TESTED. The page's own wiring script is executed against a stub
 * browser whose fetch answers each of the seven URLs with the real response shape
 * of the endpoint behind it, and the assertions are made on the markup the script
 * actually produced. It is not a text scan of the file: the question is what
 * reaches the reader, and a regex over the source passes on code that never runs.
 *
 * WHAT IT CANNOT TEST. There is no browser and no Playwright in this repo. Every
 * assertion here is about what the page DECIDES to display. Nothing here says
 * anything about layout, spacing, colour or legibility — a human has to open it.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { financeOsGrid } from "../finance/os-grid.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const DATA_JS = path.join(APP, "data.js");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");
const HTML = fs.readFileSync(path.join(APP, "finance-os.html"), "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/** The page's own wiring, verbatim. `<script src=...>` tags carry attributes and
    so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "finance-os.html no longer has an inline wiring script");
  return m[1];
}

/* ── the stub browser ─────────────────────────────────────────────────────── */

const IDS = [
  "fosSource", "fosGrid", "fosClient", "fosWho", "fosPickMsg", "fosPanel", "fosAreas",
  "fosCardPlan", "fosCardCards", "fosCardBank", "fosCardBills", "fosCardAlerts", "fosCardModel",
  "fosBodyPlan", "fosBodyCards", "fosBodyBank", "fosBodyBills", "fosBodyAlerts", "fosBodyModel"
];

function makeEl(id) {
  const classes = [];
  return {
    id, innerHTML: "", textContent: "", className: "", value: "",
    style: { cssText: "" },
    classList: {
      add: (c) => { if (!classes.includes(c)) classes.push(c); },
      remove: (c) => { const i = classes.indexOf(c); if (i > -1) classes.splice(i, 1); },
      contains: (c) => classes.includes(c)
    },
    _classes: classes,
    setAttribute(k, v) { this["_" + k] = v; },
    getAttribute(k) { return this["_" + k] ?? null; },
    appendChild() {},
    addEventListener() {}
  };
}

/**
 * FIXTURES — one per endpoint, in the response shape the handler actually sends.
 * Kept as functions so a test can vary one endpoint without restating the other
 * six, which is how a fixture set stops describing the product.
 */
const tradeline = (over = {}) => ({
  id: "tl-1", kind: "revolving", closed_at: null, lender: "Amex",
  credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.1899", ...over
});

const DEFAULTS = () => ({
  "/api/dashboard/clients": {
    ok: true,
    clients: [{ id: CID, first_name: "Dana", last_name: "Okoro", email: "d@x.test" }]
  },
  "/api/read/finance-os": { ok: true, ...financeOsGrid([tradeline()]) },
  "/api/finance/subscriptions": {
    ok: true, client_id: CID,
    current: { id: "sub-1", tier: "gold", price_cents: 14900, price_display: "149.00" },
    history: [{ id: "sub-1" }, { id: "sub-0" }]
  },
  "/api/finance/liabilities": {
    ok: true, client_id: CID, lines: 2, totalled: 2, disagreements: 1,
    cards: [],
    totals: [
      { key: "credit_limit", display: "18,000.00", basis: { lines: 2, counted: 2, unknown: 0, partial: false } },
      { key: "balance", display: "4,400.00", basis: { lines: 2, counted: 1, unknown: 1, partial: true } }
    ]
  },
  "/api/finance/bank-accounts": {
    ok: true, client_id: CID,
    surface: {
      source: "bank_accounts", accounts: 3, open_accounts: 2, closed_accounts: 1,
      unclassified: 1, needs_classification: true, groups: []
    },
    details: {}
  },
  "/api/finance/bills": {
    ok: true, client_id: CID, bills: [{ id: "b1" }, { id: "b2" }],
    candidates: [], candidates_included: false, candidate_count: 3,
    accounts: [], transaction_count: 412
  },
  "/api/finance/alerts": {
    ok: true, scope: "client", client_id: CID, limit: 200,
    alerts: [{ id: "a1", state: "open" }, { id: "a2", state: "resolved" }]
  }
});

/**
 * runHub — evaluate data.js and the hub's wiring against a stub browser, and
 * hand back what it painted.
 *
 * `routes` maps a URL PREFIX to either a body (answered 200) or an object with
 * `status`, so a test can make exactly one of the seven reads fail and prove the
 * other six are unaffected.
 */
async function runHub({ search = "?client_id=" + CID, routes = {} } = {}) {
  const table = { ...DEFAULTS(), ...routes };
  const els = {};
  for (const id of IDS) els[id] = makeEl(id);
  const asked = [];

  const sandbox = {
    console,
    URLSearchParams,
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
    location: { search, href: "" },
    fetch: (url) => {
      asked.push(String(url));
      const key = Object.keys(table).find((p) => String(url).indexOf(p) === 0);
      if (!key) return Promise.reject(new Error("unexpected request: " + url));
      const hit = table[key];
      const status = hit && hit.__status ? hit.__status : 200;
      const body = hit && hit.__body !== undefined ? hit.__body : hit;
      return Promise.resolve({ status, json: () => Promise.resolve(body) });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  vm.runInContext(inlineScript(), sandbox, { filename: "finance-os.html#wiring" });

  // The wiring does not hand back its promises, so drain the queue instead.
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));

  return { els, asked, banner: els["fh-data-banner"] ? els["fh-data-banner"].textContent : "" };
}

const fail = (status, body) => ({ __status: status, __body: body });

/* ── the picker ───────────────────────────────────────────────────────────── */

describe("finance-os.html — the client picker", () => {

  test("the client list is read and the open client is named", async () => {
    const { els } = await runHub();
    assert.match(els.fosClient.innerHTML, /Dana Okoro/);
    assert.match(els.fosClient.innerHTML, new RegExp('value="' + CID + '" selected'));
    assert.match(els.fosWho.innerHTML, /Dana Okoro/,
      "the hub does not say whose file is open, which is how you end up editing the wrong one");
  });

  test("a client not in the list is called out, and the screen does not guess", async () => {
    const { els } = await runHub({
      routes: { "/api/dashboard/clients": { ok: true, clients: [] } }
    });
    assert.match(els.fosPickMsg.textContent, /not in the newest 0 clients/);
    assert.equal(els.fosPickMsg.className, "fh-msg bad");
  });

  test("a failed client list is reported, not left looking like an empty book", async () => {
    const { els, banner } = await runHub({
      routes: { "/api/dashboard/clients": fail(500, { ok: false, error: "boom" }) }
    });
    assert.match(els.fosClient.innerHTML, /could not be read/);
    assert.match(banner, /the client list/);
  });

  test("the control panel link uses ?id=, which is what that screen reads", async () => {
    const { els } = await runHub();
    assert.equal(els.fosPanel.getAttribute("href"),
      "client-control-panel.html?id=" + CID);
  });
});

/* ── the six areas ────────────────────────────────────────────────────────── */

describe("finance-os.html — one real number per area", () => {

  test("every area reads its own live endpoint, scoped to the open client", async () => {
    const { asked } = await runHub();
    for (const p of ["/api/finance/subscriptions", "/api/finance/liabilities",
                     "/api/finance/bank-accounts", "/api/finance/bills",
                     "/api/finance/alerts", "/api/read/finance-os"]) {
      const hit = asked.find((u) => u.indexOf(p) === 0);
      assert.ok(hit, `nothing read ${p} — that area's card cannot be showing a real number`);
      assert.match(hit, new RegExp("client_id=" + CID),
        `${p} was read without a client — the org scope is the session's, but the ` +
        `CLIENT has to be named or the card describes somebody else`);
    }
  });

  test("the plan card shows the price the server computed", async () => {
    const { els } = await runHub();
    assert.match(els.fosBodyPlan.innerHTML, /149\.00/);
    assert.match(els.fosBodyPlan.innerHTML, /gold/);
    assert.match(els.fosBodyPlan.innerHTML, /2 versions/);
  });

  test("a plan with no price agreed shows an em dash, never 0.00", async () => {
    const { els } = await runHub({
      routes: {
        "/api/finance/subscriptions": {
          ok: true, current: { tier: "gold", price_cents: null, price_display: null }, history: [{}]
        }
      }
    });
    assert.match(els.fosBodyPlan.innerHTML, /—/);
    assert.ok(!/0\.00/.test(els.fosBodyPlan.innerHTML),
      '"nobody has decided the price" was rendered as "this plan is free"');
    assert.match(els.fosBodyPlan.innerHTML, /is-unknown/);
  });

  test("a card-stack total with holes in it is marked as a floor", async () => {
    const { els } = await runHub();
    assert.match(els.fosBodyCards.innerHTML, /4,400\.00/);
    assert.match(els.fosBodyCards.innerHTML, /is-partial/,
      "a sum over cards where one did not report is a floor and must carry the +");
    assert.match(els.fosBodyCards.innerHTML, /counted 1 of 2/);
    assert.match(els.fosBodyCards.innerHTML, /disagree/,
      "two tables holding different balances for the same card is the one thing " +
      "this area must never resolve silently");
  });

  test("the bank card counts accounts and says what is unclassified", async () => {
    const { els } = await runHub();
    assert.match(els.fosBodyBank.innerHTML, /2</);          // open accounts
    assert.match(els.fosBodyBank.innerHTML, /3 on file, 1 closed/);
    assert.match(els.fosBodyBank.innerHTML, /not marked personal or business/);
  });

  test("the bills card separates 'nothing entered' from 'no pattern found'", async () => {
    const found = await runHub();
    assert.match(found.els.fosBodyBills.innerHTML, /412 charge\(s\) examined/);
    assert.match(found.els.fosBodyBills.innerHTML, /3 weaker pattern/);

    const looked = await runHub({
      routes: { "/api/finance/bills": { ok: true, bills: [], candidate_count: 0, transaction_count: 4000 } }
    });
    assert.match(looked.els.fosBodyBills.innerHTML, /found no repeating pattern/);

    const nothing = await runHub({
      routes: { "/api/finance/bills": { ok: true, bills: [], candidate_count: 0, transaction_count: 0 } }
    });
    assert.match(nothing.els.fosBodyBills.innerHTML, /No charges are recorded/,
      '"we looked and found nothing" and "nobody has entered anything" are ' +
      "opposite findings and this card must not print the same sentence for both");
  });

  test("the alerts card counts the OPEN ones out of everything on file", async () => {
    const { els } = await runHub();
    // The apostrophe arrives escaped, which is the point: every string on this
    // page goes through esc() because a client note or a lender name is record
    // data, never markup.
    assert.match(els.fosBodyAlerts.innerHTML, /2 on this client&#39;s file/);
    assert.match(els.fosBodyAlerts.innerHTML, /waiting on somebody/);
  });

  test("the modeling card promises no stored figure, because there is none", async () => {
    // api/finance/model.mjs answers POST only and stores nothing. Inventing a
    // headline here would mean computing one in the browser, which is a second
    // answer that goes stale.
    // Asserted against the FILE, not the painted element: this card is static
    // markup on purpose, because there is no read behind it to paint from.
    const { asked } = await runHub();
    assert.match(HTML, /saves nothing and charges nothing/);
    assert.ok(!asked.some((u) => u.indexOf("/api/finance/model") === 0),
      "the hub called the calculator endpoint; it has nothing to read");
  });
});

/* ── empty areas ──────────────────────────────────────────────────────────── */

describe("finance-os.html — an area with nothing in it says so and says where to go", () => {

  const EMPTY = {
    "/api/finance/subscriptions": { ok: true, current: null, history: [] },
    "/api/finance/liabilities":   { ok: true, lines: 0, totals: [], disagreements: 0 },
    "/api/finance/bank-accounts": { ok: true, surface: { accounts: 0, open_accounts: 0, closed_accounts: 0, unclassified: 0, needs_classification: false, groups: [] } },
    "/api/finance/bills":         { ok: true, bills: [], candidate_count: 0, transaction_count: 0 },
    "/api/finance/alerts":        { ok: true, alerts: [] }
  };

  test("each empty area explains itself in words and links where the data is entered", async () => {
    const { els } = await runHub({ routes: EMPTY });
    const cases = [
      ["fosBodyPlan",   /No plan has ever been started/,      "subscriptions.html"],
      ["fosBodyCards",  /No credit cards are recorded/,       "card-stack.html"],
      ["fosBodyBank",   /No bank accounts have been entered/, "bank-accounts.html"],
      ["fosBodyBills",  /No charges are recorded/,            "bills-cashflow.html"],
      ["fosBodyAlerts", /No alert has ever been raised/,      "alerts.html"]
    ];
    for (const [id, words, screen] of cases) {
      assert.match(els[id].innerHTML, words, `${id} does not say why it is empty`);
      assert.match(els[id].innerHTML,
        new RegExp('href="' + screen.replace(".", "\\.") + "\\?client_id=" + CID + '"'),
        `${id} does not link to ${screen} carrying the client`);
    }
  });

  test("an empty area shows no figure at all — not a zero", async () => {
    const { els } = await runHub({ routes: EMPTY });
    for (const id of ["fosBodyPlan", "fosBodyCards", "fosBodyBank", "fosBodyBills", "fosBodyAlerts"]) {
      assert.ok(!/fh-num/.test(els[id].innerHTML),
        `${id} drew a number for an area that has no data in it`);
    }
  });

  test("no alerts is not reported as 'nothing is wrong'", async () => {
    // The rules only run when somebody runs them, so silence is not a clean bill
    // of health and must not read as one.
    const { els } = await runHub({ routes: EMPTY });
    assert.match(els.fosBodyAlerts.innerHTML, /only\s+run when somebody runs them/);
  });
});

/* ── failure ──────────────────────────────────────────────────────────────── */

describe("finance-os.html — one area failing does not take the page with it", () => {

  test("a failed area says so, shows no number, and the rest still paint", async () => {
    const { els, banner } = await runHub({
      routes: { "/api/finance/liabilities": fail(500, { ok: false, error: "internal_error" }) }
    });
    assert.match(els.fosBodyCards.innerHTML, /could not be read/);
    assert.ok(!/fh-num/.test(els.fosBodyCards.innerHTML),
      "a card that could not be read still drew a figure");
    assert.ok(els.fosCardCards.classList.contains("is-bad"),
      "a card that failed looks the same as a card with no data in it");
    // The banner carries data.js's wording for the failure, and it is explicit
    // that the DATABASE did not report a problem (audit m17).
    assert.match(banner, /something went wrong on our side/);
    // ...and the other areas are untouched.
    assert.match(els.fosBodyPlan.innerHTML, /149\.00/);
    assert.match(els.fosBodyBills.innerHTML, /412/);
  });

  test("a 403 is a ROLE answer and never claims the reader is signed out", async () => {
    /* Three of the six areas are owner-and-admin only (shell.js
       OWNER_ADMIN_ONLY mirrors the gates in api/finance/*), and the hub fires
       all six reads before it can know the role — the session resolves in
       shell.js, not here. So a closer opening this page collects three 403s.
       Reporting those through explain() would print "not signed in for real
       data" three times at somebody who is signed in perfectly well, and send
       them off to reset a password that is not the problem. */
    const { els, banner } = await runHub({
      routes: { "/api/finance/subscriptions": fail(403, { ok: false, error: "forbidden" }) }
    });
    assert.match(els.fosBodyPlan.innerHTML, /not open to your role/);
    assert.ok(!/not signed in/.test(banner),
      "a role gate was reported to the reader as a broken session");
    // ...and the reads that DID work are unaffected.
    assert.match(els.fosBodyCards.innerHTML, /4,400\.00/);
  });

  test("an area whose handler is not finished says 'not built yet', not 'broken'", async () => {
    const { banner } = await runHub({
      routes: { "/api/finance/bills": fail(501, { ok: false, error: "not_implemented" }) }
    });
    assert.match(banner, /not built yet/);
  });
});

/* ── no client ────────────────────────────────────────────────────────────── */

describe("finance-os.html — with nobody open", () => {

  test("nothing is fetched about a client, and no figure is drawn", async () => {
    const { els, asked } = await runHub({ search: "" });
    assert.ok(!asked.some((u) => u.indexOf("/api/finance/") === 0),
      "the hub asked the finance endpoints about a client it does not have");
    assert.ok(!asked.some((u) => u.indexOf("/api/read/finance-os") === 0));
    for (const id of ["fosBodyPlan", "fosBodyCards", "fosBodyBank", "fosBodyBills", "fosBodyAlerts"]) {
      assert.match(els[id].innerHTML, /Pick a client/);
    }
  });

  test("the picker is still loaded, because it is the way out of this state", async () => {
    const { els, asked } = await runHub({ search: "" });
    assert.ok(asked.some((u) => u.indexOf("/api/dashboard/clients") === 0));
    assert.match(els.fosClient.innerHTML, /Dana Okoro/);
  });

  test("a junk client_id is named as junk, not reported as an outage", async () => {
    const { banner } = await runHub({ search: "?client_id=not-a-uuid" });
    assert.match(banner, /not a valid id/);
    assert.ok(!/database/.test(banner), "a typo in the address bar blamed the database");
  });
});

/* ── the seven rows, still ────────────────────────────────────────────────── */

describe("finance-os.html — the credit grid survived the rebuild", () => {

  test("the seven rows paint from the server's own numbers", async () => {
    const { els } = await runHub();
    const rows = els.fosGrid.innerHTML.match(/class="fos-row/g) || [];
    assert.equal(rows.length, 7);
    assert.match(els.fosGrid.innerHTML, /10,000\.00/);
    assert.equal(els.fosSource.textContent, "tradelines");
  });

  test("a client with no tradelines gets seven em dashes, not seven zeroes", async () => {
    const { els } = await runHub({
      routes: { "/api/read/finance-os": { ok: true, ...financeOsGrid([]) } }
    });
    assert.match(els.fosGrid.innerHTML, /no tradelines on file/);
    assert.ok(!/>\s*[\d,]+\.\d\d\s*</.test(els.fosGrid.innerHTML),
      "a client nobody has pulled was shown a money figure");
  });

  test("a lender name is escaped — it is record data, never markup", async () => {
    const { els } = await runHub({
      routes: {
        "/api/read/finance-os": {
          ok: true,
          ...financeOsGrid([tradeline({ lender: '<img src=x onerror=alert(1)>' })])
        }
      }
    });
    assert.ok(!/<img/.test(els.fosGrid.innerHTML), "a lender name reached the page as markup");
    assert.match(els.fosGrid.innerHTML, /&lt;img/);
  });

  test("a grid read that comes back with no rows at all says so in words", async () => {
    const { els } = await runHub({
      routes: { "/api/read/finance-os": { ok: true, rows: [], lines: 0, source: "tradelines" } }
    });
    assert.match(els.fosGrid.innerHTML, /nothing to show/);
    assert.ok(!/fos-row/.test(els.fosGrid.innerHTML));
  });
});
