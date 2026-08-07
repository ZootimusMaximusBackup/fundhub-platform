import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY } from "./ds-02-diy-letters.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplate = () => [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "letters ready", compliance_passed: true }];
/* These tests assert that letters ARE delivered, so the adapters fence has to be
   named as down. It defaults to blocked (src/lib/dry-run.mjs), and handle()
   takes no env, so the fence reads the process environment. Node runs each test
   file in its own process, so this cannot leak into another file. */
process.env.ADAPTERS_DRY_RUN = "0";

// text() is required: outbound calls now read the body once as text.
const fakeFetch = (ok = true) => async () => ({ ok, status: ok ? 200 : 500, text: async () => "{}" });

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
  assert.match(res.reason, /^blocked_not_repair_only:/);
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.clients[0].tags, undefined, "never tagged client:diy-letters on the funding route");
});

test("HARD RULE 1 — fail-closed: null tier (pre-CRS) must NOT send DIY letters", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.match(res.reason, /blocked_not_repair_only:null/);
  assert.equal(db.messages.length, 0, "no email on null tier");
  assert.equal(db.tasks.length, 0, "no task on null tier");
});

test("HARD RULE 1 — fail-closed: unrecognized tier must NOT send DIY letters", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FRAUD_HOLD", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.match(res.reason, /blocked_not_repair_only:FRAUD_HOLD/);
  assert.equal(db.messages.length, 0, "no email on unrecognized tier");
  assert.equal(db.tasks.length, 0, "no task on unrecognized tier");
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
  let fetchCallCount = 0;
  const countingFetch = async () => { fetchCallCount++; return { ok: true, status: 200, text: async () => "{}" }; };
  await handle({ event, db, step: fakeStep(), fetchImpl: countingFetch });
  await handle({ event, db, step: fakeStep(), fetchImpl: countingFetch });
  // The delivery guard must block the re-POST — fetch called exactly once across both runs.
  assert.equal(fetchCallCount, 1, "webhook POST must not fire on replay");
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags, ["client:diy-letters"]);
});
