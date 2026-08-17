/* Tests for the inline wiring script in public/app/subscriptions.html.
 *
 * WHY A SCREEN TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing has LOOKED at this page. What can still be proved
 * without a browser is what the page decides to put on screen, and that is where
 * the expensive mistakes live — so the real wiring script is lifted out of the
 * .html file and run against a stub DOM, exactly the way
 * src/http/banking-surface-screen.test.mjs does it. If the script drifts, this
 * goes red rather than the screen going quietly wrong. It proves nothing about
 * layout, colour or whether anything is legible; a human still has to open it.
 *
 * THE THREE RULES UNDER TEST, ALL OF WHICH HAVE ALREADY COST SOMEBODY SOMETHING:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Audit M8: banking-surface.html left
 *      two invented dollar figures on screen under a real client's name when the
 *      read came back empty. This screen ships no sample figures at all, and
 *      every way the read can end — rows, no rows, no answer — is asserted to
 *      leave no money on the page that the response did not contain.
 *
 *   2. AN UNKNOWN PRICE IS AN EM DASH, NEVER 0.00. "Nobody recorded what this
 *      tier costs" and "this tier is free" are different facts about somebody's
 *      money and only one of them is a claim.
 *
 *   3. EVERYTHING IS ESCAPED. A tier name and a subscription note are typed by a
 *      person and stored as text. There are 252 innerHTML sites across
 *      public/app; a screen that interpolates a record without esc() turns a
 *      note into markup.
 *
 * And one more, specific to this screen: THE PROCESSOR TOKEN MUST NOT REACH THE
 * PAGE. The endpoint strips it, so the test feeds a card row that still carries
 * one and asserts the rendered HTML does not contain it — belt and braces, since
 * the two halves are edited by different people at different times.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/subscriptions.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "subscriptions.html no longer has an inline wiring script");
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
    querySelectorAll() { return []; }
  };
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path)` answers each GET the screen issues. Elements are created on
 * demand, so the forms the script binds to after a render exist without this
 * file having to know their ids — what is asserted is the HTML the script
 * produced, not the wiring of a fake DOM.
 */
async function runScreen({ search = `?client_id=${CID}`, respond } = {}) {
  const els = { subsMount: makeEl("subsMount"), subsMountSource: makeEl("subsMountSource") };
  const calls = [];

  const sandbox = {
    console,
    document: {
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl(""),
      querySelectorAll: () => [],
      documentElement: { style: { setProperty() {} } },
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
    html: () => els.subsMount.innerHTML,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : "")
  };
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const SUB = (over = {}) => ({
  id: "sub-1", tier: "gold", status: "active",
  price_cents: "4900", price_display: "49.00", currency: "USD",
  card_id: "card-1", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null,
  cancelled_at: null, notes: null, ...over
});

const CARD = (over = {}) => ({
  id: "card-1", provider: "commas", token_present: true,
  brand: "Visa", last4: "4242", exp_month: 11, exp_year: 2029,
  removed_at: null, ...over
});

/* respondWith — one place that knows which of the three GETs is which.
   Payment links defaults to an empty list: the panel is a later addition
   (src/payment-links/index.mjs) and most of the tests below are about the
   plan/cards panel above it, not this one. */
function respondWith({ sub = {}, cards = {}, links = {}, clients = {}, subStatus = 200, cardStatus = 200, linksStatus = 200 } = {}) {
  return (p) => {
    if (p.indexOf("/api/dashboard/clients") === 0) {
      return { status: 200, body: { ok: true, clients: [], ...clients } };
    }
    if (p.indexOf("/api/finance/subscriptions") === 0) {
      return { status: subStatus, body: subStatus === 200
        ? { ok: true, client_id: CID, current: null, history: [], ...sub }
        : sub };
    }
    if (p.indexOf("/api/finance/cards") === 0) {
      return { status: cardStatus, body: cardStatus === 200
        ? { ok: true, client_id: CID, include_removed: true, cards: [], ...cards }
        : cards };
    }
    if (p.indexOf("/api/payment-links") === 0) {
      return { status: linksStatus, body: linksStatus === 200
        ? { ok: true, items: [], ...links }
        : links };
    }
    throw new Error("the screen called an endpoint nobody expected: " + p);
  };
}

/* Any run of digits with a decimal point — the shape of money on this page.
   Used to prove that a screen with no data shows no money, without having to
   list every figure that could have been invented, and without having to know
   what a future version of the screen might invent.

   THIS CAUGHT SOMETHING ON ITS FIRST RUN, which is why it is a shape test and
   not a list. The price box carried placeholder="49.00" — a format hint, and
   greyed out, and still a money-shaped number sitting on screen under a named
   client's name with nothing on the page to say it is not theirs. The
   placeholders are words now. The one number still allowed in a placeholder is
   the change form's, which is the client's OWN current price sent by the
   server. */
const MONEY_SHAPED = /\b\d[\d,]*\.\d{2}\b/;

/* ── what the screen asks for ─────────────────────────────────────────────── */

describe("subscriptions.html — the reads it issues", () => {

  test("with no client in the URL it asks for nothing about a plan and invents nothing", async () => {
    const s = await runScreen({
      search: "",
      respond: (p) => {
        if (p.indexOf("/api/dashboard/clients") === 0) {
          return { status: 200, body: { ok: true, clients: [] } };
        }
        throw new Error("no read expected: " + p);
      }
    });
    assert.ok(s.calls.every((c) => c.indexOf("/api/dashboard/clients") === 0),
      "the screen read something besides the client picker with no client open:\n" + s.calls.join("\n"));
    assert.ok(/client_id/.test(s.html()), "the page does not say what is missing");
    assert.ok(!MONEY_SHAPED.test(s.html()),
      "money is on screen with no client named:\n" + s.html());
    assert.match(s.banner(), /no client named/);
  });

  test("with a client it reads the plan, the cards and the payment links, removed cards included", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.ok(s.calls.some((c) => c.indexOf("/api/dashboard/clients") === 0),
      "the client picker did not load");
    assert.ok(s.calls.some((c) => c.indexOf("/api/finance/subscriptions?client_id=" + CID) === 0));
    const cardCall = s.calls.find((c) => c.indexOf("/api/finance/cards") === 0);
    assert.match(cardCall, /include_removed=1/,
      "removed cards are not asked for, so a plan paid by a card that is now off file " +
      "would show as having no card at all");
    assert.ok(s.calls.some((c) => c.indexOf("/api/payment-links?client_id=" + CID) === 0),
      "the payment links panel did not read this client's links");
  });
});

/* ── rule 1: no number the server did not send ────────────────────────────── */

describe("subscriptions.html — a named client never sees invented money", () => {

  test("the client has no plan and no cards", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.ok(!MONEY_SHAPED.test(s.html()), "money appeared for a client with no plan:\n" + s.html());
    assert.match(s.html(), /No plan on file/);
    assert.match(s.html(), /No cards on file/);
  });

  test("the plan read fails outright", async () => {
    const s = await runScreen({
      respond: respondWith({ subStatus: 500, sub: { ok: false, error: "internal_error" } })
    });
    assert.ok(!MONEY_SHAPED.test(s.html()), "a failed read left money on screen:\n" + s.html());
    // And it must say something. A blank panel under a client's name is the M8 shape.
    assert.ok(s.html().length > 200, "the page went blank instead of saying what happened");
    assert.match(s.banner(), /something went wrong on our side/,
      "a crashed handler was reported as a database outage (audit m17)");
  });

  test("the endpoint is routed but not built — that is not an outage", async () => {
    const s = await runScreen({ respond: respondWith({ subStatus: 501, sub: { ok: false, error: "not_implemented" } }) });
    assert.match(s.banner(), /not built yet/);
    assert.ok(!/database/i.test(s.banner()), "'not built yet' was reported as a database problem");
  });

  test("the id in the URL is stale and the endpoint refuses it", async () => {
    const s = await runScreen({ respond: respondWith({ subStatus: 400, sub: { ok: false, error: "client_id must be a uuid" } }) });
    assert.ok(!MONEY_SHAPED.test(s.html()));
    assert.match(s.banner(), /rejected/);
  });
});

/* ── rule 2: unknown is an em dash ────────────────────────────────────────── */

describe("subscriptions.html — an unknown price", () => {

  test("renders as an em dash and NEVER as 0.00", async () => {
    const s = await runScreen({
      respond: respondWith({
        sub: { current: SUB({ price_display: null, price_cents: null }),
               history: [SUB({ price_display: null, price_cents: null })] }
      })
    });
    assert.ok(s.html().includes("—"), "an unrecorded price did not render as an em dash");
    assert.ok(!s.html().includes("0.00"),
      "an unrecorded price rendered as 0.00, which tells the owner the plan is free:\n" + s.html());
    assert.match(s.html(), /is-unknown/,
      "the em dash is not carrying the .is-unknown class, so it reads at full weight like a figure");
  });

  test("a known price is shown exactly as the server formatted it", async () => {
    const s = await runScreen({ respond: respondWith({ sub: { current: SUB(), history: [SUB()] } }) });
    assert.ok(s.html().includes("49.00"), "the price the server sent is not on screen");
  });

  test("a four-figure price keeps its thousands separator and its cents", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: SUB({ price_display: "1250.00" }), history: [] } })
    });
    assert.ok(s.html().includes("1,250.00"), "the price was not grouped:\n" + s.html());
  });

  test("a missing start date is an em dash, not a blank cell", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: SUB({ effective_from: null }), history: [] } })
    });
    assert.match(s.html(), /is-unknown/);
  });
});

/* ── rule 3: everything is escaped ────────────────────────────────────────── */

describe("subscriptions.html — record data is never markup", () => {

  const NASTY = '<img src=x onerror="alert(1)">';

  test("a tier name carrying markup is escaped in the plan panel", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: SUB({ tier: NASTY }), history: [] } })
    });
    assert.ok(!s.html().includes("<img"), "a tier name reached the page as markup:\n" + s.html());
    assert.ok(s.html().includes("&lt;img"), "the tier name was dropped rather than escaped");
  });

  test("a subscription note carrying markup is escaped in the history table", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: null, history: [SUB({ notes: NASTY })] } })
    });
    assert.ok(!s.html().includes("<img"), "a note reached the page as markup:\n" + s.html());
  });

  test("a card brand carrying markup is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({ cards: { cards: [CARD({ brand: NASTY })] } })
    });
    assert.ok(!s.html().includes("<img"), "a card brand reached the page as markup");
  });

  test("a quote in a tier name cannot break out of the change form's placeholder", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: SUB({ tier: 'gold" autofocus onfocus="x' }), history: [] } })
    });
    assert.ok(!/placeholder="gold" autofocus/.test(s.html()),
      "a tier name closed the placeholder attribute and added its own:\n" + s.html());
  });
});

/* ── the token ────────────────────────────────────────────────────────────── */

describe("subscriptions.html — the processor token", () => {

  test("never reaches the page, even if the response carries one", async () => {
    const s = await runScreen({
      respond: respondWith({ cards: { cards: [CARD({ provider_token: "tok_live_leak" })] } })
    });
    assert.ok(!s.html().includes("tok_live_leak"),
      "the page rendered a live processor token — that string is a chargeable credential");
    assert.ok(s.html().includes("token on file"),
      "the page has to be able to say a token exists without showing it");
  });

  test("there is no card-number box and no security-code box on the add form", () => {
    // Read from the file, not from a render: this is about what the form asks
    // for at all, and it must stay true whatever the data does.
    assert.ok(!/name="(pan|card_number|number|cvv|cvc|security_code)"/i.test(HTML),
      "the add form has grown a field for card data that must never be stored");
    assert.ok(/name="provider_token"/.test(HTML), "the add form no longer collects a token");
    assert.match(HTML, /reference to a card held by a/i,
      "the page no longer tells the reader that a card here is a reference, not the card");
  });
});

/* ── what the screen actually shows ───────────────────────────────────────── */

describe("subscriptions.html — real rows render", () => {

  test("the live plan, its price, its dates and the card that pays for it", async () => {
    const s = await runScreen({
      respond: respondWith({
        sub: { current: SUB(), history: [SUB()] },
        cards: { cards: [CARD()] }
      })
    });
    const h = s.html();
    assert.ok(h.includes("gold"), "the tier is not on screen");
    assert.ok(h.includes("49.00"), "the price is not on screen");
    assert.ok(h.includes("2026-01-01"), "the start date is not on screen");
    assert.ok(h.includes("Visa ····4242"), "the card that pays for the plan is not named");
    assert.ok(h.includes("pays for the plan"), "the attached card is not marked as attached");
    assert.match(s.banner(), /live plan/);
  });

  test("the version chain is shown newest first with the live one marked", async () => {
    const s = await runScreen({
      respond: respondWith({
        sub: {
          current: SUB({ id: "sub-2", tier: "platinum", price_display: "99.00" }),
          history: [
            SUB({ id: "sub-2", tier: "platinum", price_display: "99.00" }),
            SUB({ id: "sub-1", tier: "gold", effective_to: "2026-06-01T00:00:00.000Z" })
          ]
        }
      })
    });
    const h = s.html();
    assert.ok(h.indexOf("platinum") < h.indexOf("gold"),
      "the history is not newest first, so the current price is not the first thing read");
    assert.ok(h.includes("99.00") && h.includes("49.00"),
      "a price change is not explainable — both versions must show their own price");
    assert.ok(h.includes("2026-06-01"), "the closed version does not show when it stopped");
  });

  test("a plan whose card is off file says so rather than showing nothing", async () => {
    const s = await runScreen({
      respond: respondWith({
        sub: { current: SUB(), history: [] },
        cards: { cards: [CARD({ removed_at: "2026-05-05T00:00:00.000Z" })] }
      })
    });
    assert.match(s.html(), /off file 2026-05-05/,
      "a plan pointing at a removed card read as if it had a working card on file");
  });

  test("a plan naming a card the read did not return says that too", async () => {
    const s = await runScreen({
      respond: respondWith({ sub: { current: SUB({ card_id: "card-missing" }), history: [] }, cards: { cards: [] } })
    });
    assert.match(s.html(), /a card this read did not return/,
      "an unresolvable card id rendered as nothing, which reads as 'no card on file'");
  });

  test("with no plan the screen offers START and does not offer CHANGE or CANCEL", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /id="startForm"/);
    assert.ok(!/id="changeForm"/.test(s.html()),
      "the screen offers a plan change for a client with no plan — the refusal is unactionable");
    assert.ok(!/id="cancelForm"/.test(s.html()));
  });

  test("with a plan the screen offers CHANGE and CANCEL and does not offer START", async () => {
    const s = await runScreen({ respond: respondWith({ sub: { current: SUB(), history: [SUB()] } }) });
    assert.match(s.html(), /id="changeForm"/);
    assert.match(s.html(), /id="cancelForm"/);
    assert.ok(!/id="startForm"/.test(s.html()),
      "the screen offers to start a plan for a client who already has one");
  });

  test("a card on file can be attached and taken off; a removed one can be neither", async () => {
    const s = await runScreen({
      respond: respondWith({
        sub: { current: SUB({ card_id: null }), history: [] },
        cards: { cards: [CARD({ id: "card-1" }), CARD({ id: "card-2", removed_at: "2026-05-05T00:00:00.000Z" })] }
      })
    });
    const h = s.html();
    assert.ok(h.includes('data-act="attach" data-card="card-1"'), "a usable card has no attach control");
    assert.ok(h.includes('data-act="remove" data-card="card-1"'), "a usable card has no remove control");
    assert.ok(!h.includes('data-card="card-2"'),
      "a card that is already off file is offered for attaching or removing again");
  });

  test("the way out of the screen is a real link, not history.back()", () => {
    assert.match(HTML, /href="command-center\.html"/,
      "the back link is not a real href — back() does nothing when the page was opened from a pasted URL");
    // The wiring script, not the whole file: the comment above the link says the
    // words "history.back()" to explain why it is not used, and a test that
    // cannot tell an explanation from a call is a test that punishes the comment.
    assert.ok(!/history\.back\(\)/.test(inlineScript()),
      "the script navigates with history.back(), which does nothing from a pasted URL");
  });

  test("the scaffold placeholder is gone", () => {
    assert.ok(!/subsMountPlaceholder/.test(HTML),
      "the 'this screen is being built' note is still on a screen that is built");
  });

  test("the page states, in words, that nothing here charges anybody", () => {
    assert.match(HTML, /charges anybody/i,
      "a button labelled 'Record this plan' implies money moved unless the page says it did not");
  });
});
