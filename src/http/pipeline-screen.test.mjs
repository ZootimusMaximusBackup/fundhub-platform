/* Tests for public/app/pipeline.html's board-summary bar.
 *
 * It used to print hardcoded Sales sample numbers (82 cards / $544,200 /
 * 4 held) no matter which rail was selected, because nothing ever recomputed
 * it. The fix sums the same count/amount fields buildColumn() already puts on
 * each rendered column, via a small pure function (FH-SUMMARY-BEGIN/END in
 * the page) — tested here in isolation, the way public/app/data.js and
 * closer-dashboard.html's inlined view model are tested elsewhere in this
 * directory.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/pipeline.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const BEGIN = "/* FH-SUMMARY-BEGIN */";
const END = "/* FH-SUMMARY-END */";

function loadSummaryFn() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-SUMMARY markers are gone from pipeline.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-SUMMARY" });
  return sandbox.window.FHPipelineSummary;
}

const RAIL_BEGIN = "/* FH-RAILCOUNT-BEGIN */";
const RAIL_END = "/* FH-RAILCOUNT-END */";

// A fake .rail-tab/.rt-count DOM, just real enough for setRailCount's one
// querySelector call — no jsdom dependency for one function this small.
function loadRailCountFn() {
  const a = HTML.indexOf(RAIL_BEGIN);
  const b = HTML.indexOf(RAIL_END);
  assert.ok(a !== -1 && b > a, "the FH-RAILCOUNT markers are gone from pipeline.html");
  const spans = {};
  const sandbox = {
    window: {},
    document: {
      querySelector(sel) {
        const m = /\.rail-tab\[data-rail="([^"]+)"\] \.rt-count/.exec(sel);
        if (!m) return null;
        if (!spans[m[1]]) spans[m[1]] = { textContent: "—" };
        return spans[m[1]];
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + RAIL_BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-RAILCOUNT" });
  return { setRailCount: sandbox.window.setRailCount, spans };
}

const stage = (count, amount) => ({ count, amount, cards: [] });

describe("public/app/pipeline.html — board-summary totals", () => {

  test("it loads and exposes the summary function", () => {
    const fn = loadSummaryFn();
    assert.equal(typeof fn, "function");
  });

  test("sums count and amount across every stage, not just the visible ones", () => {
    const fn = loadSummaryFn();
    const totals = fn([stage(42, 268400), stage(18, 121300), stage(11, 74800), stage(7, 70700), stage(4, 31600)]);
    assert.equal(totals.count, 82);
    assert.equal(totals.money, 566800);
  });

  test("an empty pipeline is a real zero, not an error", () => {
    const fn = loadSummaryFn();
    assert.deepEqual(fn([]), { count: 0, money: 0 });
  });

  test("no stages at all is still a real zero", () => {
    const fn = loadSummaryFn();
    assert.deepEqual(fn(null), { count: 0, money: 0 });
    assert.deepEqual(fn(undefined), { count: 0, money: 0 });
  });

  test("a stage missing amount or count contributes nothing rather than throwing", () => {
    const fn = loadSummaryFn();
    const totals = fn([{ cards: [] }, stage(5, 1000)]);
    assert.equal(totals.count, 5);
    assert.equal(totals.money, 1000);
  });
});

describe("public/app/pipeline.html — screen wiring", () => {

  test("the sample summary numbers (82 / $544,200 / 4 held) are gone from the markup", () => {
    assert.ok(!/<b>82<\/b>\s*cards/.test(HTML), "hardcoded 82 cards is still in the page");
    assert.ok(!HTML.includes("$544,200"), "hardcoded $544,200 is still in the page");
    assert.ok(!/\b4 held\b/.test(HTML), "hardcoded 4 held is still in the page");
  });

  test("the summary bar has real DOM hooks for card count and est. money", () => {
    assert.match(HTML, /id="sumCount"/);
    assert.match(HTML, /id="sumMoney"/);
  });

  test("held stays an honest dash — the API has no hold field for a card to invent", () => {
    assert.match(HTML, /id="sumHeld"[^>]*>— held</);
  });

  test("both the cache-hit path and the fresh-fetch path update the summary from real stages", () => {
    // Both paths go through applyBoard(), which always sets the summary from
    // the stages it was handed — cache hit and fresh fetch alike.
    assert.match(HTML, /function applyBoard\(stages, rail, label, key\)/);
    assert.match(HTML, /setSummary\(fhPipelineSummary\(stages\)\)/);
    assert.match(HTML, /applyBoard\(cache\[key\], rail, label, key\)/);
    assert.match(HTML, /applyBoard\(res\.data\.stages, rail, label, key\)/);
  });

  test("a failed or demo load clears the summary instead of leaving the last rail's numbers on screen", () => {
    assert.match(HTML, /setSummary\(null\)/);
  });
});

describe("public/app/pipeline.html — rail tab counts", () => {
  // The tabs used to print Sales 82 / Card Stacking 33 / Alt-Fin 15 /
  // Optimization 44 / Inquiry Removal 27 / AR-Collections 75 once at page
  // load and never again, same bug as the summary bar — see cb336b1.

  test("it loads and exposes setRailCount", () => {
    const { setRailCount } = loadRailCountFn();
    assert.equal(typeof setRailCount, "function");
  });

  test("sets the matching rail's count span, and only that one", () => {
    const { setRailCount, spans } = loadRailCountFn();
    setRailCount("R-02", 9);
    assert.equal(spans["R-02"].textContent, "9");
    assert.equal(spans["R-01"], undefined, "a rail nobody set should not exist yet");
  });

  test("a real zero is written the same way as any other count", () => {
    const { setRailCount, spans } = loadRailCountFn();
    setRailCount("R-08", 0);
    assert.equal(spans["R-08"].textContent, "0");
  });

  test("the hardcoded sample rail counts (82/33/15/44/27/75) are gone from the markup", () => {
    for (const n of ["82", "33", "15", "44", "27", "75"]) {
      assert.ok(!new RegExp('<span class="rt-count">' + n + "</span>").test(HTML),
        "hardcoded rail count " + n + " is still in the page");
    }
  });

  test("every rail tab count starts as an honest dash, not an invented number", () => {
    const counts = [...HTML.matchAll(/data-rail="(R-0[1-9])"[^>]*>[\s\S]*?<span class="rt-count">([^<]*)<\/span>/g)];
    assert.equal(counts.length, 8, "expected eight real-pipeline rail tabs (R-01..R-06, R-08, R-09)");
    for (const [, rail, text] of counts) {
      assert.equal(text, "—", rail + " should start at — until the API answers");
    }
  });

  test("R-07 (affiliates_hiring) is retired and gone from the rail bar", () => {
    assert.ok(!/data-rail="R-07"/.test(HTML),
      "R-07 affiliates_hiring is retired; Hiring (R-09) and Affiliates + White Label (R-08) replace it");
    assert.ok(!/"R-0[0-9]":\s*"affiliates_hiring"/.test(HTML),
      "PIPELINE_KEYS must not still map any rail code to affiliates_hiring");
  });

  test("R-08 and R-09 are real pipelines, not permanently-empty stubs", () => {
    assert.ok(!/rail-tab empty" data-rail="R-08"/.test(HTML),
      "R-08 maps to affiliates_white_label and should not carry empty styling");
    assert.ok(!/rail-tab empty" data-rail="R-09"/.test(HTML),
      "R-09 maps to hiring and should not carry empty styling");
    assert.match(HTML, /"R-08":\s*"affiliates_white_label"/);
    assert.match(HTML, /"R-09":\s*"hiring"/);
  });

    test("both the cache-hit path and the fresh-fetch path update the rail tab's own count", () => {
    assert.match(HTML, /setRailCount\(rail, fhPipelineSummary\(stages\)\.count\)/);
    assert.match(HTML, /applyBoard\(cache\[key\], rail, label, key\)/);
    assert.match(HTML, /applyBoard\(res\.data\.stages, rail, label, key\)/);
    // loadRailCounts still writes each inactive rail's count. It reads that
    // number from the one counts request now instead of fetching the rail's
    // whole board to measure it, so the assertion follows the new source.
    assert.match(HTML, /setRailCount\(rail, n\)/);
  });

  test("every real pipeline's count is loaded up front, not just the active rail", () => {
    assert.match(HTML, /function loadRailCounts\(/);
    assert.match(HTML, /loadRailCounts\("R-01"\)/);
  });

  test("the tab counts come from one request, not one whole board per rail", () => {
    // Eight rails once meant eight full board reads on every page load, each
    // pulling up to 500 cards just to take the length. If FHData.pipeline
    // reappears inside loadRailCounts, that cost is back.
    assert.match(HTML, /FHData\.pipelineCounts\(\)/);
    const fn = HTML.slice(HTML.indexOf("function loadRailCounts("));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    assert.ok(!/FHData\.pipeline\(/.test(body),
      "loadRailCounts must not fetch a rail's whole board to count it");
  });

  test("the board's first read waits for the deferred data.js", () => {
    // data.js carries `defer`, so FHData does not exist yet while the inline
    // script is being parsed. Calling it at parse time threw ReferenceError,
    // which killed the rest of the script, and the board never asked for a
    // single card. That shipped to production on 2026-08-17.
    assert.match(HTML, /<script defer src="data\.js">/,
      "data.js is expected to carry defer — if that changed, this guard needs rewriting");
    const listener = HTML.indexOf('document.addEventListener("DOMContentLoaded"');
    const firstRead = HTML.indexOf('load("R-01", "Sales")');
    assert.ok(listener !== -1, "the first board read must sit inside a DOMContentLoaded handler");
    assert.ok(firstRead > listener,
      'load("R-01", "Sales") must run on DOMContentLoaded, not while the page is parsing');
  });

  test("the rail on screen is requested before the other rails' counts", () => {
    const firstRead = HTML.indexOf('load("R-01", "Sales")');
    const counts = HTML.indexOf('loadRailCounts("R-01")');
    assert.ok(firstRead !== -1 && counts !== -1);
    assert.ok(firstRead < counts,
      "the board the user is looking at must not queue behind the tab counts");
  });
});
