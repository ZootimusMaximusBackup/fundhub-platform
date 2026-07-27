import { test } from "node:test";
import assert from "node:assert";
import { handle, FUNDING_TEMPLATES, REPAIR_TEMPLATES } from "./bs-01-precall-launcher.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templatesFor = (keys) => keys.map((k) => ({ org_id: "org-1", template_key: k, channel: "email", body: k, compliance_passed: true }));

test("happy path: funding-path client runs the funding drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }], templates: templatesFor(FUNDING_TEMPLATES) });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, FUNDING_TEMPLATES.length);
  assert.deepEqual(db.clients[0].tags.sort(), ["bs:precall", "call:booked"]);
});

test("branch: repair-only client runs the repair drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: templatesFor(REPAIR_TEMPLATES) });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "repair");
  assert.equal(db.messages.length, REPAIR_TEMPLATES.length);
});

test("branch: no matching path — tags precall but runs no drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "none");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send the drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }], templates: templatesFor(FUNDING_TEMPLATES) });
  const event = ev("booking.created", {}, { id: "evt-dup-bs01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, FUNDING_TEMPLATES.length);
});
