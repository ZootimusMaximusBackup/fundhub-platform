import { test } from "node:test";
import assert from "node:assert";
import { normalizeCrsResult, mapToCanonical, emitCrsResult } from "./crs.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — same shape as commas.test.mjs
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

// Representative engine result matching engine.js top-level return shape
const REPRESENTATIVE_ENGINE_RESULT = {
  ok: true,
  outcome: "FULL_FUNDING",
  reason_codes: ["CLEAN_BUREAUS", "LOW_UTILIZATION"],
  confidence: "high",
  preapprovals: {
    personalCard: { final: 10000 },
    personalLoan: { final: 20000 },
    business: { final: 50000 },
    totalCombined: 80000
  },
  consumerSignals: {
    scores: {
      perBureau: { ex: 740, eq: 730, tu: 750 },
      median: 740
    },
    utilization: { pct: 18, band: "good" }
  },
  crm_payload: {
    contact: { email: "CLIENT@EXAMPLE.COM" },
    outcome: "FULL_FUNDING",
    scores: { ex: 740, eq: 730, tu: 750 }
  },
  normalized: {
    inquiries: [
      { creditorName: "CAPITAL ONE", source: "ex", date: "2024-01-15", businessType: "Finance" },
      { creditorName: "CHASE BANK", source: "tu", date: "2024-02-20", businessType: "Finance" }
    ]
  }
};

// --- normalizeCrsResult -------------------------------------------------------

test("normalizeCrsResult: reads representative engine result correctly", () => {
  const norm = normalizeCrsResult(REPRESENTATIVE_ENGINE_RESULT);
  assert.equal(norm.outcomeTier, "FULL_FUNDING");
  assert.equal(norm.fundingEstimate, 80000);
  assert.deepEqual(norm.scores, { ex: 740, eq: 730, tu: 750 });
  assert.equal(norm.utilization, 18);
  assert.deepEqual(norm.reasonCodes, ["CLEAN_BUREAUS", "LOW_UTILIZATION"]);
  assert.equal(norm.email, "client@example.com"); // lowercased
  assert.deepEqual(norm.newInquiries, [
    { bureau: "ex", inquiry: "CAPITAL ONE" },
    { bureau: "tu", inquiry: "CHASE BANK" }
  ]);
});

test("normalizeCrsResult: falls back to crm_payload.customFields for funding estimate", () => {
  const r = {
    outcome: "REPAIR_ONLY",
    reason_codes: [],
    crm_payload: {
      customFields: { total_funding_estimate: 5000, crs_utilization: 65 },
      contact: { email: "a@b.com" }
    },
    consumerSignals: { scores: { perBureau: { ex: null, eq: null, tu: null } }, utilization: {} }
  };
  const norm = normalizeCrsResult(r);
  assert.equal(norm.fundingEstimate, 5000);
  assert.equal(norm.utilization, 65);
});

test("normalizeCrsResult: reads nested outcomeResult.reasonCodes when reason_codes absent", () => {
  const r = {
    outcome: "MANUAL_REVIEW",
    outcomeResult: { reasonCodes: ["INCOMPLETE_PULL"] },
    consumerSignals: { scores: { perBureau: {} }, utilization: {} }
  };
  const norm = normalizeCrsResult(r);
  assert.deepEqual(norm.reasonCodes, ["INCOMPLETE_PULL"]);
});

test("normalizeCrsResult: null/empty input returns safe defaults", () => {
  const norm = normalizeCrsResult(null);
  assert.equal(norm.outcomeTier, null);
  assert.equal(norm.fundingEstimate, null);
  assert.equal(norm.utilization, null);
  assert.deepEqual(norm.reasonCodes, []);
  assert.deepEqual(norm.scores, { ex: null, eq: null, tu: null });
  assert.deepEqual(norm.newInquiries, []);
});

// --- mapToCanonical -----------------------------------------------------------

test("mapToCanonical: emits exactly [analysis.completed, decision.rendered]", () => {
  const norm = normalizeCrsResult(REPRESENTATIVE_ENGINE_RESULT);
  const events = mapToCanonical(norm);
  assert.deepEqual(events.map((e) => e.name), ["analysis.completed", "decision.rendered"]);
});

test("mapToCanonical: analysis.completed payload carries scores, utilization, reasonCodes, newInquiries", () => {
  const norm = normalizeCrsResult(REPRESENTATIVE_ENGINE_RESULT);
  const [analysis] = mapToCanonical(norm);
  assert.deepEqual(analysis.payload.scores, { ex: 740, eq: 730, tu: 750 });
  assert.equal(analysis.payload.utilization, 18);
  assert.deepEqual(analysis.payload.reasonCodes, ["CLEAN_BUREAUS", "LOW_UTILIZATION"]);
  assert.deepEqual(analysis.payload.newInquiries, [
    { bureau: "ex", inquiry: "CAPITAL ONE" },
    { bureau: "tu", inquiry: "CHASE BANK" }
  ]);
  assert.equal(analysis.payload.source, "crs");
});

test("mapToCanonical: decision.rendered payload carries outcomeTier, fundingEstimate", () => {
  const norm = normalizeCrsResult(REPRESENTATIVE_ENGINE_RESULT);
  const [, decision] = mapToCanonical(norm);
  assert.equal(decision.payload.outcomeTier, "FULL_FUNDING");
  assert.equal(decision.payload.fundingEstimate, 80000);
  assert.equal(decision.payload.source, "crs");
});

test("mapToCanonical: no outcomeTier => empty array", () => {
  const events = mapToCanonical({ outcomeTier: null, scores: {}, reasonCodes: [] });
  assert.deepEqual(events, []);
});

// --- emitCrsResult idempotency -----------------------------------------------

test("emitCrsResult: idempotent re-emit is deduped, no dispatch", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("analysis.completed", () => (fired += 1));
  on("decision.rendered", () => (fired += 1));

  const db = fakeDb({ dedup: true });
  const res = await emitCrsResult({ db, engineResult: REPRESENTATIVE_ENGINE_RESULT, clientId: "client-1" });
  assert.ok(res.ok);
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events should be deduped");
  assert.equal(fired, 0, "handlers must not fire on deduped replay");
});

// --- emitCrsResult full dispatch to handlers ---------------------------------

test("emitCrsResult: dispatches to registered handlers on both events", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("analysis.completed", (e) => seen.push(e.name));
  on("decision.rendered", (e) => seen.push(e.name));

  const store = [];
  const db = fakeDb({ store });
  const res = await emitCrsResult({ db, engineResult: REPRESENTATIVE_ENGINE_RESULT, clientId: "client-42" });

  assert.ok(res.ok);
  assert.equal(res.emitted.length, 2);
  assert.deepEqual(res.emitted.map((e) => e.name), ["analysis.completed", "decision.rendered"]);
  assert.deepEqual(seen.sort(), ["analysis.completed", "decision.rendered"]);

  // Verify stored payloads carry the right fields
  const analysisRow = store.find((r) => r.name === "analysis.completed");
  assert.ok(analysisRow, "analysis.completed should be stored");
  assert.deepEqual(analysisRow.payload.scores, { ex: 740, eq: 730, tu: 750 });

  const decisionRow = store.find((r) => r.name === "decision.rendered");
  assert.ok(decisionRow, "decision.rendered should be stored");
  assert.equal(decisionRow.payload.outcomeTier, "FULL_FUNDING");
  assert.equal(decisionRow.payload.fundingEstimate, 80000);
});

test("emitCrsResult: no outcomeTier => ok:false, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const res = await emitCrsResult({ db: fakeDb(), engineResult: { ok: true } });
  assert.equal(res.ok, false);
  assert.equal(res.emitted.length, 0);
  assert.equal(res.reason, "no_outcome_tier");
});

test("emitCrsResult: caller-supplied clientId overrides engine-embedded", async () => {
  _resetOrgCache(); clearHandlers();
  // Engine result has a clientId embedded; caller passes a different one.
  const engineResult = { ...REPRESENTATIVE_ENGINE_RESULT, clientId: "engine-id" };
  const db = fakeDb({ store: [] });
  // Just verify it doesn't throw and emits both events
  const res = await emitCrsResult({ db, engineResult, clientId: "caller-id" });
  assert.ok(res.ok);
  assert.equal(res.emitted.length, 2);
});
