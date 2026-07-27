import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./sys-01-ltv-calculator.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: first funded round sets lifetime value", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("round.funded", { fundedAmount: 10000 }, { id: "evt-r1", clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.lifetimeValue, 10000);
});

test("branch: a second, distinct round adds to the running total", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  await handle({ event: ev("round.funded", { fundedAmount: 10000 }, { id: "evt-r1", clientId: "cl-1" }), db, step: fakeStep() });
  const res = await handle({ event: ev("round.funded", { fundedAmount: 5000 }, { id: "evt-r2", clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.lifetimeValue, 15000);
});

test("duplicate delivery: replaying the SAME round does not double-count", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("round.funded", { fundedAmount: 10000 }, { id: "evt-dup-ltv", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  const second = await handle({ event, db, step: fakeStep() });
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_applied");
  assert.equal(db.clients[0].custom_fields.lifetime_value, 10000);
});
