import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyLendflowSignature,
  lendflowConfigFromEnv,
  normalizeStageToken,
  lookupStage,
  STAGE_TABLE,
  normalizeLendflowEvent,
  mapToCanonical,
  handleLendflowWebhook,
  buildSubmitPayload,
  validateSubmitPayload,
  submitApplication,
  SUBMIT_PATH,
  DEFAULT_API_BASE
} from "./lendflow.mjs";
import { CANONICAL_EVENTS } from "../events/canonical.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db (same shape as the other adapter tests) — routes by SQL keyword.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], idem: params[3], clientId: params[4], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_lendflow_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
const reset = () => { _resetOrgCache(); clearHandlers(); };

// Build a webhook body at a given Lendflow status.
const bodyAt = (status, extra = {}) =>
  JSON.stringify({
    event: "application.status_updated",
    data: { application_id: "lf_app_1", status, external_id: "client-1", ...extra }
  });

// ===========================================================================
// 1. Signature verification
// ===========================================================================
test("verifyLendflowSignature: accepts valid bare hex and sha256= prefixed", () => {
  const raw = bodyAt("funded");
  assert.equal(verifyLendflowSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyLendflowSignature(raw, "sha256=" + sign(raw), SECRET), true);
  assert.equal(verifyLendflowSignature(raw, `  ${sign(raw)}  `, SECRET), true, "trims whitespace");
});

test("verifyLendflowSignature: fails closed on tampering, missing header, missing secret", () => {
  const raw = bodyAt("funded");
  assert.equal(verifyLendflowSignature(raw, sign(raw + "x"), SECRET), false, "body tampered");
  assert.equal(verifyLendflowSignature(raw, sign(raw), "other_secret"), false, "wrong secret");
  assert.equal(verifyLendflowSignature(raw, "", SECRET), false, "no header");
  assert.equal(verifyLendflowSignature(raw, null, SECRET), false, "null header");
  assert.equal(verifyLendflowSignature(raw, sign(raw), null), false, "no secret => closed");
  assert.equal(verifyLendflowSignature(raw, sign(raw), ""), false, "empty secret => closed");
  assert.equal(verifyLendflowSignature(raw, "not-hex-at-all", SECRET), false, "malformed hex");
  assert.equal(verifyLendflowSignature(raw, "ab", SECRET), false, "length mismatch");
});

// ===========================================================================
// 2. Config from env — fail clean when unset
// ===========================================================================
test("lendflowConfigFromEnv: reports what is missing instead of throwing", () => {
  const bare = lendflowConfigFromEnv({});
  assert.equal(bare.ready, false);
  assert.equal(bare.baseUrl, DEFAULT_API_BASE);
  assert.deepEqual(bare.missing, ["LENDFLOW_API_KEY", "LENDFLOW_WEBHOOK_SECRET"]);

  const full = lendflowConfigFromEnv({
    LENDFLOW_API_BASE: "https://sandbox.lendflow.com/",
    LENDFLOW_API_KEY: "k",
    LENDFLOW_WEBHOOK_SECRET: "s"
  });
  assert.equal(full.ready, true);
  assert.equal(full.baseUrl, "https://sandbox.lendflow.com", "trailing slash trimmed");
});

// ===========================================================================
// 3. The stage table
// ===========================================================================
test("normalizeStageToken: case, spaces, hyphens all collapse to one token", () => {
  assert.equal(normalizeStageToken("Offer Accepted"), "offer_accepted");
  assert.equal(normalizeStageToken("OFFER-ACCEPTED"), "offer_accepted");
  assert.equal(normalizeStageToken("  offer_accepted  "), "offer_accepted");
  assert.equal(normalizeStageToken(null), "");
});

test("STAGE_TABLE: every emitted event is already in canonical.mjs", () => {
  for (const row of STAGE_TABLE) {
    if (row.event) {
      assert.ok(
        CANONICAL_EVENTS.includes(row.event),
        `${row.event} must exist in canonical.mjs before the table may emit it`
      );
    }
  }
});

test("STAGE_TABLE: every Alt-Fin stage key is one the pipeline seed defines", () => {
  // db/seed/002_pipelines.sql, pipeline funding_altfin (Spec § 5 pipeline #3).
  const SEEDED = ["app_created", "docs_stips", "underwriting", "offers", "offer_accepted", "funded", "closed"];
  for (const row of STAGE_TABLE) {
    assert.ok(SEEDED.includes(row.stage), `${row.stage} is not a seeded Alt-Fin stage`);
  }
});

test("STAGE_TABLE: no Lendflow token is claimed by two rows", () => {
  const seen = new Set();
  for (const row of STAGE_TABLE) {
    for (const token of row.lendflow) {
      assert.ok(!seen.has(token), `duplicate token across rows: ${token}`);
      seen.add(token);
    }
  }
});

// --- every mapping in the table, one assertion per row --------------------
test("stage mapping: App Created => round.started", () => {
  for (const t of ["application_started", "Application Created", "app_created", "new", "draft", "created"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "app_created", t);
    assert.equal(row.event, "round.started", t);
  }
});

test("stage mapping: Docs/Stips => stage move only, no event", () => {
  for (const t of ["documents_requested", "Stips Requested", "stips", "awaiting_documents", "incomplete"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "docs_stips", t);
    assert.equal(row.event, null, `${t} must NOT emit docs.received`);
  }
});

test("stage mapping: Underwriting => round.submitted", () => {
  for (const t of ["submitted", "Submitted To Lenders", "in_underwriting", "under_review", "processing"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "underwriting", t);
    assert.equal(row.event, "round.submitted", t);
  }
});

test("stage mapping: Offers => round.approved", () => {
  for (const t of ["offers", "Offers Received", "offer_presented", "approved", "conditionally_approved"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "offers", t);
    assert.equal(row.event, "round.approved", t);
  }
});

test("stage mapping: Offer Accepted => stage move only (approval already fired)", () => {
  for (const t of ["offer_accepted", "Accepted", "contract_signed", "closing"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "offer_accepted", t);
    assert.equal(row.event, null, `${t} must not re-fire round.approved`);
  }
});

test("stage mapping: Funded => round.funded", () => {
  for (const t of ["funded", "Deal Funded", "funding_complete", "disbursed", "closed_won"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "funded", t);
    assert.equal(row.event, "round.funded", t);
  }
});

test("stage mapping: Declined => closed, no event, round.declined proposed not emitted", () => {
  for (const t of ["declined", "Denied", "rejected", "no_offers", "not_qualified", "ineligible"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "closed", t);
    assert.equal(row.event, null, `${t} must not emit — round.declined is not canonical yet`);
    assert.equal(row.proposed, "round.declined", t);
  }
  assert.ok(!CANONICAL_EVENTS.includes("round.declined"), "guard: if this fails, wire the declined row up");
});

test("stage mapping: withdrawn / closed => stage move only, and NOT a decline", () => {
  for (const t of ["withdrawn", "Cancelled", "expired", "abandoned", "closed_lost"]) {
    const row = lookupStage(t);
    assert.equal(row.stage, "closed", t);
    assert.equal(row.event, null, t);
    assert.equal(row.proposed, undefined, `${t} is an exit, not a decline`);
  }
  for (const t of ["closed", "complete", "completed"]) {
    assert.equal(lookupStage(t).stage, "closed", t);
    assert.equal(lookupStage(t).event, null, t);
  }
});

test("lookupStage: unknown vocabulary resolves to null, never throws", () => {
  assert.equal(lookupStage("teleported_to_mars"), null);
  assert.equal(lookupStage(""), null);
  assert.equal(lookupStage(undefined), null);
});

// ===========================================================================
// 4. Normalize
// ===========================================================================
test("normalizeLendflowEvent: reads the nested data envelope", () => {
  const evt = normalizeLendflowEvent(JSON.parse(bodyAt("Offers Received", { offers: [{ amount: 45000 }] })));
  assert.equal(evt.applicationId, "lf_app_1");
  assert.equal(evt.stageRaw, "Offers Received");
  assert.equal(evt.stageToken, "offers_received");
  assert.equal(evt.approvedAmount, 45000);
  assert.equal(evt.offerCount, 1);
  assert.equal(evt.clientRef, "client-1");
});

test("normalizeLendflowEvent: reads a flat top-level shape too", () => {
  const evt = normalizeLendflowEvent({ id: "lf_2", status: "funded", funded_amount: "18500" });
  assert.equal(evt.applicationId, "lf_2");
  assert.equal(evt.stageToken, "funded");
  assert.equal(evt.fundedAmount, 18500, "numeric strings coerce");
});

test("normalizeLendflowEvent: missing everything degrades to nulls", () => {
  const evt = normalizeLendflowEvent({});
  assert.equal(evt.applicationId, null);
  assert.equal(evt.stageToken, "");
  assert.equal(evt.approvedAmount, null);
  assert.equal(evt.offerCount, 0);
});

test("mapToCanonical: pure table lookup, payload carries the Alt-Fin stage", () => {
  const [c] = mapToCanonical(normalizeLendflowEvent(JSON.parse(bodyAt("funded", { funded_amount: 18500 }))));
  assert.equal(c.name, "round.funded");
  assert.equal(c.stage, "funded");
  assert.equal(c.payload.stage, "funded");
  assert.equal(c.payload.lendflowStatus, "funded");
  assert.equal(c.payload.fundedAmount, 18500);
  assert.equal(c.payload.rail, "altfin");
  assert.equal(c.payload.source, "lendflow");
});

test("mapToCanonical: stage-only, declined and unknown all map to nothing", () => {
  assert.deepEqual(mapToCanonical(normalizeLendflowEvent({ id: "a", status: "stips" })), []);
  assert.deepEqual(mapToCanonical(normalizeLendflowEvent({ id: "a", status: "declined" })), []);
  assert.deepEqual(mapToCanonical(normalizeLendflowEvent({ id: "a", status: "who_knows" })), []);
  assert.deepEqual(mapToCanonical(null), []);
});

// ===========================================================================
// 5. Inbound webhook — end to end
// ===========================================================================
test("handleLendflowWebhook: bad signature => 401, nothing emitted", async () => {
  reset();
  const raw = bodyAt("funded");
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "nope", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.reason, "bad_signature");
  assert.equal(res.emitted.length, 0);
});

test("handleLendflowWebhook: unset secret fails closed even with a real-looking signature", async () => {
  reset();
  const raw = bodyAt("funded");
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: undefined });
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleLendflowWebhook: malformed JSON => 400, nothing emitted", async () => {
  reset();
  const raw = "{ not json at all";
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.reason, "invalid_json");
  assert.equal(res.emitted.length, 0);
});

test("handleLendflowWebhook: non-object JSON body => 400", async () => {
  reset();
  for (const raw of ["[1,2,3]", '"a string"', "null"]) {
    const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.status, 400, raw);
    assert.equal(res.emitted.length, 0, raw);
  }
});

test("handleLendflowWebhook: signed but empty/stageless payload => inert 200", async () => {
  reset();
  const raw = JSON.stringify({ event: "ping" });
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "no_stage");
  assert.equal(res.emitted.length, 0);
});

test("handleLendflowWebhook: known stage but no application id => 400 (no stable idem key)", async () => {
  reset();
  const raw = JSON.stringify({ data: { status: "funded" } });
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.reason, "missing_application_id");
});

test("handleLendflowWebhook: unknown stage => 200 inert, never dropped, nothing emitted", async () => {
  reset();
  const raw = bodyAt("some_new_lendflow_state");
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "unknown_stage:some_new_lendflow_state");
  assert.equal(res.emitted.length, 0);
});

test("handleLendflowWebhook: declined => 200, no emit, reason names the proposed event", async () => {
  reset();
  let fired = 0;
  for (const n of CANONICAL_EVENTS) on(n, () => (fired += 1));
  const raw = bodyAt("declined");
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.stage, "closed");
  assert.equal(res.reason, "unmapped_pending_canonical:round.declined");
  assert.equal(res.emitted.length, 0);
  assert.equal(fired, 0, "a decline must not fire ANY canonical handler today");
});

test("handleLendflowWebhook: docs/stips => 200 stage_only, no event", async () => {
  reset();
  const raw = bodyAt("stips_requested");
  const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.status, 200);
  assert.equal(res.reason, "stage_only:docs_stips");
  assert.equal(res.emitted.length, 0);
});

// Walk the whole ladder through the real entrypoint.
test("handleLendflowWebhook: each emitting stage produces exactly its canonical event", async () => {
  const cases = [
    ["application_started", "round.started", "app_created"],
    ["submitted_to_lenders", "round.submitted", "underwriting"],
    ["offers_received", "round.approved", "offers"],
    ["funded", "round.funded", "funded"]
  ];
  for (const [status, expectedEvent, expectedStage] of cases) {
    reset();
    const seen = [];
    on(expectedEvent, (e) => seen.push(e.name));
    const raw = bodyAt(status);
    const res = await handleLendflowWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.ok, true, status);
    assert.equal(res.stage, expectedStage, status);
    assert.deepEqual(res.emitted.map((e) => e.name), [expectedEvent], status);
    assert.deepEqual(seen, [expectedEvent], `${status} must dispatch to handlers`);
  }
});

test("handleLendflowWebhook: idempotency key is application + stage + event; clientId is carried", async () => {
  reset();
  const store = [];
  const raw = bodyAt("funded");
  await handleLendflowWebhook({ db: fakeDb({ store }), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(store.length, 1);
  assert.equal(store[0].idem, "lendflow:lf_app_1:funded:round.funded");
  assert.equal(store[0].clientId, "client-1");
});

// ===========================================================================
// 6. Duplicate delivery
// ===========================================================================
test("duplicate delivery: identical redelivery is deduped and dispatches nothing", async () => {
  reset();
  let fired = 0;
  on("round.funded", () => (fired += 1));
  const raw = bodyAt("funded");
  const db = fakeDb({ dedup: true }); // the events row already exists
  const res = await handleLendflowWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on a deduped redelivery");
});

test("duplicate delivery: a retry with a fresh delivery id still collapses to one key", async () => {
  reset();
  const store = [];
  const db = fakeDb({ store });
  // Same application + same stage, different envelope id / timestamp — a Lendflow retry.
  const first = JSON.stringify({
    id: "delivery_aaa",
    sent_at: "2026-07-27T10:00:00Z",
    data: { application_id: "lf_app_9", status: "funded", external_id: "client-9" }
  });
  const second = JSON.stringify({
    id: "delivery_bbb",
    sent_at: "2026-07-27T10:05:00Z",
    data: { application_id: "lf_app_9", status: "Funded", external_id: "client-9" }
  });
  await handleLendflowWebhook({ db, rawBody: first, signatureHeader: sign(first), secret: SECRET });
  await handleLendflowWebhook({ db, rawBody: second, signatureHeader: sign(second), secret: SECRET });
  assert.equal(store.length, 2, "fake db does not enforce the constraint; keys are what matter");
  assert.equal(store[0].idem, store[1].idem, "retry must produce the SAME idempotency key");
  assert.equal(store[0].idem, "lendflow:lf_app_9:funded:round.funded");
});

test("duplicate delivery: distinct stages on one application keep distinct keys", async () => {
  reset();
  const store = [];
  const db = fakeDb({ store });
  for (const s of ["submitted_to_lenders", "offers_received", "funded"]) {
    const raw = bodyAt(s);
    await handleLendflowWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  }
  const keys = store.map((r) => r.idem);
  assert.equal(new Set(keys).size, 3, "each milestone gets its own key");
  assert.deepEqual(store.map((r) => r.name), ["round.submitted", "round.approved", "round.funded"]);
});

// ===========================================================================
// 7. Outbound — Submit Application
// ===========================================================================
const CLIENT = {
  id: "client-1",
  first_name: "Maria",
  last_name: "Delgado",
  email: "  MARIA@EXAMPLE.com ",
  phone: "+15550001111",
  custom_fields: { cf_svy_funding_target_amount: 50000, cf_svy_annual_revenue: 880000, cf_biz_entity_type: "LLC" }
};
const ROUND = { id: "round-1", round_number: 1, submitted_amount: 75000 };
const BUSINESS = { name: "Delgado Logistics LLC", age_months: 42, entity_data: { ein: "12-3456789", state: "FL" } };

test("buildSubmitPayload: builds from client + round + business, round amount wins", () => {
  const p = buildSubmitPayload({ client: CLIENT, round: ROUND, business: BUSINESS });
  assert.equal(p.requested_amount, 75000, "round.submitted_amount beats the survey target");
  assert.equal(p.owner.email, "maria@example.com", "trimmed + lowercased");
  assert.equal(p.owner.first_name, "Maria");
  assert.equal(p.business.name, "Delgado Logistics LLC");
  assert.equal(p.business.annual_revenue, 880000);
  assert.equal(p.business.time_in_business_months, 42);
  assert.equal(p.business.ein, "12-3456789");
  assert.equal(p.business.entity_type, "LLC", "falls back to the cf_* field");
  assert.equal(p.external_id, "client-1", "echoed back on every webhook");
  assert.deepEqual(p.metadata, { client_id: "client-1", round_id: "round-1", round_number: 1 });
});

test("buildSubmitPayload: falls back to the survey target when the round has no amount", () => {
  const p = buildSubmitPayload({ client: CLIENT, round: {}, business: BUSINESS });
  assert.equal(p.requested_amount, 50000);
});

test("buildSubmitPayload: empty input degrades to nulls, never throws", () => {
  const p = buildSubmitPayload();
  assert.equal(p.requested_amount, null);
  assert.equal(p.owner.email, null);
  assert.equal(p.business.name, null);
});

test("validateSubmitPayload: names every missing required field", () => {
  assert.deepEqual(validateSubmitPayload(buildSubmitPayload({ client: CLIENT, round: ROUND, business: BUSINESS })), {
    valid: true,
    missing: []
  });
  const bare = validateSubmitPayload(buildSubmitPayload());
  assert.equal(bare.valid, false);
  assert.deepEqual(bare.missing, [
    "owner.email",
    "owner.first_name",
    "owner.last_name",
    "business.name",
    "requested_amount"
  ]);
});

test("submitApplication: unset env fails clean, names the missing var, sends nothing", async () => {
  let called = false;
  const res = await submitApplication({
    client: CLIENT,
    round: ROUND,
    business: BUSINESS,
    env: {},
    fetchImpl: () => { called = true; }
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not_configured:LENDFLOW_API_KEY,LENDFLOW_WEBHOOK_SECRET");
  assert.equal(called, false, "must not call out without credentials");
  assert.ok(res.payload, "payload still returned so callers can log/inspect it");
});

test("submitApplication: incomplete client fails before spending a call", async () => {
  let called = false;
  const res = await submitApplication({
    client: { id: "c" },
    round: {},
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_KEY: "k", LENDFLOW_WEBHOOK_SECRET: "s" },
    fetchImpl: () => { called = true; }
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /^missing_required:/);
  assert.equal(called, false);
});

test("submitApplication: posts to the submit endpoint with bearer auth and the JSON payload", async () => {
  const seen = {};
  const res = await submitApplication({
    client: CLIENT,
    round: ROUND,
    business: BUSINESS,
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_BASE: "https://sandbox.lendflow.com", LENDFLOW_API_KEY: "k_123", LENDFLOW_WEBHOOK_SECRET: "s" },
    /* Responses are read with text() now, not json(): the submit goes through
       src/lib/outbound-fetch.mjs, which reads the body once as text and parses
       it defensively so an HTML error page under a JSON content-type cannot
       throw away the status code. */
    fetchImpl: async (url, opts) => {
      seen.url = url;
      seen.opts = opts;
      return { ok: true, status: 201, text: async () => JSON.stringify({ data: { application_id: "lf_app_new" } }) };
    }
  });
  assert.equal(seen.url, `https://sandbox.lendflow.com${SUBMIT_PATH}`);
  assert.equal(seen.opts.method, "POST");
  assert.equal(seen.opts.headers.authorization, "Bearer k_123");
  // Header names are case-insensitive; the shared helper sets the canonical form.
  assert.equal(seen.opts.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(seen.opts.body).external_id, "client-1");
  assert.equal(res.ok, true);
  assert.equal(res.status, 201);
  assert.equal(res.applicationId, "lf_app_new");
});

test("submitApplication: non-2xx surfaces the provider error, never throws", async () => {
  const res = await submitApplication({
    client: CLIENT,
    round: ROUND,
    business: BUSINESS,
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_KEY: "k", LENDFLOW_WEBHOOK_SECRET: "s" },
    fetchImpl: async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ message: "ein invalid" }) })
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
  assert.equal(res.reason, "http_422");
  assert.equal(res.providerError, "ein invalid");
  assert.equal(res.applicationId, null);
});

test("submitApplication: network failure and unparseable body both degrade cleanly", async () => {
  const netErr = await submitApplication({
    client: CLIENT, round: ROUND, business: BUSINESS,
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_KEY: "k", LENDFLOW_WEBHOOK_SECRET: "s" },
    fetchImpl: async () => { throw new Error("ECONNRESET"); }
  });
  assert.equal(netErr.ok, false);
  assert.equal(netErr.reason, "network_error:ECONNRESET");

  const badJson = await submitApplication({
    client: CLIENT, round: ROUND, business: BUSINESS,
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_KEY: "k", LENDFLOW_WEBHOOK_SECRET: "s" },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not json at all" })
  });
  assert.equal(badJson.ok, true, "2xx with an unreadable body is still a success");
  assert.equal(badJson.applicationId, null);
});

test("submitApplication: outbound never emits — Alt-Fin cards move only on webhooks (Spec § 5)", async () => {
  reset();
  let fired = 0;
  for (const n of CANONICAL_EVENTS) on(n, () => (fired += 1));
  await submitApplication({
    client: CLIENT,
    round: ROUND,
    business: BUSINESS,
    env: { ADAPTERS_DRY_RUN: "0", LENDFLOW_API_KEY: "k", LENDFLOW_WEBHOOK_SECRET: "s" },
    fetchImpl: async () => ({ status: 201, json: async () => ({ data: { id: "lf_1" } }) })
  });
  assert.equal(fired, 0);
});
