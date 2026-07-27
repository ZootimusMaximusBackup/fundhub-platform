import { test } from "node:test";
import assert from "node:assert";
import { handle, FUNDING_TEMPLATES, REPAIR_TEMPLATES } from "./bs-01-precall-launcher.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templatesFor = (keys) => keys.map((k) => ({ org_id: "org-1", template_key: k, channel: "email", body: k, compliance_passed: true }));

test("happy path: funding-path client runs the funding drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_STACK_APPROVAL", custom_fields: {} }], templates: templatesFor(FUNDING_TEMPLATES) });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, FUNDING_TEMPLATES.length);
  assert.deepEqual(db.clients[0].tags.sort(), ["bs:precall", "call:booked"]);
});

test("branch: repair-only client runs the repair drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR", custom_fields: {} }], templates: templatesFor(REPAIR_TEMPLATES) });
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

test("timestamps: bs_precall_start_ts and bs_email_last_sent_ts are real ISO strings, not 'now'", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_STACK_APPROVAL", custom_fields: {} }], templates: templatesFor(FUNDING_TEMPLATES) });
  await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.ok(db.clients[0].custom_fields.bs_precall_start_ts !== "now", "bs_precall_start_ts must not be literal 'now'");
  assert.ok(new Date(db.clients[0].custom_fields.bs_precall_start_ts).getFullYear() > 2020);
  assert.ok(db.clients[0].custom_fields.bs_email_last_sent_ts !== "now", "bs_email_last_sent_ts must not be literal 'now'");
});

// KNOWN GAP: FUNDING_TEMPLATES and REPAIR_TEMPLATES reference keys that do not exist
// in templates-seed.mjs. Sends are no-ops when templates are not seeded. The test
// suite seeds them inline (templatesFor), but in production these templates must be
// created before BS-01 can deliver email. Tracking keys that need seeding:
// EMAIL-BS-FUND-01-KICKOFF, EMAIL-BS-FUND-02-MORNING, EMAIL-BS-FUND-03-MIDDAY,
// EMAIL-BS-FUND-04-AFTERNOON, EMAIL-BS-FUND-05-EVENING, EMAIL-BS-REPAIR-00-START,
// EMAIL-BS-REPAIR-01-MORNING, EMAIL-BS-REPAIR-02-MIDMORNING, EMAIL-BS-REPAIR-03-LUNCH,
// EMAIL-BS-REPAIR-04-AFTERNOON, EMAIL-BS-REPAIR-05-EVENING.
test("known gap: BS-01 templates are not in templates-seed — sends are silent no-ops without inline seeding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_STACK_APPROVAL", custom_fields: {} }], templates: [] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.drip, "funding");
  assert.equal(db.messages.length, 0); // no templates seeded = no sends
});

test("duplicate delivery: replaying does not double-send the drip", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_STACK_APPROVAL", custom_fields: {} }], templates: templatesFor(FUNDING_TEMPLATES) });
  const event = ev("booking.created", {}, { id: "evt-dup-bs01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, FUNDING_TEMPLATES.length);
});
