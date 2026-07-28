import { test } from "node:test";
import assert from "node:assert";
import {
  handle, isStalled, isHardStopped, CLIENT_TAGS, ESCALATED_TAG,
  EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY
} from "./dpc-05-no-progress-escalation.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "no progress", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "no progress sms", compliance_passed: true }
];

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

// A client by 05/30's definition (Part A lines 78, 83, 88).
const client = (over = {}) => ({
  id: "cl-1", org_id: "org-1", email: "a@b.com",
  tags: ["client:funding"], custom_fields: {}, ...over
});

// --- the 72-hour sliding test (doc 178-179, 197-199) ------------------------

test("isStalled: older than 72h is stalled, newer is not", () => {
  assert.equal(isStalled({ last_progress_timestamp: hoursAgo(73) }), true);
  assert.equal(isStalled({ last_progress_timestamp: hoursAgo(71) }), false);
});

test("isStalled: never progressed at all is stalled", () => {
  for (const cf of [{}, { last_progress_timestamp: null }, { last_progress_timestamp: "now" }]) {
    assert.equal(isStalled(cf), true);
  }
});

// The exact regression: the old test compared progress against the BOOKING time, so a
// client who did one thing right after booking then went silent for weeks read as
// "progress made" forever. Under the sliding rule they escalate.
test("REGRESSION: progress shortly after booking, then weeks of silence, IS stalled", () => {
  assert.equal(isStalled({ last_progress_timestamp: hoursAgo(24 * 21) }), true);
});

test("isHardStopped: any hard_stop_reason takes the contact out of the pipeline", () => {
  assert.equal(isHardStopped({ hard_stop_reason: "collections" }), true);
  assert.equal(isHardStopped({}), false);
});

// --- the gates ---------------------------------------------------------------

test("happy path: a stalled client escalates once", async () => {
  const db = pgFake({
    clients: [client({ custom_fields: { last_progress_timestamp: hoursAgo(100) } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.messages.length, 2);
  assert.ok(db.clients[0].tags.includes(ESCALATED_TAG));
});

// THE CRITICAL REGRESSION: escalation email AND SMS used to go to leads who never
// became clients. The client-type gate runs before any send.
test("REGRESSION: a lead who booked but never became a client is never messaged", async () => {
  const db = pgFake({
    clients: [client({ tags: [], custom_fields: { last_progress_timestamp: hoursAgo(100) } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_a_client");
  assert.equal(db.messages.length, 0, "no email and no SMS may reach a non-client");
  assert.equal(db.tasks.length, 0);
});

test("all three 05/30 client tags qualify, including the outsourced repair lanes", async () => {
  for (const tag of CLIENT_TAGS) {
    const db = pgFake({
      clients: [client({ tags: [tag], custom_fields: { last_progress_timestamp: hoursAgo(100) } })],
      templates: withTemplates()
    });
    const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, true, `tag ${tag} should qualify as a client`);
  }
});

test("branch: already escalated does not escalate again", async () => {
  const db = pgFake({
    clients: [client({ tags: ["client:funding", ESCALATED_TAG], custom_fields: { last_progress_timestamp: hoursAgo(100) } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.reason, "already_escalated");
  assert.equal(db.messages.length, 0);
});

test("branch: hard-stopped contacts are excluded from escalation", async () => {
  const db = pgFake({
    clients: [client({ custom_fields: { last_progress_timestamp: hoursAgo(100), hard_stop_reason: "collections" } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.reason, "hard_stopped");
  assert.equal(db.messages.length, 0);
});

test("branch: recent progress means no escalation", async () => {
  const db = pgFake({
    clients: [client({ custom_fields: { last_progress_timestamp: hoursAgo(2) } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.reason, "progress_made");
  assert.equal(db.messages.length, 0);
});

// decision_status no longer short-circuits: a contact who decided and then stalled is
// still escalated, which the old version could never do.
test("REGRESSION: decision_status set no longer suppresses a genuine 72h stall", async () => {
  const db = pgFake({
    clients: [client({ custom_fields: { decision_status: "yes", last_progress_timestamp: hoursAgo(100) } })],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
});

test("duplicate delivery: replaying does not double-escalate", async () => {
  const db = pgFake({
    clients: [client({ custom_fields: { last_progress_timestamp: hoursAgo(100) } })],
    templates: withTemplates()
  });
  const event = ev("booking.created", {}, { id: "evt-dup-dpc05", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.messages.length, 2);
});
