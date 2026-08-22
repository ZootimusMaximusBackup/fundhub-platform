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

function throwingDb() {
  return {
    query: async () => {
      throw new Error("gate-reached");
    }
  };
}

test("Closed-column closeout does not open an inquiry case", async () => {
  const res = await onRoundCloseoutGate(
    {
      orgId: "org-1",
      clientId: "cl-1",
      name: "round.closeout",
      payload: { stage: "closed", engagementComplete: true }
    },
    throwingDb()
  );
  assert.equal(res.done, false);
  assert.equal(res.reason, "engagement_complete");
});

test("money-chain closeout still reaches the inquiry gate", async () => {
  await assert.rejects(
    () =>
      onRoundCloseoutGate(
        {
          orgId: "org-1",
          clientId: "cl-1",
          name: "round.closeout",
          payload: { fundingRoundId: "fr-1", closeoutId: "co-1", created: true }
        },
        throwingDb()
      ),
    /gate-reached/
  );
});
