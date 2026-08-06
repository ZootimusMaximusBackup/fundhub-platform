import { test } from "node:test";
import assert from "node:assert/strict";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { register, onDepositPaidGate, onRoundCloseoutGate } from "./inquiry-gate.mjs";

test("register wires deposit.paid and round.closeout (resolves, not file-exists)", () => {
  clearHandlers();
  register();
  assert.ok(getHandlers("deposit.paid").includes(onDepositPaidGate));
  assert.ok(getHandlers("round.closeout").includes(onRoundCloseoutGate));
  assert.equal(getHandlers("round.funded").includes(onRoundCloseoutGate), false);
  assert.equal(getHandlers("diagnostic.paid").length, 0);
});
