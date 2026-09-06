import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rankedRevolving, targetBal, paydownAmt, bureauStatus, heroCard, fastestWins
} from "./derive.mjs";

// The Jordan Sample rows from fundhub_gen.py:52-59, so the expected answers can
// be read straight off the designed PDF.
const CLIENT = {
  revolving: [
    ["SYNCB/LEVITZ", "Experian", 1762, 1894, "93%", "$189 or less", "CRITICAL"],
    ["CITIBANK SD NA", "Equifax", 429, 624, "69%", "$62 or less", "HIGH"],
    ["BENEFICIAL", "Experian", 239, null, "Unknown", "Keep low", "MONITOR"],
    ["CAPITAL ONE", "Experian", 124, "$558 (high bal)", "Closed", "N/A - Closed", "CLOSED"],
    ["DISCOVERCARD (x2)", "TransUnion", 0, null, "0%", "Perfect", "CLEAN"]
  ],
  bureaus: [
    ["TransUnion", "CLEAN", 0, "No derogatory items."],
    ["Experian", "DIRTY", 1, "Charge-off."]
  ],
  negatives: [{ n: 1, creditor: "SIGNET BANK/VIRGINIA", bureau: "Experian" }]
};

describe("deliverables/derive", () => {
  test("rankedRevolving puts the fullest card first", () => {
    assert.deepEqual(rankedRevolving(CLIENT).map((r) => r[0]),
      ["SYNCB/LEVITZ", "CITIBANK SD NA", "DISCOVERCARD (x2)", "BENEFICIAL", "CAPITAL ONE"]);
  });

  test("a card with unknown utilization sorts last, it is not treated as 0%", () => {
    const order = rankedRevolving(CLIENT).map((r) => r[0]);
    assert.ok(order.indexOf("DISCOVERCARD (x2)") < order.indexOf("BENEFICIAL"),
      "0% must outrank Unknown");
  });

  test("rows with no creditor are dropped", () => {
    const out = rankedRevolving({ revolving: [["", "Experian", 1, 2, "50%"], null] });
    assert.deepEqual(out, []);
  });

  test("targetBal prefers the stated target, else a tenth of the limit", () => {
    assert.equal(targetBal(CLIENT.revolving[0]), 189);
    assert.equal(targetBal(["X", "Experian", 500, 1894, "26%", "", "MONITOR"]), 189);
  });

  test("targetBal is null when there is neither a target nor a limit", () => {
    assert.equal(targetBal(["BENEFICIAL", "Experian", 239, null, "Unknown", "", "MONITOR"]), null);
  });

  test("paydownAmt never goes below zero and is null when unknown", () => {
    assert.equal(paydownAmt(CLIENT.revolving[0]), 1573);
    assert.equal(paydownAmt(["X", "Experian", 50, 1000, "5%", "$100 or less"]), 0);
    assert.equal(paydownAmt(["BENEFICIAL", "Experian", 239, null, "Unknown", ""]), null);
  });

  test("bureauStatus is case-insensitive and reports absence honestly", () => {
    assert.deepEqual(bureauStatus(CLIENT, "experian"), ["DIRTY", 1, "Charge-off."]);
    assert.deepEqual(bureauStatus(CLIENT, "Equifax"), ["", 0, ""]);
  });

  test("heroCard is the highest-utilization card, null on an empty file", () => {
    assert.equal(heroCard(CLIENT)[0], "SYNCB/LEVITZ");
    assert.equal(heroCard({ revolving: [] }), null);
  });

  test("fastestWins names the two paydowns then the first dispute", () => {
    assert.deepEqual(fastestWins(CLIENT), [
      "Pay SYNCB/LEVITZ from $1,762 down to $189",
      "Pay CITIBANK SD NA from $429 down to $62",
      "Send dispute letters for SIGNET BANK/VIRGINIA on Experian"
    ]);
  });

  test("fastestWins on an empty file is empty, not invented", () => {
    assert.deepEqual(fastestWins({}), []);
  });
});
