/* Tests for the "+" partial marker on public/app/finance-os.html and
 * public/app/banking-surface.html.
 *
 * THE DEFECT THIS FILE EXISTS FOR (audit m16). Two independent signals share a
 * number on both screens:
 *
 *   an em dash "—"  the value is UNKNOWN — nobody reported it
 *   a "+" suffix    the value is PARTIAL — it was totalled over a data set with
 *                   holes in it, so it is a floor and not a figure
 *
 * They are applied by separate classes (is-unknown, is-partial) set from
 * separate fields (display === null, basis.partial), and src/finance/os-grid.mjs
 * sets both at once whenever EVERY line had a hole: sumKnown() returns
 * total:null when nothing was usable (os-grid.mjs:79) while basisOf() still
 * reports partial:true because unknown > 0 (os-grid.mjs:86). The row then
 * rendered as the literal string "—+", which is not a number, not a dash and
 * not a marker. The plus means "there is more than this"; attached to "we have
 * no number" it says nothing at all, and to a reader it looks like the page is
 * broken.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS BUILT THE WAY IT IS.
 *
 * The "+" is a CSS ::after. It is not in the DOM text, so no string assertion on
 * the rendered HTML can see it, and asserting on the stylesheet text alone would
 * pin one particular spelling of the fix rather than the behaviour. So this file
 * does the real thing in miniature: it renders the page's own wiring against a
 * stub browser, parses the markup it produced into a tree, lifts the actual
 * marker rule out of the page's own <style> block, and evaluates that selector
 * against that tree.
 *
 * That makes it fix-agnostic. The marker can be suppressed in the CSS or by not
 * applying the class — either passes, and there is no third place the pair could
 * come back from.
 *
 * BOTH SIGNALS HAVE TO KEEP WORKING. Deleting the marker outright would pass a
 * test that only checked the bad pair, and would be a worse screen: a floor
 * silently presented as a total is the confident-wrongness this repo keeps
 * finding. So there is a matching positive test on each screen — a
 * known-but-partial total MUST still carry the plus.
 *
 * The fixtures are not hand-written response shapes. They are built by calling
 * the real src/finance modules the way the endpoints call them, so if those
 * modules stop producing the unknown-and-partial combination these go red
 * instead of passing vacuously.
 *
 * Tested from src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { financeOsGrid } from "../finance/os-grid.mjs";
import { bankingSurface } from "../finance/banking-surface.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const DATA_JS = path.join(APP, "data.js");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* ── lifting the page apart ───────────────────────────────────────────────── */

/** styleBlock — the page's own CSS, verbatim. */
function styleBlock(html, file) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, `${file} no longer has an inline <style> block`);
  return m[1];
}

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript(html, file) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, `${file} no longer has an inline wiring script`);
  return m[1];
}

/**
 * markerRule — the CSS rule that draws the "+", found by its declaration rather
 * than by its selector. Looking it up by selector would mean writing the answer
 * into the test.
 *
 * Returns the selector text, with the ::after pseudo-element stripped: whether
 * the marker is drawn as ::after or ::before is not what is under test.
 */
function markerRule(css, file) {
  // Comments first. Both of these files carry long explanatory comments
  // immediately above the rule — that is house style — and one of them quotes
  // `content:"+"` while naming the defect, so a rule scan over raw CSS finds
  // the prose instead of the rule.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const hit = rules.filter((r) => /content\s*:\s*["']\+["']/.test(r[2]));
  assert.equal(hit.length, 1,
    `${file}: expected exactly one rule drawing the "+" marker, found ${hit.length}`);
  return hit[0][1].trim().replace(/::?(after|before)\b/g, "").trim();
}

/* ── a selector matcher, narrow on purpose ────────────────────────────────────
   Only the grammar these two rules actually use: compound selectors of .class
   and :not(.class), joined by descendant combinators. Anything richer is a
   loud failure rather than a quiet wrong answer, because a matcher that
   silently mis-handles a selector it does not understand would report a screen
   as fixed when it is not. */

function parseCompound(text, selector) {
  const classes = [];
  const nots = [];
  let rest = text;
  let m;
  while ((m = rest.match(/^:not\(\.([A-Za-z0-9_-]+)\)/))) {
    nots.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  while ((m = rest.match(/^\.([A-Za-z0-9_-]+)/)) || (m = rest.match(/^:not\(\.([A-Za-z0-9_-]+)\)/))) {
    if (m[0][0] === ".") classes.push(m[1]); else nots.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  assert.equal(rest, "",
    `the marker selector "${selector}" uses syntax this test cannot evaluate ` +
    `(stuck at "${rest}"). Widen parseCompound rather than trusting a pass.`);
  assert.ok(classes.length, `the marker selector "${selector}" has a compound with no class`);
  return { classes, nots };
}

function parseSelector(selector) {
  assert.doesNotMatch(selector, /[>+~,]/,
    `the marker selector "${selector}" uses a combinator this test cannot evaluate`);
  return selector.split(/\s+/).filter(Boolean).map((c) => parseCompound(c, selector));
}

const compoundMatches = (c, el) =>
  c.classes.every((n) => el.classes.includes(n)) &&
  c.nots.every((n) => !el.classes.includes(n));

/**
 * selectorMatches — does `selector` match the element at the end of `chain`?
 * `chain` is that element's ancestors, outermost first, with the element last.
 */
function selectorMatches(selector, chain) {
  const parts = parseSelector(selector);
  const el = chain[chain.length - 1];
  if (!compoundMatches(parts[parts.length - 1], el)) return false;
  // Every remaining compound has to match some ancestor, in order.
  let i = chain.length - 2;
  for (let p = parts.length - 2; p >= 0; p--) {
    while (i >= 0 && !compoundMatches(parts[p], chain[i])) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

/* ── an HTML tree, only as much as these two screens emit ──────────────────── */

/**
 * elements — every element in `html`, each with its own class list, its
 * ancestors' class lists, and its text. Both screens emit nothing but <div> and
 * <span>, neither self-closing, so a depth counter is enough.
 */
function elements(html) {
  const out = [];
  const stack = [];
  const re = /<(\/?)(div|span)\b([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (stack.length) stack[stack.length - 1].text += m[4];
      continue;
    }
    if (m[1] === "/") {
      const done = stack.pop();
      assert.ok(done, `unbalanced markup near index ${m.index}`);
      continue;
    }
    const cls = (m[3].match(/class="([^"]*)"/) || [, ""])[1];
    const el = {
      classes: cls.split(/\s+/).filter(Boolean),
      chain: null,
      text: ""
    };
    el.chain = stack.map((s) => ({ classes: s.classes })).concat([{ classes: el.classes }]);
    stack.push(el);
    out.push(el);
  }
  assert.equal(stack.length, 0, "unbalanced markup — an element was never closed");
  return out;
}

/** marked — every element the "+" rule would actually draw a plus on. */
const marked = (html, selector) =>
  elements(html).filter((el) => selectorMatches(selector, el.chain));

/* ── the browser stub ─────────────────────────────────────────────────────── */

function makeEl(id, html = "") {
  return {
    id, innerHTML: html, className: "", textContent: "",
    style: { cssText: "" }, setAttribute() {}, appendChild() {}
  };
}

/**
 * runScreen — evaluate data.js and one page's wiring against a stub browser,
 * and hand back what it painted. Same shape as the harness in
 * src/http/banking-surface-screen.test.mjs, kept local because that file's
 * version is bound to the banking page's element ids.
 */
async function runScreen(file, ids, body) {
  const html = fs.readFileSync(path.join(APP, file), "utf8");
  const els = {};
  for (const id of ids) els[id] = makeEl(id);

  const sandbox = {
    console,
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
    location: { search: `?client_id=${CID}` },
    URLSearchParams,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, ...body }) })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  vm.runInContext(inlineScript(html, file), sandbox, { filename: file + "#wiring" });

  // The wiring does not hand back its promise, so drain the queue instead.
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  return { els, selector: markerRule(styleBlock(html, file), file) };
}

/* ── fixtures, built by the real modules ──────────────────────────────────── */

const tradeline = (over = {}) => ({
  id: "tl-1", kind: "revolving", closed_at: null, lender: "Amex",
  credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.1899", ...over
});

const account = (over = {}) => ({
  id: "acct-1", client_id: CID, name: "Everyday Checking", mask: "4321",
  account_type: "depository", account_subtype: "checking",
  available_balance_cents: "185000", current_balance_cents: "185000",
  entity_kind: "personal", entity_kind_source: "client_confirmed",
  closed_at: null, ...over
});

/* ── finance-os.html ──────────────────────────────────────────────────────── */

describe("finance-os.html — the partial marker", () => {

  test("the module really does produce a row that is unknown AND partial", () => {
    // If this ever stops being true the tests below would pass without testing
    // anything, so it is checked out loud.
    const grid = financeOsGrid([
      tradeline({ id: "a", credit_limit_cents: null, balance_cents: null, apr: null }),
      tradeline({ id: "b", lender: "Chase", credit_limit_cents: null, balance_cents: null, apr: null })
    ]);
    const row = grid.rows.find((r) => r.key === "credit_limit");
    assert.equal(row.display, null, "no line reported a limit, so the total is unknown");
    assert.equal(row.basis.partial, true, "unknown > 0, so basisOf still calls it partial");
  });

  test("an unknown value never gets the '+' — it would read as '—+'", async () => {
    const grid = financeOsGrid([
      tradeline({ id: "a", credit_limit_cents: null, balance_cents: null, apr: null }),
      tradeline({ id: "b", lender: "Chase", credit_limit_cents: null, balance_cents: null, apr: null })
    ]);
    const screen = await runScreen("finance-os.html", ["fosGrid", "fosSource"], grid);
    const html = screen.els.fosGrid.innerHTML;

    assert.match(html, /is-unknown/, "the fixture should have produced unknown rows");
    for (const el of marked(html, screen.selector)) {
      assert.ok(!el.classes.includes("is-unknown"),
        `a value with no number in it is being given the "+" floor marker. ` +
        `It renders as "${el.text}+", which reads as a rendering glitch. ` +
        `Rule: ${screen.selector}`);
      assert.notEqual(el.text.trim(), "—",
        `the em dash is being suffixed with "+". Rule: ${screen.selector}`);
    }
  });

  test("a KNOWN but partial total still gets the '+' — the signal must survive", async () => {
    // One line reports a limit, one does not: the total is a real number and it
    // is a floor. That is exactly what the marker is for.
    const grid = financeOsGrid([
      tradeline({ id: "a" }),
      tradeline({ id: "b", lender: "Chase", credit_limit_cents: null, balance_cents: null, apr: null })
    ]);
    const screen = await runScreen("finance-os.html", ["fosGrid", "fosSource"], grid);
    const hits = marked(screen.els.fosGrid.innerHTML, screen.selector);
    assert.ok(hits.length > 0,
      "no row is marked as a floor. Suppressing the marker everywhere is not the " +
      "fix — a partial sum shown as a total is worse than the glitch.");
    for (const el of hits) {
      assert.notEqual(el.text.trim(), "—", "a marked row still shows a dash");
    }
  });

  test("a complete grid gets no marker at all", async () => {
    const grid = financeOsGrid([tradeline({ id: "a" })]);
    const screen = await runScreen("finance-os.html", ["fosGrid", "fosSource"], grid);
    assert.equal(marked(screen.els.fosGrid.innerHTML, screen.selector).length, 0,
      "every line reported everything, so nothing on the screen is a floor");
  });
});

/* ── banking-surface.html ─────────────────────────────────────────────────── */

describe("banking-surface.html — the partial marker", () => {

  test("the module really does produce a group total that is unknown AND partial", () => {
    const surface = bankingSurface([
      account({ id: "a", current_balance_cents: null, available_balance_cents: null }),
      account({ id: "b", name: "Savings", current_balance_cents: null, available_balance_cents: null })
    ]);
    const personal = surface.groups.find((g) => g.key === "personal");
    assert.equal(personal.current.display, null);
    assert.equal(personal.current.basis.partial, true);
  });

  test("an unknown group total never gets the '+'", async () => {
    const surface = bankingSurface([
      account({ id: "a", current_balance_cents: null, available_balance_cents: null }),
      account({ id: "b", name: "Savings", current_balance_cents: null, available_balance_cents: null })
    ]);
    const screen = await runScreen("banking-surface.html",
      ["bsGroups", "bsTodo", "bsSource"], surface);
    const html = screen.els.bsGroups.innerHTML;

    assert.match(html, /is-unknown/, "the fixture should have produced an unknown total");
    for (const el of marked(html, screen.selector)) {
      assert.ok(!el.classes.includes("is-unknown"),
        `a group total with no number in it is being given the "+" floor marker. ` +
        `It renders as "${el.text}+". Rule: ${screen.selector}`);
      assert.notEqual(el.text.trim(), "—",
        `the em dash is being suffixed with "+". Rule: ${screen.selector}`);
    }
  });

  test("a KNOWN but partial group total still gets the '+'", async () => {
    const surface = bankingSurface([
      account({ id: "a" }),
      account({ id: "b", name: "Savings", current_balance_cents: null, available_balance_cents: null })
    ]);
    const screen = await runScreen("banking-surface.html",
      ["bsGroups", "bsTodo", "bsSource"], surface);
    const hits = marked(screen.els.bsGroups.innerHTML, screen.selector);
    assert.ok(hits.length > 0,
      "the group has a real total over accounts with a hole in them and is not " +
      "being marked as a floor");
  });

  test("a complete group gets no marker at all", async () => {
    const screen = await runScreen("banking-surface.html",
      ["bsGroups", "bsTodo", "bsSource"], bankingSurface([account({ id: "a" })]));
    assert.equal(marked(screen.els.bsGroups.innerHTML, screen.selector).length, 0);
  });
});
