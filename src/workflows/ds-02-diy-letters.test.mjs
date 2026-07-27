import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY } from "./ds-02-diy-letters.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplate = () => [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "letters ready", compliance_passed: true }];
const fakeFetch = (ok = true) => async () => ({ ok, status: ok ? 200 : 500 });

// HARD RULE 1 — the whole point of this file: prove BOTH directions.
test("HARD RULE 1 — fires on the not-qualified downsell path (DIY product, non-funding tier)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, true);
  assert.equal(res.delivery.delivered, true);
  assert.deepEqual(db.clients[0].tags, ["client:diy-letters"]);
  assert.equal(db.clients[0].custom_fields.diy_status, "Delivered");
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
});

test("HARD RULE 1 — NEVER fires on the funding route, even for the DIY product name", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "blocked_funding_route:FULL_FUNDING");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.clients[0].tags, undefined, "never tagged client:diy-letters on the funding route");
});

test("branch: non-DIY product is ignored regardless of path", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }], templates: withTemplate() });
  const res = await handle({ event: ev("payment.received", { productName: "Consulting Services Deposit", amount: 3000 }, { clientId: "cl-1" }), db, step: fakeStep(), fetchImpl: fakeFetch(true) });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_diy_product");
});

test("branch: letter delivery failure still tags + tasks, marks status for retry", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({ event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: "cl-1" }), db, step: fakeStep(), fetchImpl: fakeFetch(false) });
  assert.equal(res.delivery.delivered, false);
  assert.equal(db.clients[0].custom_fields.diy_status, "Delivery Failed — Retry");
});

test("duplicate delivery: replaying the same event does not double-send, double-task, or double-tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const event = ev("payment.received", { productName: "Consulting Services Package" }, { id: "evt-dup-ds02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep(), fetchImpl: fakeFetch(true) });
  await handle({ event, db, step: fakeStep(), fetchImpl: fakeFetch(true) });
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags, ["client:diy-letters"]);
});
