import { test } from "node:test";
import assert from "node:assert/strict";
import {
  negativeKeysFromResult,
  bureauStatusFromResult,
  detectAndPauseFunding,
  releaseFundingPause,
  offerDiscountedRepair,
  requestFreshReassessment,
  PAUSED_TAG,
  RELEASE_ROUTE_CLEAN_BUREAUS
} from "./snapshot-negatives.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { pgFake } from "../workflows/test-support.mjs";

function pausedTemplates() {
  return [
    { org_id: "org-1", template_key: "EMAIL-AX07-FUNDING-PAUSED", channel: "email", body: "paused", compliance_passed: true },
    { org_id: "org-1", template_key: "SMS-AX07-FUNDING-PAUSED", channel: "sms", body: "paused sms", compliance_passed: true }
  ];
}

test("negativeKeysFromResult keys charge-offs and public records, not lates", () => {
  const keys = negativeKeysFromResult({
    tradelines: [
      { accountIdentifier: "1111", remarks: "Charge-off" },
      { accountIdentifier: "2222", status: "open", payStatus: "late_30" }
    ],
    publicRecords: [{ source: "EX", type: "bankruptcy", docketNumber: "BK-1" }]
  });
  assert.ok(keys.includes("tl:1111:charge_off"));
  assert.ok(keys.includes("pr:EX:BK-1:bankruptcy"));
  assert.equal(keys.some((k) => k.includes("2222")), false);
});

test("first snapshot stores keys and does not pause", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", custom_fields: {} }],
    crsResults: [{ id: "crs-1", result: { tradelines: [{ accountIdentifier: "1111", remarks: "collection" }] } }]
  });
  const res = await detectAndPauseFunding(db, {
    orgId: "org-1", clientId: "cl-1", crsResultId: "crs-1", eventId: "e1"
  });
  assert.equal(res.fired, false);
  assert.equal(res.reason, "first_snapshot");
  assert.equal(db.clients[0].custom_fields.crs_negative_baseline_set, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, undefined);
});

test("new negative vs prior snapshot pauses funding and tasks the closer", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "a@b.com",
      custom_fields: { crs_negative_baseline_set: true, crs_negative_keys: ["tl:1111:collection"] }
    }],
    crsResults: [{
      id: "crs-2",
      result: {
        tradelines: [
          { accountIdentifier: "1111", remarks: "collection" },
          { accountIdentifier: "9999", remarks: "charge off" }
        ]
      }
    }],
    templates: [
      { org_id: "org-1", template_key: "EMAIL-AX07-FUNDING-PAUSED", channel: "email", body: "paused", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-AX07-FUNDING-PAUSED", channel: "sms", body: "paused sms", compliance_passed: true }
    ]
  });
  const res = await detectAndPauseFunding(db, {
    orgId: "org-1", clientId: "cl-1", crsResultId: "crs-2", eventId: "e2"
  });
  assert.equal(res.fired, true);
  assert.deepEqual(res.added, ["tl:9999:charge_off"]);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_PAUSED_HOLD);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].assignee_role, "closer");
  assert.equal(db.messages.length, 2);
});

test("bureauStatusFromResult names one dirty and two clean", () => {
  const status = bureauStatusFromResult({
    tradelines: [
      { accountIdentifier: "1111", remarks: "Charge-off", source: "EX" },
      { accountIdentifier: "2222", status: "open", payStatus: "late_30", source: "TU" }
    ]
  });
  assert.deepEqual(status.dirty, ["EX"]);
  assert.deepEqual(status.clean, ["EQ", "TU"]);
});

test("new negative on one bureau with two clean names both routes on the task", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "a@b.com",
      custom_fields: { crs_negative_baseline_set: true, crs_negative_keys: [] }
    }],
    crsResults: [{
      id: "crs-ex",
      result: {
        tradelines: [
          { accountIdentifier: "9999", remarks: "charge off", source: "EX" }
        ]
      }
    }],
    templates: pausedTemplates()
  });
  const res = await detectAndPauseFunding(db, {
    orgId: "org-1", clientId: "cl-1", crsResultId: "crs-ex", eventId: "e-one"
  });
  assert.equal(res.fired, true);
  assert.deepEqual(res.bureaus.dirty, ["EX"]);
  assert.deepEqual(res.bureaus.clean, ["EQ", "TU"]);
  assert.match(db.tasks[0].body, /Dirty bureaus: EX/);
  assert.match(db.tasks[0].body, /Clean bureaus: EQ, TU/);
  assert.match(db.tasks[0].body, /fund on the clean bureaus if they choose/);
  assert.deepEqual(db.clients[0].custom_fields.crs_pause_bureaus.clean, ["EQ", "TU"]);
  assert.ok(db.clients[0].tags.includes(PAUSED_TAG));
});

test("new negative on all three bureaus leaves no clean path", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "a@b.com",
      custom_fields: { crs_negative_baseline_set: true, crs_negative_keys: [] }
    }],
    crsResults: [{
      id: "crs-all",
      result: {
        tradelines: [
          { accountIdentifier: "1", remarks: "collection", source: "EX" },
          { accountIdentifier: "2", remarks: "collection", source: "EQ" },
          { accountIdentifier: "3", remarks: "collection", source: "TU" }
        ]
      }
    }],
    templates: pausedTemplates()
  });
  const res = await detectAndPauseFunding(db, {
    orgId: "org-1", clientId: "cl-1", crsResultId: "crs-all", eventId: "e-all"
  });
  assert.equal(res.fired, true);
  assert.deepEqual(res.bureaus.dirty, ["EQ", "EX", "TU"]);
  assert.deepEqual(res.bureaus.clean, []);
  assert.match(db.tasks[0].body, /No bureau is clean/);
  const denied = await releaseFundingPause(db, {
    orgId: "org-1", clientId: "cl-1", staffId: "st-1"
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "no_clean_bureau");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_PAUSED_HOLD);
});

test("clean snapshot after a pause reopens the gate", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      tags: [PAUSED_TAG],
      custom_fields: {
        crs_negative_baseline_set: true,
        crs_negative_keys: ["tl:1111:collection"],
        round_hold_reason: FUNDING_PAUSED_HOLD,
        crs_pause_bureaus: { dirty: ["EX"], clean: ["EQ", "TU"] }
      }
    }],
    crsResults: [{ id: "crs-clean", result: { tradelines: [], publicRecords: [] } }]
  });
  const res = await detectAndPauseFunding(db, {
    orgId: "org-1", clientId: "cl-1", crsResultId: "crs-clean", eventId: "e-clean"
  });
  assert.equal(res.fired, false);
  assert.equal(res.reopened, true);
  assert.equal(res.reason, "clean_snapshot");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].tags.includes(PAUSED_TAG), false);
  assert.equal(db.tasks.length, 1);
  assert.match(db.tasks[0].title, /funding gate reopened/);
  assert.equal(db.messages.length, 0);
});

test("staff release records actor, time, and route when a bureau is clean", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      tags: [PAUSED_TAG],
      custom_fields: {
        crs_negative_baseline_set: true,
        crs_negative_keys: ["tl:9999:charge_off"],
        round_hold_reason: FUNDING_PAUSED_HOLD,
        crs_pause_bureaus: { dirty: ["EX"], clean: ["EQ", "TU"] }
      }
    }]
  });
  const res = await releaseFundingPause(db, {
    orgId: "org-1", clientId: "cl-1", staffId: "st-9"
  });
  assert.equal(res.ok, true);
  const trail = db.clients[0].custom_fields.funding_pause_release;
  assert.equal(trail.staff_id, "st-9");
  assert.equal(trail.route, RELEASE_ROUTE_CLEAN_BUREAUS);
  assert.ok(trail.at);
  assert.equal(db.clients[0].custom_fields.funding_pause_releases.length, 1);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].tags.includes(PAUSED_TAG), false);
});

test("discounted repair reuses REPAIR_DFY and keeps the gate closed", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      tags: [PAUSED_TAG],
      custom_fields: { round_hold_reason: FUNDING_PAUSED_HOLD }
    }]
  });
  const missing = await offerDiscountedRepair(db, {
    orgId: "org-1", clientId: "cl-1", staffId: "st-1"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "amount_required");

  const minted = [];
  const res = await offerDiscountedRepair(db, {
    orgId: "org-1",
    clientId: "cl-1",
    staffId: "st-1",
    amountCents: 75000,
    createPaymentLinkImpl: async (_db, spec) => {
      minted.push(spec);
      return { id: "pl-1", url: "https://pay.example/pl-1" };
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.offerKey, "REPAIR_DFY");
  assert.equal(res.contractTemplateKey, "CREDIT-REPAIR-AGREEMENT");
  assert.equal(res.gateClosed, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_PAUSED_HOLD);
  assert.equal(minted[0].purpose, "repair");
  assert.equal(minted[0].productCode, "repair-bundle");
  assert.equal(minted[0].amountCents, 75000);
});

test("repair complete on a paused client asks for a new pull, not a resumed round", async () => {
  const db = pgFake({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      tags: [PAUSED_TAG],
      custom_fields: { round_hold_reason: FUNDING_PAUSED_HOLD }
    }]
  });
  const skip = await requestFreshReassessment(db, {
    orgId: "org-1", clientId: "cl-other", eventId: "e-skip"
  });
  assert.equal(skip.ok, false);

  const res = await requestFreshReassessment(db, {
    orgId: "org-1", clientId: "cl-1", eventId: "e-done"
  });
  assert.equal(res.ok, true);
  assert.equal(res.resumedPausedRound, false);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_PAUSED_HOLD);
  assert.match(db.tasks[0].title, /new round/);
  assert.match(db.tasks[0].body, /Do not reopen or renumber the paused round/);
});
