import { test } from "node:test";
import assert from "node:assert/strict";
import { negativeKeysFromResult, detectAndPauseFunding } from "./snapshot-negatives.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { pgFake } from "../workflows/test-support.mjs";

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
