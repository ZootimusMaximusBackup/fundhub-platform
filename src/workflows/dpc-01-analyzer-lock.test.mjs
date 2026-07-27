import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./dpc-01-analyzer-lock.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: writes progress markers, does NOT write analyzer_path (c-00 owns it)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  // analysis.completed carries no analyzerPath — workflow must not gate on it
  const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.analyzer_path, undefined); // c-00 owns this
  assert.equal(db.clients[0].custom_fields.last_progress_action, "analyzer_completed");
});
