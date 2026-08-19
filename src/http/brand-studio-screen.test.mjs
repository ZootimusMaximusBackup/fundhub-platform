/* T10 unit B — Brand Studio must not read FHData before FHData exists.
 *
 * WHAT A PARTNER SAW. Every box on Brand Studio was empty (the grey text is a
 * placeholder, not a value). Press Save and it refused: "Legal entity is
 * required — it goes into every disclosure." The server had the partner's legal
 * name the whole time and was never asked for it.
 *
 * WHY. public/app/data.js is loaded with `defer`. A deferred script runs AFTER
 * the document is parsed; a plain inline <script> runs DURING parse. The inline
 * script under the data.js tag called FHData.wire(FHData.brand(partnerId), …)
 * straight out, with no guard, so on a partner session FHData did not exist yet
 * and the statement threw ReferenceError. The throw killed the rest of that
 * function, __fhBrandHydrateFromServer never ran, and /api/partner-brand was
 * never requested — while three raw fetch() reads in the script ABOVE, which
 * did not go through FHData, all fired normally on the same page load.
 *
 * THE FIX, copied from public/app/affiliate.html which already carries it: do
 * the read on DOMContentLoaded, which fires after every deferred script has run.
 * The `defer` attribute is deliberately NOT removed — that would reorder loading
 * for every other screen that includes data.js.
 *
 * This test reads the file as text. It does not open a browser: the thing that
 * must never come back is a specific SHAPE of source — an FHData call sitting at
 * top level in a script that parses before data.js has run.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "brand-studio.html"), "utf8");

/* The persistence script — everything after the data.js tag. That is the only
   block that touches FHData, and the only one this test is about. */
const DATA_TAG = /<script[^>]*\bsrc="data\.js"[^>]*>\s*<\/script>/;
function persistenceBlock() {
  const m = DATA_TAG.exec(HTML);
  assert.ok(m, "brand-studio.html no longer loads data.js — this test is stale");
  const after = HTML.slice(m.index + m[0].length);
  const open = after.indexOf("<script>");
  const close = after.indexOf("</script>", open);
  assert.ok(open !== -1 && close !== -1, "no inline script follows the data.js tag");
  return after.slice(open + "<script>".length, close);
}

/* Comments talk ABOUT FHData at length — including the ones explaining this very
   bug — and a comment is not a call. Stripped before any shape check, keeping
   line numbers intact so a failure message still points at the right line. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

test("data.js is still deferred — the hazard this screen must live with", () => {
  // If this ever fails because somebody dropped `defer`, that is a load-order
  // change for every screen including data.js, not a Brand Studio fix.
  assert.match(HTML, /<script\s+defer\s+src="data\.js">/);
});

test("no FHData call runs at parse time — the partner read waits for DOMContentLoaded", () => {
  const block = stripComments(persistenceBlock());
  const listener = block.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(listener !== -1,
    "the FHData reads are not inside a DOMContentLoaded listener — a partner session " +
    "will throw ReferenceError before /api/partner-brand is ever requested");

  /* Every mention of FHData before that listener must be behind a typeof guard.
     Anything else executes during parse, when FHData does not exist. */
  const before = block.slice(0, listener);
  const unguarded = before.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => line.includes("FHData"))
    .filter(([, line]) => !/typeof\s+FHData/.test(line));
  assert.deepEqual(unguarded.map(([n, l]) => `${n}: ${l.trim()}`), [],
    "these FHData reads run during parse, before the deferred data.js has defined it");
});

test("the partner branch is guarded the same way the org branch already was", () => {
  const block = stripComments(persistenceBlock());
  const call = block.indexOf("FHData.brand(partnerId)");
  assert.ok(call !== -1, "the partner brand read is gone — Brand Studio cannot hydrate");

  const listener = block.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(listener !== -1 && listener < call,
    "the partner read is outside the DOMContentLoaded listener — this is the exact bug");

  // Belt and braces: the same typeof check the org branch and the no-partner
  // branch have carried all along, so a throw here cannot take the listener down.
  const preamble = block.slice(listener, call);
  /* `window.` is optional on purpose: T11's merged loadBrandFromServer writes
     `typeof window.FHData === "undefined"` and the org branch writes it without
     the prefix. Both are the same guard and both are correct — this test checks
     that a guard EXISTS, not how it is spelled. */
  assert.match(preamble, /typeof\s+(?:window\.)?FHData\s*===\s*"undefined"/,
    "the partner branch has no typeof guard, unlike both branches beside it");
});

test("the org branch moved inside the listener too", () => {
  // It failed silently rather than loudly — `typeof FHData === "undefined"` was
  // true at parse time, so it returned early and the CRM brand never hydrated.
  const block = stripComments(persistenceBlock());
  const listener = block.indexOf('document.addEventListener("DOMContentLoaded"');
  const orgRead = block.indexOf("FHData.orgBrand()");
  assert.ok(orgRead !== -1, "the CRM brand read is gone");
  // indexOf returns -1 when the listener is absent, and -1 is less than every
  // real index — so "listener < orgRead" passes on the BROKEN file unless the
  // listener is proven to exist first. Checked, not assumed.
  assert.ok(listener !== -1, "there is no DOMContentLoaded listener at all");
  assert.ok(listener < orgRead, "the org brand read still runs during parse");
});

test("the Save button keeps working the moment the page is interactive", () => {
  // __fhBrandPersist must stay OUTSIDE the listener: the click handler in the
  // script above falls back to "kept in this browser only" if it is missing.
  const block = stripComments(persistenceBlock());
  const persist = block.indexOf("window.__fhBrandPersist = persist");
  const listener = block.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(persist !== -1, "the save bridge is gone — Save can no longer reach the server");
  assert.ok(persist < listener, "the save bridge was moved inside the load listener");
});

test("the business address is both sent and read back", () => {
  /* The field existed on the form, was never put in the PUT body, and was not
     mapped on the way back. Both halves are asserted here because either one
     alone leaves the box empty after a reload. */
  assert.match(HTML, /id="bAddr"/, "the Business address field is gone from the form");
  assert.match(HTML, /entity_address:\s*D\.addr/,
    "the save body does not send entity_address — the address field writes nowhere");
  assert.match(HTML, /hasOwnProperty\.call\(b,\s*"entity_address"\)/,
    "the server's address is not mapped back onto the form");
});

/* ── What the box actually shows ──────────────────────────────────────────────
 *
 * The checks above read the file as text. These four RUN the screen's script in
 * a stripped-down fake browser and then read the Business address box, because
 * the thing that went wrong next was behaviour, not shape.
 *
 * WHAT A PARTNER SAW. They deleted their business address, saved, and reloaded.
 * The old address was still sitting in the box. The server no longer had it —
 * the browser was showing its own leftover copy from an earlier save, and there
 * was no way to tell the two apart. Whatever the box says is supposed to be
 * what the server holds.
 *
 * The fake browser is deliberately dumb: every element is a plain object with a
 * value, nothing is drawn, and no network call is made. It exists only so the
 * screen's own code can run and be asked one question — what is in the box.
 */

test("an address deleted on the server disappears from the box on reload", () => {
  const s = openScreen({ draft: { addr: "500 Old Street" } });
  assert.equal(s.addressBox.value, "500 Old Street",
    "the browser's leftover copy should be on screen before the server answers");
  s.serverSays({ entity_name: "Acme", entity_address: null });
  assert.equal(s.addressBox.value, "",
    "the server holds no address, so the box must be empty — it was showing a stale one");
});

test("the server's address wins over the browser's leftover copy", () => {
  const s = openScreen({ draft: { addr: "500 Old Street" } });
  s.serverSays({ entity_name: "Acme", entity_address: "12 New Road" });
  assert.equal(s.addressBox.value, "12 New Road");
});

test("an address being typed right now is not wiped by the server's answer", () => {
  // The read finishes after the page is usable. Someone may already be typing.
  const s = openScreen({ draft: { addr: "500 Old Street" } });
  s.typeAddress("9 Half Typed Way");
  s.serverSays({ entity_name: "Acme", entity_address: null });
  assert.equal(s.addressBox.value, "9 Half Typed Way",
    "the server's answer erased something a person was in the middle of typing");
});

test("a reply that says nothing about the address changes nothing", () => {
  // Silence is not an answer. Only an answer about this field may overwrite it.
  const s = openScreen({ draft: { addr: "500 Old Street" } });
  s.serverSays({ entity_name: "Acme" });
  assert.equal(s.addressBox.value, "500 Old Street");
});

test("affiliate.html still carries the pattern this screen copied", () => {
  // If the pattern is ever removed there, the comments here point at a fix that
  // no longer exists. Cheap to check, and it names where the pattern came from.
  const AFF = fs.readFileSync(path.join(APP, "affiliate.html"), "utf8");
  assert.match(AFF, /<script\s+defer\s+src="data\.js">/);
  assert.match(AFF, /document\.addEventListener\("DOMContentLoaded"/);
});


/* ── the fake browser ─────────────────────────────────────────────────────────
 *
 * Runs the screen's first inline <script> — the one holding the form, the draft
 * object and the hydrate-from-server bridge — inside node's own sandbox. Every
 * element is a stub with a `value` and a list of handlers. Nothing renders and
 * fetch() answers with an empty object, so no test here can reach a network or
 * a database.
 */
const SCREEN_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(HTML)[1];

function openScreen({ draft } = {}) {
  const nodes = new Map();
  function el(id) {
    const on = {};
    const node = {
      id, value: "", textContent: "", innerHTML: "", href: "", className: "",
      checked: false, dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(t, f) { (on[t] || (on[t] = [])).push(f); },
      fire(t) { (on[t] || []).forEach((f) => f.call(node, { target: node, preventDefault() {} })); },
      appendChild() {}, removeAttribute() {}, setAttribute() {}, getAttribute() { return null; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      focus() {}, blur() {}, remove() {},
      parentNode: { removeChild() {}, appendChild() {}, insertBefore() {} }
    };
    return node;
  }
  function byId(id) { if (!nodes.has(id)) nodes.set(id, el(id)); return nodes.get(id); }

  const store = new Map();
  // Partner mode's draft key. The screen picks it because of ?partner_id= below.
  if (draft) store.set("fh_partner_brand", JSON.stringify(draft));

  const sandbox = {
    console, URL, URLSearchParams, JSON, Math, Date, String, Number, Array, Object,
    setTimeout() {}, clearTimeout() {},
    fetch() { return Promise.resolve({ json: () => Promise.resolve({}) }); },
    confirm() { return false; },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    location: { search: "?partner_id=11111111-1111-1111-1111-111111111111", href: "", replace() {}, reload() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: {
      getElementById: byId,
      querySelectorAll() { return []; }, querySelector() { return null; },
      createElement: (t) => el(t),
      addEventListener() {},
      documentElement: { style: { setProperty() {}, removeProperty() {} } },
      head: { appendChild() {} }, body: { appendChild() {} }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCREEN_SCRIPT, sandbox, { filename: "brand-studio.html (screen script)" });

  return {
    addressBox: byId("bAddr"),
    typeAddress(text) { const box = byId("bAddr"); box.value = text; box.fire("input"); },
    serverSays(brand) { sandbox.window.__fhBrandHydrateFromServer(brand); }
  };
}
