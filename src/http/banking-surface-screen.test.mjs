/* Tests for the inline wiring script in public/app/banking-surface.html.
 *
 * THE DEFECT THIS FILE EXISTS FOR (audit M8). The screen ships a hard-coded
 * sample block reading "Personal 2,400.00" and "Unclassified 9,000.00". Nothing
 * in this repo writes `bank_accounts` — the Plaid account fetch returns
 * not_implemented — so for a real, named client the read comes back with zero
 * accounts, or does not come back at all when Plaid is unconfigured (403). On
 * both of those paths the wiring returned before it touched the DOM, so those
 * two invented dollar figures stayed on screen under that client's name, with
 * nothing contradicting them but an 11px banner pinned to the bottom edge.
 *
 * The rule under test: ONCE THE URL NAMES A CLIENT, NO SAMPLE MONEY. Every way
 * the read can end — rows, no rows, or no answer — must leave the screen showing
 * that client's state and never a balance nobody has.
 *
 * It is tested from src/ rather than public/ because package.json's test glob
 * only walks src/ and scripts/ (see the traps section of CLAUDE.md).
 *
 * THE FIXTURES ARE NOT HAND-WRITTEN RESPONSE SHAPES. The success payloads are
 * built by calling the real src/finance/banking-surface.mjs the way
 * api/read/banking-surface.mjs calls it, so if that module's output moves these
 * go red instead of the screen going quietly wrong. The starting DOM is not
 * hand-written either: the sample markup is lifted out of the .html file at run
 * time, so this cannot pass against a sample block that has drifted.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { bankingSurface } from "../finance/banking-surface.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/banking-surface.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* The two figures the sample block states. If either of these ever appears on
   screen while the URL names a client, this screen is telling that client they
   have money the database has never heard of. */
const INVENTED = ["2,400.00", "9,000.00"];

/* ── lifting the real page apart ──────────────────────────────────────────── */

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "banking-surface.html no longer has an inline wiring script");
  return m[1];
}

/** sampleGroupsMarkup — what #bsGroups contains before any script runs. Scanned
    with a depth counter rather than a regex because the block nests. */
function sampleGroupsMarkup() {
  const open = '<div id="bsGroups">';
  const start = HTML.indexOf(open);
  assert.ok(start >= 0, "banking-surface.html no longer has a #bsGroups host");
  const from = start + open.length;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(HTML))) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return HTML.slice(from, m.index);
  }
  throw new Error("#bsGroups is unbalanced in banking-surface.html");
}

/* ── the browser stub ─────────────────────────────────────────────────────── */

function makeEl(id, html = "") {
  return {
    id,
    innerHTML: html,
    className: "",
    textContent: "",
    style: { cssText: "" },
    setAttribute() {},
    appendChild() {}
  };
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path)` returns { status, body } for the one /api/read/banking-surface
 * call the screen makes. `search` is the query string in the address bar.
 * Returns the elements the screen paints into, after the read has settled.
 */
async function runScreen({ search = `?client_id=${CID}`, respond } = {}) {
  const els = {
    bsGroups: makeEl("bsGroups", sampleGroupsMarkup()),
    bsTodo: makeEl("bsTodo"),
    bsSource: makeEl("bsSource", "")
  };
  const calls = [];

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
      setItem() {},
      removeItem() {}
    },
    location: { search },
    URLSearchParams,
    fetch: (p) => {
      calls.push(p);
      const r = respond(p);
      return Promise.resolve({
        status: r.status,
        json: () => Promise.resolve(r.body)
      });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  vm.runInContext(inlineScript(), sandbox, { filename: SCREEN + "#wiring" });

  // The wiring does not hand back its promise, so drain the queue instead.
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  return {
    els,
    calls,
    groups: () => els.bsGroups.innerHTML,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : "")
  };
}

/** assertNoInventedMoney — the one assertion this file is about. */
function assertNoInventedMoney(screen, why) {
  for (const figure of INVENTED) {
    assert.ok(
      !screen.groups().includes(figure),
      `${why}: the screen is still showing the invented sample figure ${figure} ` +
        `for a named client. Rendered:\n${screen.groups()}`
    );
  }
}

/* ── fixtures, built the way the endpoint builds them ─────────────────────── */

const okBody = (rows) => ({ status: 200, body: { ok: true, ...bankingSurface(rows) } });

const account = (over = {}) => ({
  id: "acct-1",
  client_id: CID,
  name: "Everyday Checking",
  mask: "4321",
  account_type: "depository",
  account_subtype: "checking",
  available_balance_cents: "185000",
  current_balance_cents: "185000",
  entity_kind: "personal",
  entity_kind_source: "client_confirmed",
  closed_at: null,
  ...over
});

/* ── the fixture itself has to be honest ──────────────────────────────────── */

describe("banking-surface.html — the sample block", () => {
  test("the page really does ship those two invented figures", () => {
    const sample = sampleGroupsMarkup();
    for (const figure of INVENTED) {
      assert.ok(sample.includes(figure),
        `the sample block no longer contains ${figure} — update INVENTED`);
    }
  });

  test("with no client in the URL the sample stays, and says it is sample", async () => {
    // This is the intended behaviour and must not be broken by the fix: with
    // nobody named, the sample block is layout, not a claim about anyone.
    const screen = await runScreen({ search: "", respond: () => okBody([]) });
    assert.equal(screen.calls.length, 0, "no client named — nothing should be read");
    assert.ok(screen.groups().includes("2,400.00"),
      "the no-client sample block should be left alone");
    assert.match(screen.banner(), /sample banking surface/);
  });
});

/* ── the defect ───────────────────────────────────────────────────────────── */

describe("banking-surface.html — a named client never sees invented money", () => {

  test("read succeeds and the client genuinely has no accounts", async () => {
    // The live case today: nothing writes bank_accounts, so this is what every
    // real client returns.
    const screen = await runScreen({ respond: () => okBody([]) });
    assertNoInventedMoney(screen, "zero accounts on file");
    assert.match(screen.groups(), /No bank accounts on file/i);
  });

  test("read succeeds but comes back with no groups at all", async () => {
    // A response whose `groups` key is empty or missing used to return before
    // the DOM was touched, leaving the sample money on screen.
    const screen = await runScreen({
      respond: () => ({ status: 200, body: { ok: true, source: "bank_accounts", accounts: 0, groups: [] } })
    });
    assertNoInventedMoney(screen, "empty groups array");
  });

  test("Plaid is not configured and the endpoint answers 403", async () => {
    // api/read/banking-surface.mjs returns 403 when isPlaidEnabled() is false,
    // which data.js classifies as `unauthorized`. The read never reaches paint,
    // so nothing used to clear the sample figures.
    const screen = await runScreen({
      respond: () => ({ status: 403, body: { ok: false, error: "banking surface requires plaid configuration" } })
    });
    assertNoInventedMoney(screen, "403 from the endpoint");
  });

  test("the backend is unreachable", async () => {
    const screen = await runScreen({
      respond: () => ({ status: 503, body: { ok: false, error: "database unreachable" } })
    });
    assertNoInventedMoney(screen, "503 from the endpoint");
    /* This used to assert /backend unavailable/. Audit m17 split that one
       message into the cases the front end can actually tell apart: a 503 is
       the database saying so itself, so it — and only it — names the database.
       A 500 from a crashed handler now reads differently; see the sibling
       assertion in src/http/data-js.test.mjs. */
    assert.match(screen.banner(), /the database is not answering/);
  });

  test("the id in the URL is stale and the endpoint rejects it", async () => {
    const screen = await runScreen({
      respond: () => ({ status: 400, body: { ok: false, error: "bad request parameter" } })
    });
    assertNoInventedMoney(screen, "400 from the endpoint");
  });

  test("a failed read still leaves the reason on screen, not a blank card", async () => {
    const screen = await runScreen({
      respond: () => ({ status: 503, body: { ok: false, error: "database unreachable" } })
    });
    assert.ok(screen.groups().trim().length > 0,
      "clearing the sample must not blank the screen");
    assert.doesNotMatch(screen.groups(), /sample/i,
      "nothing left behind may still be labelled sample");
  });
});

/* ── the real path still works ────────────────────────────────────────────── */

describe("banking-surface.html — real rows still render", () => {

  test("a client with accounts gets their own numbers and no sample", async () => {
    const screen = await runScreen({ respond: () => okBody([account()]) });
    assertNoInventedMoney(screen, "a client with real rows");
    assert.match(screen.groups(), /1,850\.00/, "the real balance should be on screen");
    assert.match(screen.groups(), /Everyday Checking/);
    assert.match(screen.banner(), /live banking surface/);
  });

  test("an unclassified account is still shown as unclassified, not personal", async () => {
    // The one rule the module exists to enforce, checked at the last mile.
    const screen = await runScreen({
      respond: () => okBody([
        account({ id: "a", entity_kind: "personal", entity_kind_source: "client_confirmed" }),
        account({ id: "b", name: "Unnamed account", entity_kind: "unknown",
                  entity_kind_source: null, current_balance_cents: "900000",
                  available_balance_cents: "900000" })
      ])
    });
    assert.match(screen.groups(), /whose money: not established/);
    assert.match(screen.els.bsTodo.textContent, /have not been placed yet/);
  });
});
