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
    assert.match(HTML, /setSummary\(fhPipelineSummary\(cache\[key\]\)\)/);
    assert.match(HTML, /setSummary\(fhPipelineSummary\(res\.data\.stages\)\)/);
  });

  test("a failed or demo load clears the summary instead of leaving the last rail's numbers on screen", () => {
    assert.match(HTML, /setSummary\(null\)/);
  });
});
