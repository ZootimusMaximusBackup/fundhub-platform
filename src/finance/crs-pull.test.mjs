import { test } from "node:test";
import assert from "node:assert";

import { runCrsPull, providerResultIdFor } from "./crs-pull.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function request(id, over = {}) {
  return {
    id,
    org_id: ORG,
    client_id: CLIENT,
    requested_by_kind: "staff",
    requested_by_staff_id: "33333333-3333-4333-8333-333333333333",
    requested_by_account_id: null,
    reason: "paid diagnostic",
    cost_cents: null,
    subscription_id: null,
    crs_result_id: null,
    status: "queued",
    state_reason: null,
    provider: "crs_softview",
    idempotency_key: null,
    requested_at: new Date(),
    resolved_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over
  };
}

function fakeDb(initialRequest) {
  const requests = new Map([[initialRequest.id, initialRequest]]);
  const results = [];
  const events = [];
  const eventKeys = new Set();
  const clients = new Map([[CLIENT, { id: CLIENT, outcome_tier: null }]]);
  let resultNumber = 0;

  return {
    requests,
    results,
    events,
    clients,
    async query(sql, params = []) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };

      if (/FROM soft_pull_requests WHERE id = \$1/.test(sql)) {
        const row = requests.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM crs_results WHERE id = \$1/.test(sql)) {
        const row = results.find((item) => item.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM crs_results\s+WHERE provider = \$1/.test(sql)) {
        const row = results.find(
          (item) => item.provider === params[0] && item.provider_result_id === params[1]
        );
        return { rows: row ? [row] : [] };
      }
      if (/SELECT id FROM soft_pull_requests WHERE crs_result_id/.test(sql)) {
        const row = [...requests.values()].find((item) => item.crs_result_id === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/SET status = 'processing'/.test(sql)) {
        const row = requests.get(params[0]);
        if (!row
            || row.org_id !== params[1]
            || row.client_id !== params[2]
            || row.status !== "queued") {
          return { rows: [] };
        }
        Object.assign(row, { status: "processing", updated_at: new Date() });
        return { rows: [row] };
      }
      if (/INSERT INTO crs_results/.test(sql)) {
        const row = {
          id: `result-${++resultNumber}`,
          org_id: params[0],
          client_id: params[1],
          provider: params[2],
          provider_result_id: params[3],
          result: JSON.parse(params[4]),
          outcome_tier: params[5],
          created_at: new Date()
        };
        results.push(row);
        return { rows: [row] };
      }
      if (/UPDATE clients SET outcome_tier/.test(sql)) {
        const row = clients.get(params[0]) || { id: params[0], outcome_tier: null };
        row.outcome_tier = params[1];
        clients.set(params[0], row);
        return { rows: [row] };
      }
      if (/UPDATE crs_results\s+SET outcome_tier = COALESCE/.test(sql)) {
        const row = results.find((item) => item.id === params[0]);
        if (!row) return { rows: [] };
        if (row.outcome_tier == null) row.outcome_tier = params[1];
        return { rows: [row] };
      }
      if (/SET status = 'fulfilled'/.test(sql)) {
        const row = requests.get(params[0]);
        // $3 is the expected prior status — processing in production, queued only
        // when a legacy caller passes allowQueued.
        if (!row || row.status !== params[2]) return { rows: [] };
        Object.assign(row, {
          status: "fulfilled",
          crs_result_id: params[1],
          resolved_at: new Date(),
          updated_at: new Date()
        });
        return { rows: [row] };
      }
      if (/SET status = \$2, state_reason = \$3/.test(sql)) {
        const row = requests.get(params[0]);
        if (!row || (row.status !== "queued" && row.status !== "processing")) return { rows: [] };
        Object.assign(row, {
          status: params[1],
          state_reason: params[2],
          resolved_at: new Date(),
          updated_at: new Date()
        });
        return { rows: [row] };
      }
      if (/INSERT INTO events/.test(sql)) {
        const key = params[3];
        if (eventKeys.has(key)) return { rows: [] };
        eventKeys.add(key);
        const row = { id: `event-${events.length + 1}`, name: params[1], key, payload: params[5] };
        events.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

function report(score, creditor = "TEST BANK") {
  return {
    scores: [{ score, modelName: "FICO9" }],
    tradelines: [],
    inquiries: [{ creditorName: creditor, sourceType: "Experian", inquiryDate: "2026-08-01" }]
  };
}

function fakeClient(outputs) {
  const calls = [];
  return {
    calls,
    host: "api-sandbox.stitchcredit.com",
    config: { missing: [] },
    isConfigured: () => true,
    async orderPrequal({ bureau }) {
      calls.push(bureau);
      return outputs[bureau];
    }
  };
}

test("runCrsPull stores one tri-bureau result and replays without another order", async () => {
  const db = fakeDb(request("request-1"));
  const client = fakeClient({
    TU: { ok: true, requestId: "REQ-Z", report: report(730, "TU BANK") },
    EX: { ok: true, requestId: "REQ-A", report: report(720, "EX BANK") },
    EQ: { ok: true, requestId: "REQ-M", report: report(710, "EQ BANK") }
  });

  const first = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-1", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(db.results.length, 1);
  assert.equal(db.requests.get("request-1").status, "fulfilled");
  assert.deepEqual(db.results[0].result.requestIds, {
    TU: "REQ-Z", EX: "REQ-A", EQ: "REQ-M"
  });

  const expectedIdentity = providerResultIdFor({
    requestIds: { EQ: "REQ-M", TU: "REQ-Z", EX: "REQ-A" }
  });
  assert.equal(db.results[0].provider_result_id, expectedIdentity);
  assert.doesNotMatch(expectedIdentity, /REQ-[AZM]/);

  assert.equal(db.events.length, 2);
  assert.deepEqual(db.events.map((e) => e.name), ["analysis.completed", "decision.rendered"]);
  assert.equal(db.events[0].key, `crs-result:${first.crsResultId}:analysis.completed:v1`);
  assert.equal(db.events[1].key, `crs-result:${first.crsResultId}:decision.rendered:v1`);
  assert.equal(db.events[0].payload.crsResultId, first.crsResultId);
  assert.equal(db.events[0].payload.requestId, "request-1");
  assert.equal(db.events[0].payload.source, "crs");
  assert.ok(db.events[0].payload.scores);
  assert.ok(db.events[0].payload.bureaus);
  assert.ok(Array.isArray(db.events[0].payload.inquiries));
  assert.ok(first.outcomeTier);
  assert.equal(db.events[0].payload.outcomeTier, first.outcomeTier);
  assert.equal(db.events[1].payload.outcomeTier, first.outcomeTier);
  assert.equal(db.clients.get(CLIENT).outcome_tier, first.outcomeTier);
  assert.equal(db.results[0].outcome_tier, first.outcomeTier);
  assert.equal("softPullRequestId" in db.events[0].payload, false);

  const replay = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-1", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.crsResultId, first.crsResultId);
  assert.equal(replay.event.deduped, true);
  assert.equal(replay.events.decision.deduped, true);
  assert.equal(replay.outcomeTier, first.outcomeTier);
  assert.deepEqual(client.calls, ["TU", "EX", "EQ"], "replay ordered the bureaus again");
  assert.equal(db.results.length, 1);
  assert.equal(db.events.length, 2, "replay must not emit a second analysis/decision pair");
});

test("runCrsPull stores a partial bureau result when one RequestID exists", async () => {
  const db = fakeDb(request("request-partial"));
  const client = fakeClient({
    TU: { ok: true, requestId: "REQ-ONLY", report: report(700) },
    EX: { ok: false, error: "Experian unavailable" },
    EQ: { ok: false, error: "Equifax unavailable" }
  });
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-partial", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(out.ok, true);
  assert.equal(db.results.length, 1);
  assert.deepEqual(db.results[0].result.requestIds, { TU: "REQ-ONLY" });
  assert.deepEqual(out.bureauErrors, {
    EX: "Experian unavailable", EQ: "Equifax unavailable"
  });
});

test("runCrsPull refuses reports with zero provider RequestIDs", async () => {
  const db = fakeDb(request("request-no-id"));
  const client = fakeClient({
    TU: { ok: true, report: report(700) },
    EX: { ok: true, report: report(710) },
    EQ: { ok: true, report: report(720) }
  });
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-no-id", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "provider_result_id_required");
  assert.equal(db.results.length, 0);
  assert.equal(db.requests.get("request-no-id").status, "failed");
});

test("runCrsPull permits a later ledger request for the same client", async () => {
  const db = fakeDb(request("request-first"));
  const firstClient = fakeClient({
    TU: { ok: true, requestId: "FIRST-TU", report: report(700) }
  });
  await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-first", client: firstClient,
    bureaus: ["TU"]
  });

  db.requests.set("request-second", request("request-second"));
  const secondClient = fakeClient({
    TU: { ok: true, requestId: "SECOND-TU", report: report(740) }
  });
  const second = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-second", client: secondClient,
    bureaus: ["TU"]
  });
  assert.equal(second.ok, true);
  assert.equal(db.results.length, 2);
  assert.notEqual(db.results[0].id, db.results[1].id);
  assert.equal(db.requests.get("request-second").status, "fulfilled");
  assert.equal(db.events.length, 4);
  assert.deepEqual(
    db.events.map((e) => e.name),
    ["analysis.completed", "decision.rendered", "analysis.completed", "decision.rendered"]
  );
});

test("runCrsPull requires a ledger request before touching the client", async () => {
  const db = fakeDb(request("unused"));
  const client = fakeClient({});
  await assert.rejects(
    () => runCrsPull(db, { orgId: ORG, clientId: CLIENT, client }),
    /requestId is required/
  );
  assert.deepEqual(client.calls, []);
});
