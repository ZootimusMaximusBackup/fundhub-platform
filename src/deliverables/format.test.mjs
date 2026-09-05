import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { usd, moneyRange, median, spaced, parsePct, parseMoney } from "./format.mjs";

describe("deliverables/format — the Python helpers, port for port", () => {
  test("usd matches fundhub_gen.py:203-208", () => {
    assert.equal(usd(7936), "$7,936");
    assert.equal(usd(0), "$0");
    assert.equal(usd(1762.9), "$1,762"); // int() truncates, it does not round
    assert.equal(usd("$558 (high bal)"), "$558 (high bal)");
    assert.equal(usd("Closed"), "Closed");
  });

  test("usd leaves an unknown unknown — it never becomes $0", () => {
    assert.equal(usd(null), "-");
    assert.equal(usd(undefined), "-");
  });

  test("moneyRange collapses whole thousands, fundhub_gen.py:210-213", () => {
    assert.equal(moneyRange(5000, 15000), "$5K-$15K");
    assert.equal(moneyRange(3500, 40000), "$3,500-$40K");
    assert.equal(moneyRange(1000, 250000), "$1K-$250K");
  });

  test("median is the middle bureau score", () => {
    assert.equal(median({ experian: 630, equifax: 636, transunion: 725 }), 636);
    assert.equal(median([725, 630, 636]), 636);
  });

  test("median of no scores is blank, not zero", () => {
    assert.equal(median({}), "");
    assert.equal(median(null), "");
    assert.equal(median({ experian: null, equifax: undefined }), "");
  });

  test("spaced uppercases and nothing else", () => {
    assert.equal(spaced("bureau health"), "BUREAU HEALTH");
    assert.equal(spaced(null), "");
  });

  test("parsePct reads a percentage string", () => {
    assert.equal(parsePct("93%"), 93);
    assert.equal(parsePct(69), 69);
  });

  test("parsePct returns null for anything it cannot read", () => {
    for (const v of [null, undefined, "", "Unknown", "Closed", "Paid/Closed", "N/A"]) {
      assert.equal(parsePct(v), null, `parsePct(${JSON.stringify(v)}) should be null`);
    }
  });

  test("parseMoney takes the first money-looking token", () => {
    assert.equal(parseMoney("$1,762"), 1762);
    assert.equal(parseMoney("$189 or less"), 189);
    assert.equal(parseMoney("$558 (high bal)"), 558);
    assert.equal(parseMoney(429), 429);
  });

  test("parseMoney returns null rather than guessing", () => {
    for (const v of [null, undefined, "", "-", "N/A - Closed", "Unknown"]) {
      assert.equal(parseMoney(v), null, `parseMoney(${JSON.stringify(v)}) should be null`);
    }
  });
});
