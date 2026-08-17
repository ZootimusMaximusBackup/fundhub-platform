import { test } from "node:test";
import assert from "node:assert/strict";
import { dealMath } from "./deal-math.mjs";

test("dealMath requires org", () => {
  assert.throws(() => dealMath({}), /orgId required/);
});

test("dealMath matches the screen formula: fees = deposit + drawn*fee%, net = drawn - fees - debts", () => {
  const out = dealMath({
    orgId: "org-1",
    deposit: 500,
    feePercent: 10,
    debts: 200,
    minPercent: 3,
    drawn: 10000
  });
  assert.equal(out.fees, 500 + 1000);
  assert.equal(out.net, 10000 - 1500 - 200);
  assert.equal(out.monthly, 300);
});

test("dealMath does not invent a draw — zero drawn stays zero", () => {
  const out = dealMath({ orgId: "org-1", deposit: 500, feePercent: 10, debts: 0, drawn: 0 });
  assert.equal(out.drawn, 0);
  assert.equal(out.net, -500);
  assert.equal(out.monthly, 0);
});
