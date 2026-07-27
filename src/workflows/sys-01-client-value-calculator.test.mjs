import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./sys-01-client-value-calculator.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: approved amount * fee percent computes potential value", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("round.approved", { approvedAmount: 20000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialValue, 2000);
  assert.equal(db.clients[0].custom_fields.potential_value, 2000);
});

test("branch: no approved amount falls back to the analyzer estimate", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("round.approved", { fundingEstimate: 50000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialValue, 50000);
});

test("branch: no basis at all — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});
