import { test } from "node:test";
import assert from "node:assert";
import { handle, FUNDING_EMAIL_TEMPLATE_KEY, REPAIR_EMAIL_TEMPLATE_KEY } from "./u-02-analyzer-complete-delivery.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const pdf = (filename, type) => ({
  filename,
  type,
  contentType: "application/pdf",
  content: Buffer.from("%PDF-1.4 stub")
});
const COMPLETE_FUNDING_FILES = [
  pdf("Credit-Analysis-Report.pdf", "credit_analysis"),
  pdf("Credit-Optimization-Roadmap.pdf", "roadmap"),
  pdf("Funding-Snapshot.pdf", "funding_snapshot"),
  pdf("Bank-Lender-Match-List.pdf", "lender_match")
];
const STUB_PACK = { files: COMPLETE_FUNDING_FILES };
const stubPack = async () => STUB_PACK;

test("happy path: funding path sends the funding letter pack delivery", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep(), generatePack: stubPack });
  assert.equal(res.branch, "funding");
  assert.equal(db.messages.length, 1);
  assert.equal(db.clients[0].custom_fields.funding_delivery_sent, true);
});

// Regression (Model drift audit): the production shape. clients.outcome_tier is not
// written until decision.rendered, which the CRS adapter emits AFTER this event — so
// before the fix every real pull fell through to "unknown_path" and no delivery email
// was ever sent.
test("sends the funding delivery from the payload tier when the column is not written yet", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "FULL_FUNDING" }, { clientId: "cl-1" }),
    db, step: fakeStep(), generatePack: stubPack
  });
  assert.equal(res.branch, "funding");
  assert.equal(db.messages.length, 1);
  assert.equal(db.clients[0].custom_fields.funding_delivery_sent, true);
});

// REGRESSION (05/30 doc 79-84): the repair letter pack is the PAID DIY product ($1,000
// default) and ships only from DS-02 behind the cf_diy_paid gate. This branch used to
// email it the moment the CRS pull returned — giving the paid product away for free,
// before any invoice existed. U-02 must tag and route only.
test("REGRESSION: repair path tags but never ships the paid deliverable for free", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }],
    // template deliberately present and sendable — the guard must be the branch, not a missing template
    templates: [{ org_id: "org-1", template_key: REPAIR_EMAIL_TEMPLATE_KEY, channel: "email", body: "repair letters", compliance_passed: true }]
  });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "repair");
  assert.equal(res.delivered, false);
  assert.equal(db.messages.length, 0, "no repair deliverable may send before DS-02's payment gate");
  assert.equal(db.clients[0].custom_fields.repair_delivery_sent, undefined);
  assert.ok(db.clients[0].tags.includes("path:repair"), "still routes the client to the repair lane");
});

test("branch: missing identity tags data-incomplete + creates a task, no send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { identityOk: false }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "data_incomplete");
  assert.equal(res.task.created, true);
  assert.equal(db.messages.length, 0);
});

test("does not send a funding email when Claude produced no PDFs", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("analysis.completed", {}, { clientId: "cl-1" }),
    db, step: fakeStep(), generatePack: async () => ({ files: [] })
  });
  assert.equal(res.branch, "funding");
  assert.equal(res.email.reason, "no_letter_pack");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const event = ev("analysis.completed", {}, { id: "evt-dup-u02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep(), generatePack: stubPack });
  await handle({ event, db, step: fakeStep(), generatePack: stubPack });
  assert.equal(db.messages.length, 1);
});

test("funding pack with only inquiry PDFs does not send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("analysis.completed", {}, { clientId: "cl-1" }),
    db, step: fakeStep(),
    generatePack: async () => ({ files: [pdf("inquiry_ex.pdf", "inquiry_removal"), pdf("personal_info_ex.pdf", "personal_info")] })
  });
  assert.equal(res.branch, "funding");
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "missing_funding_analysis");
  assert.equal(db.messages.length, 0);
  assert.equal(db.clients[0].custom_fields.funding_delivery_sent, undefined);
});

test("MANUAL_REVIEW never sends a pack email", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "MANUAL_REVIEW", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep(), generatePack: stubPack });
  assert.equal(res.branch, "manual_review");
  assert.equal(res.email.sent, false);
  assert.equal(db.messages.length, 0);
});

test("missing client does not throw and does not send", async () => {
  const db = pgFake({
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("analysis.completed", {}, { clientId: null }),
    db, step: fakeStep(), generatePack: stubPack
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.messages.length, 0);
});

test("pack builder throw does not escape handle", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: FUNDING_EMAIL_TEMPLATE_KEY, channel: "email", body: "funding letters", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("analysis.completed", {}, { clientId: "cl-1" }),
    db, step: fakeStep(),
    generatePack: async () => { throw new Error("crs boom"); }
  });
  assert.equal(res.branch, "funding");
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "pack_error");
  assert.equal(db.messages.length, 0);
});
