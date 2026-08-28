import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCommasSafeCopy,
  isCommasSafeCopy,
  commasCopyViolation
} from "./commas-safe-copy.mjs";

test("consulting titles pass", () => {
  for (const title of [
    "Consulting Services Assessment",
    "Consulting Services Engagement",
    "Consulting Services Package",
    "Consulting Services Standard",
    "Consulting Services Trial",
    "Consulting Services Program",
    "Consulting Services Completion",
    "Consulting Services Records"
  ]) {
    assert.equal(isCommasSafeCopy(title), true, title);
  }
});

test("finance-branded strings fail", () => {
  for (const bad of [
    "Funding, done-for-you",
    "Credit repair, done-for-you",
    "Business Financial Assessment",
    "Consulting Services Deposit",
    "Consulting Success Fee",
    "UnderwriteIQ soft-pull assessment",
    "Success fee INV-12"
  ]) {
    assert.ok(commasCopyViolation(bad), bad);
  }
});

test("assertCommasSafeCopy throws commas_unsafe_copy", () => {
  assert.throws(
    () => assertCommasSafeCopy("Credit Optimization", { field: "product.title" }),
    (err) => err && err.code === "commas_unsafe_copy"
  );
});
