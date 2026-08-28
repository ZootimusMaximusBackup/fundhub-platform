import { test } from "node:test";
import assert from "node:assert/strict";
import { isTipRow, normalizeName, slugFromName } from "./tips.mjs";

test("isTipRow flags Alec apply-how notes, not bank names", () => {
  assert.equal(isTipRow("Chase"), false);
  assert.equal(isTipRow("American Express"), false);
  assert.equal(isTipRow("Apply at one Elan bank, then apply to a second with consistent info"), true);
  assert.equal(isTipRow("Amex often approves a second 0% card if the first gets approved"), true);
  assert.equal(
    isTipRow("This note is longer than seventy-two characters so it cannot be a bank name row"),
    true
  );
});

test("slugFromName strips parenthetical noise", () => {
  assert.equal(normalizeName("Native American Bank (0%)"), "Native American Bank");
  assert.equal(slugFromName("Bank of America"), "bank-of-america");
  assert.equal(slugFromName("California Bank & Trust"), "california-bank-and-trust");
});
