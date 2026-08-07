// UnderwriteIQ end-to-end against real Postgres.
//
// SKIPS unless DATABASE_URL is set — same convention as every other
// .pg.test.mjs in this repo. Lives under src/ (not scripts/ or api/) so
// `npm test`'s glob (src/** and scripts/**, per CLAUDE.md §12) actually runs it.
//
// The path proved, end to end:
//   1. loadSimulatedClient — a real client + tradelines + crs_results row,
//      shaped like a real CRS soft pull (src/demo/simulate-client.mjs).
//   2. Take that CRS payload and run it through the real adapter entrypoint,
//      emitCrsResult (src/adapters/crs.mjs) — this is what a live pull calls.
//   3. Register the client-lifecycle handlers so analysis.completed/
//      decision.rendered actually stamp the client (outcome_tier,
//      total_funding_estimate) the same way a production pull would.
//   4. Load tradelines + card_liabilities + crs_results the same way
//      api/read/underwrite.mjs does, and run the same pure chain:
//      toBureaus → computeUnderwrite → buildSuggestions → buildReport.
//   5. Drive u-02 (analysis.completed's own workflow) with a fake `step`
//      against the same client, and assert the tags/custom_fields it stamps —
//      the readiness signal for letter/delivery, without needing Inngest.
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "../handlers/client-lifecycle.mjs";
import { loadSimulatedClient, teardownSimulated, buildSimulatedCrsPayload } from "../demo/simulate-client.mjs";
import { emitCrsResult } from "../adapters/crs.mjs";
import { toBureaus } from "./adapter.mjs";
import { UPSTREAM, computeUnderwrite, buildSuggestions } from "./engine.mjs";
import { buildReport } from "./report.mjs";
import { evaluateUtilization } from "../alerts/evaluate.mjs";
import { handle as u02Handle } from "../workflows/u-02-analyzer-complete-delivery.mjs";
import { fakeStep } from "../workflows/test-support.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
let orgId = null;
let clientId = null;

before(async () => {
  if (!HAS_DB) return;
  _resetOrgCache();
  clearHandlers();
  registerLifecycle();
  const org = await db.query(`SELECT id FROM orgs ORDER BY created_at ASC LIMIT 1`);
  orgId = org.rows[0]?.id;
  assert.ok(orgId, "need at least one org row — run the seed");
});

after(async () => {
  if (!HAS_DB) return;
  // Anchored CRS events no longer repeat the email in their payload. Remove
  // this test's event rows by client before teardown removes the result anchor.
  if (clientId) await db.query(`DELETE FROM events WHERE client_id = $1`, [clientId]).catch(() => null);
  if (orgId) await teardownSimulated(db, { orgId, clientId }).catch(() => null);
  await close();
});

test("UnderwriteIQ chain: sim client → CRS emit → decision stamp → engine report → u-02 readiness", { skip: !HAS_DB }, async () => {
  // 1. A real client, real tradelines (via the real ingest path), and a
  //    crs_results row shaped like a real CRS soft pull.
  const loaded = await loadSimulatedClient(db, { orgId });
  clientId = loaded.client.id;
  assert.ok(clientId);
  assert.ok(loaded.tradeline_count > 0, "simulated CRS must ingest real tradeline rows");

  // 2. Rebuild the same CRS-shaped payload (buildSimulatedCrsPayload is pure and
  //    deterministic modulo its own outcome/scores) and run it through the real
  //    adapter entrypoint, the way a live pull's result would arrive.
  const payload = buildSimulatedCrsPayload({ email: loaded.email, name: "Simulated Client" });

  const crsResultId = (await db.query(
    `SELECT id FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [clientId]
  )).rows[0]?.id;
  assert.ok(crsResultId, "simulated pull must have a stored CRS result anchor");
  const emitted = await emitCrsResult({
    db, engineResult: payload, clientId, crsResultId, requestId: "simulated-underwrite-request"
  });
  assert.equal(emitted.ok, true, JSON.stringify(emitted));
  const emittedNames = emitted.emitted.map((e) => e.name);
  assert.ok(emittedNames.includes("analysis.completed"), "adapter must emit analysis.completed");
  assert.ok(emittedNames.includes("decision.rendered"), "adapter must emit decision.rendered");

  // 3. registerLifecycle() (called in before()) means analysis.completed and
  //    decision.rendered were just reacted to synchronously by
  //    src/handlers/client-lifecycle.mjs — assert what they stamped.
  const clientRow = (await db.query(
    `SELECT outcome_tier, custom_fields, tags FROM clients WHERE id = $1`,
    [clientId]
  )).rows[0];
  assert.equal(clientRow.outcome_tier, "FULL_FUNDING", "decision.rendered must stamp the tier");
  const fundingEstimate = Number(
    clientRow.custom_fields?.total_funding_estimate ?? clientRow.custom_fields?.analyzer_prequal_amount
  );
  assert.ok(fundingEstimate > 0, "decision.rendered must stamp a funding estimate on the client");

  // 4. Load exactly what api/read/underwrite.mjs loads, then run its pure chain.
  const [tradelinesRes, liabilitiesRes, crsRes] = await Promise.all([
    db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2 ORDER BY apr ASC NULLS LAST, lender ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2 ORDER BY as_of DESC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT result, created_at FROM crs_results WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [clientId, orgId]
    )
  ]);
  assert.ok(tradelinesRes.rows.length > 0, "tradelines must be stored for this client");
  // analysis.completed is now anchored to the stored pull. It announces that
  // row instead of making a second history entry for the same provider result.
  assert.equal(crsRes.rows.length, 1, "the anchored event duplicated the stored CRS result");

  const adapter = toBureaus({
    tradelines: tradelinesRes.rows,
    liabilities: liabilitiesRes.rows,
    crsResults: crsRes.rows,
    customFields: clientRow.custom_fields || {}
  });
  assert.ok(adapter.available.length > 0, "at least one bureau must carry a score");

  const underwrite = computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths);
  const suggestions = buildSuggestions(underwrite);
  const fundhubUtilization = evaluateUtilization(tradelinesRes.rows);
  const report = buildReport({ underwrite, suggestions, adapter, fundhubUtilization });
  report.engine.upstreamCommit = UPSTREAM.commit;

  // 5. Assert the report actually carries scores + utilization + suggestions.
  assert.ok(report.underwrite, "report must carry the engine's underwrite output");
  assert.ok(report.underwrite.metrics, "report.underwrite must carry metrics");
  assert.equal(typeof report.underwrite.metrics.score, "number", "report must carry a primary-bureau score");
  assert.equal(typeof report.underwrite.metrics.utilization_pct, "number", "report must carry a utilization percentage");
  assert.ok(Array.isArray(report.utilizationVoices) && report.utilizationVoices.length > 0, "report must carry utilization voices");
  assert.ok(Array.isArray(suggestions), "suggestions is an array");
  assert.ok(suggestions.length > 0, "FULL_FUNDING sim data must produce at least one suggestion");
  assert.ok(report.engine.upstreamCommit, "report stamps the vendored engine's upstream commit");

  // 6. Letter/delivery readiness: drive u-02 (analysis.completed's own workflow)
  //    against this same client with a fake `step`, and assert the tags +
  //    custom_fields it stamps — without needing Inngest running.
  const u02Result = await u02Handle({
    event: { id: "underwriteiq-pg-test-u02", orgId, clientId, payload: { outcomeTier: "FULL_FUNDING", source: "crs" } },
    db,
    step: fakeStep()
  });
  assert.equal(u02Result.branch, "funding", "FULL_FUNDING is a funding-path tier");

  const afterU02 = (await db.query(`SELECT tags, custom_fields FROM clients WHERE id = $1`, [clientId])).rows[0];
  assert.ok(afterU02.tags.includes("analyzer:complete"), "u-02 must tag the client analyzer:complete");
  assert.ok(afterU02.tags.includes("path:funding"), "u-02 must route a funding tier to path:funding");
  assert.equal(afterU02.custom_fields.analyzer_status, "Complete", "u-02 must stamp analyzer_status");
  assert.equal(afterU02.custom_fields.funding_delivery_sent, true, "u-02 must stamp funding_delivery_sent readiness");
});
