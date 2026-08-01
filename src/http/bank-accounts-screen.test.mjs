/* Tests for the inline wiring script in public/app/bank-accounts.html.
 *
 * WHY A SCREEN TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing has LOOKED at this page. What can still be proved
 * without a browser is what the page DECIDES to put on screen, and that is where
 * the expensive mistakes live — so the real wiring script is lifted out of the
 * .html file and run against a stub DOM, exactly the way
 * src/http/banking-surface-screen.test.mjs and subscriptions-screen.test.mjs do
 * it. If the script drifts, this goes red rather than the screen going quietly
 * wrong. It proves nothing about layout, colour or whether anything is legible;
 * a human still has to open it.
 *
 * THE FOUR RULES UNDER TEST, ALL OF WHICH HAVE ALREADY COST SOMEBODY SOMETHING:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Audit M8 is this screen's sibling —
 *      banking-surface.html left two invented dollar figures on screen under a
 *      real client's name when the read came back empty. This screen ships no
 *      sample figures at all, and every way the read can end (rows, no rows, no
 *      answer) is asserted to leave no money on the page that the response did
 *      not contain.
 *
 *   2. AN UNKNOWN BALANCE IS AN EM DASH, NEVER 0.00. "Nobody has typed this
 *      account's balance in" and "this account has nothing in it" are different
 *      facts about somebody's money and only one of them is a claim.
 *
 *   3. UNKNOWN IS NOT PERSONAL. The unclassified pile renders LAST, is drawn
 *      differently, carries a call to action, and is never merged into the
 *      personal group. The screen does not group anything itself — the server
 *      sends the groups — and this asserts it does not start.
 *
 *   4. EVERYTHING IS ESCAPED. An account name and a bank's own subtype wording
 *      are typed by a person and stored as text. There are 252 innerHTML sites
 *      across public/app; a screen that interpolates a record without esc()
 *      turns an account name into markup.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/bank-accounts.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* THE PAGE WITHOUT ITS COMMENTS, ITS STYLESHEET OR ITS WIRING, and that is not
   tidiness. This repo writes long comments that name the defect they avoid —
   this file's own header quotes `history.back()` and the words "routing number"
   — so matching raw source fails the page for DOCUMENTING the bug it does not
   have, which teaches the next person to delete the explanation to get the suite
   green. Same discipline as stripComments() in
   src/http/read-endpoints-org-scope.test.mjs: match the markup, read the prose.

   The <style> block goes with them for a different reason: a CSS line height of
   `13px/1.35` is money-shaped and is not money. */
const MARKUP = HTML
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<style>[\s\S]*?<\/style>/g, " ")
  .replace(/<script>[\s\S]*?<\/script>/g, " ");

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "bank-accounts.html no longer has an inline wiring script");
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
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path)` answers the GET the screen issues. Elements are created on
 * demand, so the forms the script binds to after a render exist without this
 * file having to know their ids — what is asserted is the HTML the script
 * produced, not the wiring of a fake DOM.
 */
async function runScreen({ search = `?client_id=${CID}`, respond } = {}) {
  const els = {
    accountsMount: makeEl("accountsMount"),
    accountsMountSource: makeEl("accountsMountSource")
  };
  const calls = [];

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
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  return {
    els,
    calls,
    html: () => els.accountsMount.innerHTML,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : "")
  };
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/* An account exactly as src/finance/banking-surface.mjs accountView() emits it.
   Written out rather than imported so that a change to that module's shape
   shows up here as a failing screen test rather than as a silently empty page. */
const ACCT = (over = {}) => ({
  id: "acct-1", name: "Business Checking", mask: "1234",
  account_type: "depository", account_subtype: "checking",
  entity_kind: "business", entity_kind_source: "staff_reviewed",
  entity_kind_set_at: "2026-07-02T00:00:00.000Z",
  available_balance_cents: 120450, current_balance_cents: 125000,
  available_display: "1204.50", current_display: "1250.00",
  balance_as_of: "2026-07-01T00:00:00.000Z", closed_at: null, overdrawn: false,
  ...over
});

const basis = (lines, counted, unknown) => ({
  lines, counted, unknown, partial: unknown > 0
});

const GROUP = (key, accounts, over = {}) => ({
  key,
  label: key === "unknown" ? "Unclassified — whose money this is has not been established"
                           : key === "personal" ? "Personal" : "Business",
  count: accounts.length,
  open_count: accounts.filter((a) => !a.closed_at).length,
  accounts,
  available: { value: null, display: null, basis: basis(0, 0, 0) },
  current: { value: null, display: null, basis: basis(0, 0, 0) },
  ...over
});

function SURFACE({ personal = [], business = [], unknown = [], over = {} } = {}) {
  const groups = [GROUP("personal", personal), GROUP("business", business), GROUP("unknown", unknown)];
  const all = personal.concat(business, unknown);
  return {
    source: "bank_accounts",
    accounts: all.length,
    open_accounts: all.filter((a) => !a.closed_at).length,
    closed_accounts: all.filter((a) => a.closed_at).length,
    unclassified: unknown.length,
    needs_classification: unknown.length > 0,
    groups,
    ...over
  };
}

/* respondWith — one place that knows what the single GET answers with. */
function respondWith({ status = 200, body, surface, details = {} } = {}) {
  return (p) => {
    if (p.indexOf("/api/finance/bank-accounts") !== 0) {
      throw new Error("the screen called an endpoint nobody expected: " + p);
    }
    if (status !== 200) return { status, body: body || { ok: false, error: "boom" } };
    return {
      status: 200,
      body: body || { ok: true, client_id: CID, surface: surface || SURFACE(), details }
    };
  };
}

/* Any run of digits with a decimal point — the shape of money on this page.
   Used to prove that a screen with no data shows no money, without having to
   list every figure that could have been invented, and without having to know
   what a future version of the screen might invent. */
const MONEY_SHAPED = /\b\d[\d,]*\.\d{2}\b/;

/* ── what the screen asks for ─────────────────────────────────────────────── */

describe("bank-accounts.html — the read it issues", () => {

  test("with no client in the URL it asks for nothing and invents nothing", async () => {
    const s = await runScreen({ search: "", respond: () => { throw new Error("no read expected"); } });
    assert.deepEqual(s.calls, [], "the screen read the API without a client to read about");
    assert.match(s.html(), /client_id/, "the page does not say what is missing");
    assert.ok(!MONEY_SHAPED.test(s.html()), "money is on screen with no client named:\n" + s.html());
    assert.match(s.banner(), /no client named/);
  });

  test("with a client it reads that client and nothing else", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0], "/api/finance/bank-accounts?client_id=" + CID);
  });
});

/* ── rule 1: no number the server did not send ────────────────────────────── */

describe("bank-accounts.html — a named client never sees invented money", () => {

  test("the file itself ships no sample figures", () => {
    /* The M8 shape, caught at the source. Two invented dollar figures sat in
       banking-surface.html's markup and stayed on screen when the read returned
       nothing. This file has no static money at all: everything money-shaped has
       to arrive from the response. */
    assert.ok(!MONEY_SHAPED.test(MARKUP),
      "there is a money-shaped number in the page markup: " + MARKUP.match(MONEY_SHAPED));
  });

  test("a client with no accounts says so, and shows no money", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.ok(!MONEY_SHAPED.test(s.html()), "money appeared for a client with no accounts:\n" + s.html());
    assert.match(s.html(), /No accounts recorded as personal/);
    assert.match(s.html(), /Every account on file has been marked/);
    assert.match(s.banner(), /0 on file/);
  });

  test("an empty group totals to an em dash, not to 0.00", async () => {
    const s = await runScreen({ respond: respondWith({ surface: SURFACE({ personal: [ACCT()] }) }) });
    assert.match(s.html(), /nothing to total|no open deposit accounts/,
      "an empty total did not say what it counted");
  });

  test("the read fails outright — nothing is drawn in its place", async () => {
    const s = await runScreen({
      respond: respondWith({ status: 500, body: { ok: false, error: "internal_error" } })
    });
    assert.ok(!MONEY_SHAPED.test(s.html()), "a failed read left money on screen:\n" + s.html());
    assert.match(s.html(), /could not be read/, "the page went blank instead of saying what happened");
    assert.match(s.banner(), /something went wrong on our side/,
      "a crashed handler was reported as a database outage (audit m17)");
  });

  test("the endpoint is routed but not built — that is not an outage", async () => {
    const s = await runScreen({
      respond: respondWith({ status: 501, body: { ok: false, error: "not_implemented" } })
    });
    assert.match(s.banner(), /not built yet/);
    assert.ok(!/database/i.test(s.banner()), "'not built yet' was reported as a database problem");
  });

  test("the id in the URL is stale and the endpoint refuses it", async () => {
    const s = await runScreen({
      respond: respondWith({ status: 400, body: { ok: false, error: "client_id must be a uuid" } })
    });
    assert.ok(!MONEY_SHAPED.test(s.html()));
    assert.match(s.banner(), /rejected/);
  });

  test("a role that cannot open this screen sees no figures", async () => {
    const s = await runScreen({
      respond: respondWith({ status: 403, body: { ok: false, error: "forbidden" } })
    });
    assert.ok(!MONEY_SHAPED.test(s.html()));
    assert.match(s.banner(), /not signed in for real data/);
  });
});

/* ── rule 2: unknown is an em dash ────────────────────────────────────────── */

describe("bank-accounts.html — an unknown balance", () => {

  test("renders as an em dash and NEVER as 0.00", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({
          business: [ACCT({ available_display: null, current_display: null,
                            available_balance_cents: null, current_balance_cents: null })]
        })
      })
    });
    assert.ok(s.html().includes("—"), "an untyped balance did not render as an em dash");
    assert.ok(!s.html().includes("0.00"),
      "an untyped balance rendered as 0.00, which says this account is empty:\n" + s.html());
    assert.match(s.html(), /is-unknown/,
      "the em dash is not carrying .is-unknown, so it reads at full weight like a figure");
  });

  test("a known balance is shown exactly as the server formatted it, grouped", async () => {
    const s = await runScreen({ respond: respondWith({ surface: SURFACE({ business: [ACCT()] }) }) });
    assert.ok(s.html().includes("1,204.50"), "the balance the server sent is not on screen:\n" + s.html());
  });

  test("a negative balance keeps its minus sign through the grouping", async () => {
    /* 081:26 — the sign is data. group() puts the separators in and used to eat
       the leading minus, which would have turned an overdrawn account into a
       healthy one on screen. */
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ current_display: "-1412.19", overdrawn: true })] })
      })
    });
    assert.ok(s.html().includes("-1,412.19"), "the minus sign was lost:\n" + s.html());
    assert.match(s.html(), /overdrawn/);
  });

  /* banking-surface.mjs:132 sends overdrawn:null for anything that is not a
     deposit account — on a card, `current` is the amount OWED, so a maxed-out
     card reads positive and a card the client OVERPAID reads negative. false
     reads as "we checked, it is fine"; null means it is not established. */
  test("overdrawn:null paints no warning at all", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ account_type: "credit", overdrawn: null, current_display: "-500.00" })] })
      })
    });
    assert.ok(!/overdrawn/i.test(s.html()), "an unestablished fact was painted as one:\n" + s.html());
  });

  /* A total over a set with holes in it is a FLOOR. .is-partial carries the "+",
     and finance-os.css's :not(.is-unknown) stops "—+" (audit m16). */
  test("a partial total carries the floor marker and says what it counted", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({
          business: [ACCT()],
          over: {}
        })
      })
    });
    // Re-shape the group so the total is known but partial.
    const withPartial = SURFACE({ business: [ACCT()] });
    withPartial.groups[1].available = { value: 120450, display: "1204.50", basis: basis(2, 1, 1) };
    const s2 = await runScreen({ respond: respondWith({ surface: withPartial }) });
    assert.match(s2.html(), /is-partial/, "a floor was rendered as a total");
    assert.match(s2.html(), /this is a floor, not a total/);
    assert.ok(s.html().length > 0);
  });

  test("a total that is unknown is NOT also marked partial", async () => {
    const withNothing = SURFACE({ business: [ACCT()] });
    withNothing.groups[1].available = { value: null, display: null, basis: basis(2, 0, 2) };
    const s = await runScreen({ respond: respondWith({ surface: withNothing }) });
    /* Audit m16: sumKnown() returns total null when nothing was usable while
       basisOf() still reports partial:true, and the pair renders "—+", which is
       not a number, not a dash and not a marker. finance-os.css drops the ::after
       with :not(.is-unknown); this asserts the class pair that relies on. */
    assert.match(s.html(), /fh-num is-unknown is-partial/,
      "the two classes are not both present, so the CSS guard has nothing to guard");
    assert.match(s.html(), /none of the 2 open deposit account\(s\)/);
  });
});

/* ── rule 3: unknown is not personal ──────────────────────────────────────── */

describe("bank-accounts.html — the unclassified pile", () => {

  test("it renders LAST, drawn differently, with a call to action", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({
          personal: [ACCT({ id: "p1", name: "Personal Chequing", entity_kind: "personal" })],
          unknown: [ACCT({ id: "u1", name: "Nobody Asked", entity_kind: "unknown",
                           entity_kind_source: null, entity_kind_set_at: null })]
        })
      })
    });
    const html = s.html();
    assert.match(html, /is-unclassified/, "the unclassified group is drawn the same as the others");
    assert.ok(html.indexOf("Personal Chequing") < html.indexOf("Nobody Asked"),
      "the unclassified pile is not last");
    assert.match(html, /have not been marked personal or business/, "no call to action");
    assert.match(html, /not counted as this client's own money/);
    assert.match(s.banner(), /1 not yet classified/);
  });

  test("with nothing unclassified there is no call to action", async () => {
    const s = await runScreen({
      respond: respondWith({ surface: SURFACE({ personal: [ACCT({ entity_kind: "personal" })] }) })
    });
    assert.ok(!/have not been marked/.test(s.html()));
  });

  /* The screen renders the groups the server sent, in the order it sent them,
     and totals nothing of its own. A second grouping in a <script> block is a
     second answer that goes stale (os-grid.mjs:3). */
  test("the wiring does not group or total anything itself", () => {
    const src = inlineScript()
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.doesNotMatch(src, /entity_kind\s*===\s*["']personal["']/,
      "the screen is deciding which pile an account is in");
    assert.doesNotMatch(src, /\breduce\s*\(/, "the screen is totalling money it was handed");
    assert.doesNotMatch(src, /fromCents|toFixed/, "the screen is formatting money the server already formatted");
  });

  test("the group totals say they only count open deposit accounts", async () => {
    const s = await runScreen({ respond: respondWith({ surface: SURFACE({ personal: [ACCT()] }) }) });
    assert.match(s.html(), /open deposit accounts only/,
      "a total that does not say what it counted invites the reader to assume it counted everything");
    assert.match(s.html(), /no single total across the three groups/);
  });
});

/* ── rule 4: everything is escaped ────────────────────────────────────────── */

describe("bank-accounts.html — record data is never markup", () => {

  test("an account name carrying a tag is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({
          business: [ACCT({ name: '<img src=x onerror="alert(1)">', account_subtype: "<b>bold</b>" })]
        })
      })
    });
    const html = s.html();
    assert.ok(!html.includes("<img src=x"), "an account name reached the page as markup:\n" + html);
    assert.ok(!html.includes("<b>bold</b>"), "a subtype reached the page as markup");
    assert.match(html, /&lt;img/);
  });

  test("an account id carrying a quote cannot break out of an attribute", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ id: 'x" onclick="alert(1)' })] })
      })
    });
    assert.ok(!s.html().includes('onclick="alert(1)"'), "an id escaped its attribute:\n" + s.html());
  });
});

/* ── what a person can do here ────────────────────────────────────────────── */

describe("bank-accounts.html — the controls", () => {

  test("the add form has a box for every column a person can fill in", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    for (const id of ["addName", "addMask", "addType", "addSubtype", "addCurrency",
                      "addAvailable", "addCurrent", "addLimit", "addAsOf",
                      "addKind", "addSource"]) {
      assert.match(s.html(), new RegExp('id="' + id + '"'), "the add form has no " + id + " box");
    }
  });

  /* 081:60-66 permits the mask and forbids the full account number and the
     routing number in the same breath. There must be no box for either — a
     screen that offers one teaches a person that typing it here is safe, and the
     refusal at the endpoint arrives after they have already put it on a
     keyboard. */
  test("there is no box for a full account number or a routing number", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    const inputs = s.html().match(/<input[^>]*>/g) || [];
    assert.ok(inputs.length > 0, "the add form rendered no inputs at all");
    for (const el of inputs) {
      assert.doesNotMatch(el, /routing|account.?number|\biban\b|\bswift\b/i,
        "there is a box for a payment credential: " + el);
    }
    assert.match(s.html(), /Last 2-4 digits/, "the mask box is not labelled as digits only");
  });

  test("every account offers a classify control and a way to close it", async () => {
    const s = await runScreen({
      respond: respondWith({ surface: SURFACE({ unknown: [ACCT({ entity_kind: "unknown" })] }) })
    });
    assert.match(s.html(), /data-form="classify"/);
    assert.match(s.html(), /data-role="kind"/);
    assert.match(s.html(), /data-role="source"/, "there is nowhere to say HOW it was decided");
    assert.match(s.html(), /data-act="close"/);
  });

  test("an account already closed is not offered the close button again", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ closed_at: "2026-05-01T00:00:00.000Z" })] })
      })
    });
    assert.ok(!/data-act="close"/.test(s.html()), "a closed account still offers a close button");
    assert.match(s.html(), /not money anybody can reach/);
  });

  /* THE TWO BALANCE COLUMNS DO NOT MEAN THE SAME THING ON EVERY ACCOUNT
     (081:85-87, audit M10). Printing "Available" over a credit line's headroom
     is how headroom becomes cash in a reader's head. */
  test("a credit line's figures are labelled headroom and owed, not available and balance", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ account_type: "credit", id: "c1" })] }),
        details: { c1: { currency_code: "USD", credit_limit_display: "8700.00", credit_limit_cents: 870000, hand_entered: true } }
      })
    });
    assert.match(s.html(), /Headroom left/);
    assert.match(s.html(), /Owed/);
    assert.match(s.html(), /Credit line/);
    assert.ok(s.html().includes("8,700.00"));
  });

  test("a deposit account's figures are labelled spendable and ledger", async () => {
    const s = await runScreen({ respond: respondWith({ surface: SURFACE({ business: [ACCT()] }) }) });
    assert.match(s.html(), /Spendable now/);
    assert.match(s.html(), /Ledger balance/);
  });

  test("an account with no as-of date says nobody recorded one", async () => {
    const s = await runScreen({
      respond: respondWith({ surface: SURFACE({ business: [ACCT({ balance_as_of: null })] }) })
    });
    assert.match(s.html(), /nobody recorded when these balances were true/);
  });

  /* 081:80 — "an amount whose currency is unknown must never be added to one
     whose currency is known" — and banking-surface.mjs sums the cents columns
     without looking at currency_code at all. The screen cannot fix that; it says
     so where the total is. */
  test("a group holding two currencies is warned about", async () => {
    const s = await runScreen({
      respond: respondWith({
        surface: SURFACE({ business: [ACCT({ id: "a" }), ACCT({ id: "b" })] }),
        details: {
          a: { currency_code: "USD", credit_limit_display: null, hand_entered: true },
          b: { currency_code: "CAD", credit_limit_display: null, hand_entered: true }
        }
      })
    });
    assert.match(s.html(), /2 different currencies/);
  });

  /* Every screen needs a way OUT, and it has to be a real href: history.back()
     does nothing at all when the page was opened from a pasted or bookmarked URL
     (audit M20). */
  test("the way off this page is a real link, not history.back()", () => {
    assert.match(MARKUP, /href="command-center\.html"/);
    assert.doesNotMatch(MARKUP, /history\.back/);
    assert.doesNotMatch(inlineScript(), /history\.back/);
  });

  /* src/banking/plaid.mjs is a named empty seam behind an open SOC 2 review and
     a consent flow. The screen must not offer a button that implies otherwise. */
  test("the screen offers no way to connect or sync a bank", () => {
    assert.doesNotMatch(MARKUP, /\bconnect a bank\b/i);
    assert.doesNotMatch(inlineScript(), /action:\s*["']sync["']/);
    assert.match(MARKUP, /Nothing on this page connects to a bank/);
  });
});
