import { test } from "node:test";
import assert from "node:assert";
import { handle, RESPONSIVENESS } from "./bc-01-customer-responsiveness.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: cleared within 24h scores Fast", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { crs_paid: true } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "fast");
  assert.equal(db.behaviorScores[0].responsiveness, RESPONSIVENESS.fast);
});

test("branch: docs:missing hold cleared between 24h and 48h scores Normal", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }];
  const fundingRounds = [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: "Missing Documents" }];
  const db = pgFake({ clients, fundingRounds });
  let sleeps = 0;
  // Simulate F-06 clearing the hold at the 48h checkpoint (after sleep #2).
  const step = { run: (_id, fn) => fn(), sleep: async () => { sleeps += 1; if (sleeps === 2) fundingRounds[0].hold_reason = null; } };
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step });
  assert.equal(res.responsiveness, "normal");
});

test("branch: docs:missing hold still present after 48h scores Slow", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: "Missing Documents" }]
  });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "slow");
});

test("fix: docs_missing_cleared (invented field) no longer used — hold_reason on round is the real signal", async () => {
  // A client with docs_missing_cleared=true in custom_fields (old dead field) but a round
  // still holding "Missing Documents" should NOT score fast.
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { docs_missing_cleared: true } }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: "Missing Documents" }]
  });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "slow");
});

// KNOWN GAP (logged in workflow-migration-table.md): behavior_scores has no
// idempotency hook in the current schema (no unique constraint, no jsonb column to
// stash an event id) — unlike every other handler in this directory, a replayed
// event here writes a second row instead of a no-op. Low-risk (analytics-only, not
// money/messaging/PII) but does not strictly satisfy Rule 2; would need a schema
// change (out of scope for this session) to fix properly. This test documents the
// gap rather than hiding it.
test("duplicate delivery: KNOWN GAP — replaying writes a second row (no idempotency hook available on behavior_scores)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { crs_paid: true } }] });
  const event = ev("round.started", {}, { id: "evt-dup-bc01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.behaviorScores.length, 2);
});
