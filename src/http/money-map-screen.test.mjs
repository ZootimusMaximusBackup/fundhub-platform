/* Tests for the render half of public/app/money-map.html.
 *
 * WHY THIS EXISTS. There is no Playwright in this repository and no browser in
 * CI, so the only alternative to this file is "somebody clicked it once". The
 * two rules this screen was built around are exactly the ones a click test
 * would be worst at proving:
 *
 *   1. NO SAMPLE MARKUP. Every other wired screen keeps built-in sample rows
 *      when a read fails — that is FHData.wire()'s contract. This one must draw
 *      NOTHING and say what is missing instead. A screen showing plausible
 *      numbers nobody can trace has shipped here once already.
 *   2. EVERYTHING INTERPOLATED IS ESCAPED. Lender names and merchant strings
 *      come off bureau files and bank feeds, and they land inside innerHTML.
 *
 * The screen's inline <script> is a plain IIFE, so it runs here in a vm sandbox
 * against a stubbed DOM, the same way src/http/data-js.test.mjs runs data.js.
 * Tested from src/ because package.json's test glob only walks src/ and
 * scripts/.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { moneyMap } from "../finance/money-map.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/money-map.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

/* The render block is the LAST inline <script> in the file — after shell.js,
   after the chrome behaviour block, after data.js. Located rather than
   hard-coded by index so re-ordering the head does not silently test the wrong
   block. */
function renderScript() {
  const blocks = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, "money-map.html no longer has the inline render block");
  return blocks[blocks.length - 1];
}

/* A DOM stub with exactly the surface this screen touches, and nothing else —
   a fuller fake would let the screen use something a browser does not give it. */
function element(id) {
  return {
    id,
    _html: "",
    _text: "",
    value: "",
    _attrs: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    querySelectorAll() { return []; }
  };
}

/* run — load the render block with a stubbed FHData and let the read settle.
   `read` is the { ok, source, data, error } object FHData.read() resolves to. */
async function run({ clientId = "c-1", read, params = {} } = {}) {
  const els = {};
  for (const id of ["mmBody", "mmTitle", "mmSource", "mmSub", "mmDays", "mmAmount", "mmControls", "mmWays"]) {
    els[id] = element(id);
  }
  const banners = [];
  const explained = [];
  const asked = [];

  const win = {};
  const sandbox = {
    window: win,
    document: { getElementById: (id) => els[id] ?? null },
    location: { search: "" },
    FHData: {
      param: (n) => (n === "client_id" ? clientId : (params[n] ?? null)),
      read: (resource, p) => { asked.push({ resource, p }); return Promise.resolve(read); },
      banner: (tone, textStr, key) => { banners.push({ tone, text: textStr, key }); },
      explain: (res, what) => { explained.push({ res, what }); }
    }
  };
  sandbox.window.FHData = sandbox.FHData;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(renderScript(), sandbox, { filename: SCREEN });

  // Let the promise chain inside the IIFE settle.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  return { els, banners, explained, asked, body: els.mmBody.innerHTML };
}

const AS_OF = "2026-07-31";
const payload = (o = {}) => moneyMap({ asOf: AS_OF, horizonDays: 30, ...o });
const okRead = (data) => ({ ok: true, source: "api", data, error: null });
const failRead = (source, error) => ({ ok: false, source, data: null, error });

/* Row builders, matching the pg string shapes the endpoint actually returns. */
const tradeline = (o = {}) => ({
  id: "t1", lender: "Amex", kind: "revolving",
  credit_limit_cents: "750000", balance_cents: "150000", apr: "0.1899",
  account_ref: "4444555566667777", closed_at: null, ...o
});
const liability = (o = {}) => ({
  id: "l1", tradeline_id: "t1", as_of: "2026-07-20",
  payment_due_date: "2026-08-12", minimum_payment_cents: "3500",
  statement_balance_cents: "150000", past_due_cents: "0",
  statement_date: "2026-07-15", payment_status: "current", source: "crs", ...o
});
const account = (o = {}) => ({
  id: "b1", name: "Everyday Checking", account_type: "depository",
  current_balance_cents: "240000", available_balance_cents: "240000",
  entity_kind: "personal", mask: "1234", closed_at: null, ...o
});

/* The numbers that appear in this screen's sample markup in every OTHER screen
   in this app. If any of them show up here, sample markup came back. */
const SAMPLE_FINGERPRINTS = ["15,000.00", "11,500.00", "23.3%", "19.74%", "2,400.00 ", ">sample<"];

function assertNoSampleMarkup(html) {
  for (const s of SAMPLE_FINGERPRINTS) {
    assert.ok(!html.includes(s), `sample markup leaked onto the screen: ${s}`);
  }
}

describe("money-map.html — the screen never shows a number the server did not send", () => {

  test("the static file itself contains no sample figures", () => {
    /* The other screens in this app ship sample rows in the HTML and keep them
       when a read fails. This one must have none to keep. */
    const bodyHtml = HTML.split("<script")[0];
    assert.ok(!/\$?\d{1,3},\d{3}\.\d{2}/.test(bodyHtml), "the static markup contains a money figure");
    assert.ok(!/class="[^"]*sample/.test(HTML), "the static markup has a sample class");
  });

  test("no client in the URL: it asks for one and draws nothing", async () => {
    const { body, els } = await run({ clientId: null, read: okRead(payload()) });
    assert.match(body, /Open this with a client/);
    assert.equal(els.mmSource.textContent, "no client named");
    assert.match(body, /There is no sample data on this screen/);
    assertNoSampleMarkup(body);
  });

  test("no client in the URL: the endpoint is never called", async () => {
    const { asked } = await run({ clientId: null, read: okRead(payload()) });
    assert.deepEqual(asked, []);
  });

  /* THE KNOWN DEFECT. public/fh.js writes fh_demo="1" at demo sign-in and it
     survives every later load, routing calls to a client-side mock that also
     swallows real 403s. data.js reports source:"demo"; this screen must name it
     and give the fix, not quietly render an empty page. */
  test("demo mode: it names the sticky flag and gives the exact command", async () => {
    const { body, explained } = await run({ read: failRead("demo", "demo session") });
    assert.match(body, /demo mode/i);
    assert.match(body, /fh_demo/);
    assert.match(body, /localStorage\.removeItem/);
    assert.match(body, /never falls back to sample numbers/);
    assert.equal(explained.length, 1);
    assertNoSampleMarkup(body);
  });

  test("each failure source gets its own plain-English sentence, and no figures", async () => {
    const cases = [
      ["unauthorized", /not signed in/i],
      ["notfound", /no such client/i],
      ["badrequest", /rejected/i],
      ["nodb", /database did not answer/i],
      ["offline", /could not be reached/i]
    ];
    for (const [source, re] of cases) {
      const { body } = await run({ read: failRead(source, "detail") });
      assert.match(body, re, `source=${source} produced the wrong message`);
      assert.match(body, /No figures are shown below/);
      assertNoSampleMarkup(body);
    }
  });

  test("a completely empty database says so, in words", async () => {
    const { body } = await run({ read: okRead(payload()) });
    assert.match(body, /There is no money data on file for this client/);
    assert.match(body, /Nothing is being made up to fill the page/);
    assertNoSampleMarkup(body);
  });

  test("an empty section says which read came back with nothing", async () => {
    const { body } = await run({ read: okRead(payload({ bankAccounts: [account()] })) });
    assert.match(body, /No credit cards are on file/);
    assert.match(body, /No repeating bills have been detected/);
  });
});

describe("money-map.html — unknown, floors, and attribution", () => {

  /* A reported 0 and an unreported figure are DIFFERENT FACTS and must not
     share a rendering. past_due_cents = "0" is the bureau affirming the account
     is current and correctly prints 0.00; minimum_payment_cents = null is "the
     file did not say" and must print an em dash. Both are asserted here,
     together, because the bug is only visible when they are side by side. */
  test("an unreported minimum is an em dash; a reported zero is still 0.00", async () => {
    const { body } = await run({
      read: okRead(payload({
        tradelines: [tradeline()],
        liabilities: [liability({ minimum_payment_cents: null, past_due_cents: "0" })]
      }))
    });
    assert.ok(body.includes("—"), "no em dash was rendered for the unknown minimum");
    assert.ok(body.includes(">0.00<"), "a reported zero past-due did not render as 0.00");

    const allNull = await run({
      read: okRead(payload({
        tradelines: [tradeline()],
        liabilities: [liability({
          minimum_payment_cents: null, past_due_cents: null,
          statement_balance_cents: null, current_balance_cents: null
        })]
      }))
    });
    assert.ok(!allNull.body.includes(">0.00<"), "an unknown rendered as 0.00");
  });

  test("a partial total carries the floor marker", async () => {
    const { body } = await run({
      read: okRead(payload({
        tradelines: [tradeline(), tradeline({ id: "t2", lender: "Chase" })],
        liabilities: [liability(), liability({ id: "l2", tradeline_id: "t2", minimum_payment_cents: null })]
      }))
    });
    assert.match(body, /is-partial/, "the floor marker class is missing from a partial total");
    assert.match(body, /this is a floor, the real total is higher/);
  });

  test("every utilization line prints the engine that produced it", async () => {
    const { body } = await run({
      read: okRead(payload({ tradelines: [tradeline()], requestedAmount: 3000 }))
    });
    assert.match(body, /src\/alerts\/evaluate\.mjs/);
    assert.match(body, /src\/finance\/os-grid\.mjs/);
    assert.match(body, /src\/calculators\/deal-funding\.mjs/);
  });

  test("the alerts list names the engine behind each row", async () => {
    const { body } = await run({
      read: okRead(payload({
        bankAccounts: [account()],
        tradelines: [tradeline()],
        liabilities: [liability({ payment_due_date: "2026-07-01" })]
      }))
    });
    assert.match(body, /which engine said so/);
    assert.match(body, /card_liabilities table/);
  });

  test("a refused cash-flow projection is explained, not left blank", async () => {
    const { body } = await run({
      read: okRead(payload({ bankAccounts: [account({ account_type: "credit" })] }))
    });
    assert.match(body, /No cash-flow figures can be produced/);
    assert.match(body, /headroom, not cash/);
  });

  test("a pooled projection warns that it is not the client's personal cash", async () => {
    const { body } = await run({
      read: okRead(payload({
        bankAccounts: [
          account(),
          account({ id: "b2", name: "Unplaced", entity_kind: "unknown", current_balance_cents: "900000" })
        ]
      }))
    });
    assert.match(body, /not<\/strong> the client's personal cash/);
  });

  test("the balances block states there is no combined total, on purpose", async () => {
    const { body } = await run({ read: okRead(payload({ bankAccounts: [account()] })) });
    assert.match(body, /no single total across these groups on purpose/);
  });

  test("the unknown-balance funding caveat reaches the page", async () => {
    const { body } = await run({
      read: okRead(payload({ tradelines: [tradeline({ balance_cents: null })] }))
    });
    assert.match(body, /reads an unknown balance as zero/);
  });

  test("no draw amount means the draw plan is absent and says why", async () => {
    const { body } = await run({ read: okRead(payload({ tradelines: [tradeline()] })) });
    assert.match(body, /No draw plan is shown because no amount was asked for/);
  });
});

describe("money-map.html — escaping and the way out", () => {

  /* Lender and merchant strings come off bureau files and bank feeds. None of
     it is ours and all of it lands inside innerHTML. */
  test("a hostile lender name is escaped, not executed", async () => {
    const nasty = '<img src=x onerror="alert(1)">';
    const { body } = await run({
      read: okRead(payload({ tradelines: [tradeline({ lender: nasty })] }))
    });
    assert.ok(!body.includes("<img src=x"), "a lender name reached the DOM unescaped");
    assert.match(body, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test("a hostile merchant name is escaped", async () => {
    const { body } = await run({
      read: okRead(payload({
        bankAccounts: [account()],
        recurringBills: [{
          id: "r1", bank_account_id: "b1", client_id: "c1",
          merchant_key: "x", merchant_display: "</td><script>bad()</script>",
          cadence: "monthly", typical_amount_cents: "-1599",
          next_expected_on: "2026-08-04", next_expected_unknown_reason: null,
          confidence_pct: 90, confidence_label: "high", is_business: null,
          occurrence_count: 6, first_seen_on: "2026-02-04", last_seen_on: "2026-07-04"
        }]
      }))
    });
    assert.ok(!body.includes("<script>bad()"), "a merchant name reached the DOM unescaped");
    assert.match(body, /&lt;\/td&gt;&lt;script&gt;/);
  });

  test("the screen defines its own esc() helper", () => {
    assert.match(renderScript(), /function esc\s*\(/);
  });

  /* history.back() does nothing on a pasted URL opened cold. Every way off this
     screen must be a real href. */
  test("the way out is a real href and never history.back()", () => {
    /* Comments are stripped first: the CSS block that explains WHY this screen
       does not use history.back() naturally contains the string, and a test
       that failed on its own rationale would be useless. */
    const code = HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/history\.back\s*\(/.test(code), "the screen calls history.back()");
    assert.match(HTML, /href="client-control-panel\.html"/);
    assert.match(HTML, /href="command-center\.html"/);
  });

  test("the way-out links carry the client through", async () => {
    const { els } = await run({ read: okRead(payload()) });
    // querySelectorAll is stubbed to [], so this asserts the code path exists
    // rather than the rewrite result; the rewrite itself is one line above it.
    assert.match(renderScript(), /client_id=" \+ encodeURIComponent\(clientId\)/);
    assert.ok(els.mmWays);
  });

  test("a render failure says so and shows nothing, rather than half a screen", async () => {
    // A payload missing the sections the renderer needs.
    const { body } = await run({ read: okRead({ source: "money-map", counts: {} }) });
    assert.match(body, /could not draw the answer/);
    assert.match(body, /a half-drawn money screen is worse than none/);
    assertNoSampleMarkup(body);
  });

  test("a successful read reports what it actually loaded", async () => {
    const { banners } = await run({
      read: okRead(payload({ tradelines: [tradeline()], bankAccounts: [account()] }))
    });
    const real = banners.find((b) => b.tone === "real");
    assert.ok(real, "a successful read did not report itself");
    assert.match(real.text, /live money map/);
    assert.match(real.text, /1 card\(s\)/);
  });
});
