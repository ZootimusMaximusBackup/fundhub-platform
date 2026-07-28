import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./sys-01-client-value-calculator.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const client = () => [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }];

test("happy path: approved amount * fee percent is the commission estimate", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { approvedAmount: 20000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialCommission, 2000);
  assert.equal(db.clients[0].custom_fields.potential_commission, 2000);
});

// REGRESSION (05/30 doc 3704-3711): the fallback branch used to return the raw funding
// estimate with no fee multiplication, overstating client value by ~10x at a typical 10%
// fee. The doc applies "Multiply by Funding Fee Percent" on BOTH branches — the output is
// a commission estimate (line 3714), not a capital figure.
test("REGRESSION: the estimate fallback multiplies by fee percent too", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { fundingEstimate: 50000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialCommission, 5000);
  assert.notEqual(res.potentialCommission, 50000, "must not return raw capital as client value");
});

// REGRESSION: the written field is cf_potential_commission (doc 3706, 3710, 5046).
// `potential_value` was invented by the port and nothing reads it.
test("REGRESSION: writes potential_commission, not the invented potential_value", async () => {
  const db = pgFake({ clients: client() });
  await handle({ event: ev("round.approved", { approvedAmount: 10000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(db.clients[0].custom_fields.potential_commission, 1000);
  assert.equal(db.clients[0].custom_fields.potential_value, undefined);
});

test("branch: a basis with no fee percent cannot produce a commission — no-op", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { fundingEstimate: 50000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_basis_for_estimate");
});

test("branch: no basis at all — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});
