import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockingFundingHold, FUNDING_DOC_HOLD, FUNDING_PAUSED_HOLD } from "./doc-gate.mjs";

test("isBlockingFundingHold is the two named hold reasons only", () => {
  assert.equal(isBlockingFundingHold(FUNDING_DOC_HOLD), true);
  assert.equal(isBlockingFundingHold(FUNDING_PAUSED_HOLD), true);
  assert.equal(isBlockingFundingHold("Missing Documents"), false);
  assert.equal(isBlockingFundingHold(null), false);
});
