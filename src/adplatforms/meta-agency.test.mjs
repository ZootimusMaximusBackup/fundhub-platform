import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMetaBusinessId,
  normalizeMetaAdAccountId,
  pendingAdAccountPlaceholder
} from "./meta.mjs";

test("normalizeMetaBusinessId strips non-digits", () => {
  assert.equal(normalizeMetaBusinessId("147-559-736-0226485"), "1475597360226485");
  assert.equal(normalizeMetaBusinessId(""), null);
});

test("normalizeMetaAdAccountId adds act_ prefix", () => {
  assert.equal(normalizeMetaAdAccountId("982103620742368"), "act_982103620742368");
  assert.equal(normalizeMetaAdAccountId("act_982103620742368"), "act_982103620742368");
  assert.equal(normalizeMetaAdAccountId(""), null);
});

test("pendingAdAccountPlaceholder is stable per business id", () => {
  assert.equal(
    pendingAdAccountPlaceholder("1475597360226485"),
    "pending:biz:1475597360226485"
  );
});
