// The five deliverables must be produced when the credit file lands, whether or
// not Inngest ever wakes up. F42.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { onAnalysisCompletedDeliverables, register } from "./crs-deliverables.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { registerAll } from "../register-all.mjs";

/** Enough of a database for C-06's three reads and two writes. */
function fakeDb({ customFields = {}, outcomeTier = "FULL_FUNDING" } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      if (/UPDATE clients/i.test(sql)) { writes.push({ sql, params }); return { rows: [] }; }
      if (/INSERT INTO/i.test(sql)) { writes.push({ sql, params }); return { rows: [{ id: "row-1" }] }; }
      if (/SELECT custom_fields FROM clients/i.test(sql)) return { rows: [{ custom_fields: customFields }] };
      if (/FROM clients/i.test(sql)) {
        return { rows: [{ id: "cl-1", org_id: "org-1", outcome_tier: outcomeTier, email: "x@example.test", custom_fields: customFields }] };
      }
      return { rows: [] };
    }
  };
}

const EVENT = Object.freeze({
  id: "evt-1",
  name: "analysis.completed",
  orgId: "org-1",
  clientId: "cl-1",
  payload: { source: "crs", scores: { ex: 700, eq: 710, tu: 705 }, outcomeTier: "FULL_FUNDING" }
});

describe("deliverables are produced in-process on analysis.completed", () => {
  test("it is registered on the bus by registerAll", () => {
    clearHandlers();
    registerAll();
    const names = getHandlers("analysis.completed").map((f) => f.name);
    assert.ok(names.includes("onAnalysisCompletedDeliverables"),
      `analysis.completed has no deliverables handler — got ${names.join(", ")}`);
    clearHandlers();
  });

  test("a non-CRS analysis event is left alone", async () => {
    const out = await onAnalysisCompletedDeliverables(
      { ...EVENT, payload: { source: "analyzer" } }, fakeDb());
    assert.deepEqual(out, { done: false, reason: "not_crs_source" });
  });

  test("an event with no org does nothing", async () => {
    const out = await onAnalysisCompletedDeliverables({ ...EVENT, orgId: null }, fakeDb());
    assert.deepEqual(out, { done: false, reason: "no_org" });
  });

  test("a funding client takes C-06's funding branch and delivery is attempted", async () => {
    const db = fakeDb();
    const out = await onAnalysisCompletedDeliverables(EVENT, db);
    assert.equal(out.branch, "funding", "the funding path must be taken");
    assert.ok(out.delivery, "delivery must have been attempted, not skipped");
  });

  test("it shares C-06's idempotency stamp, so a later Inngest run is a no-op", async () => {
    // The bus hands the SAME events-row id to the local dispatch and to Inngest.
    const db = fakeDb({ customFields: { funding_letters_delivered_event_id: "evt-1" } });
    const out = await onAnalysisCompletedDeliverables(EVENT, db);
    assert.deepEqual(out.delivery, { delivered: true, skipped: true });
    assert.equal(db.writes.filter((w) => /UPDATE clients/i.test(w.sql) && /funding_letters_delivered/.test(String(w.params?.[1]))).length, 0,
      "an already-delivered event must not be stamped a second time");
  });
});
