/* THE FULFILLMENT READ LAYER, AT THE ENDPOINT SEAM.
 *
 * COMPLIANCE REVIEW REQUIRED — two of these tests are the compliance gates
 * themselves. Gate A decides whether a screen may tell staff to pull someone's
 * credit; Gate B decides what a credit-repair-only client is shown. Both are
 * asserted here against the REAL handlers, not against the decision module.
 *
 * WHAT THIS FILE IS FOR. src/fulfillment/next-action.test.mjs already proves the
 * decision itself, in isolation, and proves both gates survive their own layers
 * being deleted. This file proves the other half: that the two endpoints GATHER
 * the right signals, that the new fields reach the response, that the six
 * rollups tell the truth about what has no source, and — the one that matters
 * most — that when any of it fails the response is EXACTLY what it was before
 * this work existed.
 *
 * WHY IT LIVES HERE AND WHY IT IS NOT A .pg. TEST. package.json's test glob is
 * "src/**" and "scripts/**", so a test placed under api/ is silently never
 * collected (CLAUDE.md §12). A `.pg.test.mjs` would be collected but SKIPPED
 * whenever DATABASE_URL is unset, which is the default — and these are the
 * assertions that must run on every push. src/db.mjs exports `db` as a plain
 * object whose `query` is a property, so swapping that property lets the REAL
 * handler, the REAL session gate and the REAL derivation all run against
 * scripted rows. Restored in after(). Same technique as
 * src/http/dashboard-role-gate.test.mjs.
 *
 * WHAT IT THEREFORE CANNOT PROVE. The SQL is scripted, not executed, so the
 * rollup arithmetic and the is_demo filter inside REAL_CRS_SQL are asserted as
 * source facts here and need a live Postgres to be measured.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { db } from "../db.mjs";
import clientsHandler from "../../api/dashboard/clients.mjs";
import clientHandler from "../../api/dashboard/client.mjs";

const TOKEN = "test-session-token";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const ORG_ID = "org-1";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const req = (query = {}) => ({
  method: "GET",
  headers: { authorization: `Bearer ${TOKEN}` },
  query
});

/* The client list only works out chips and tiles when the caller ASKS. Every
   list test below passes this, because every list test below is about the
   thing it turns on. The tests that leave it off are the ones proving that
   every other caller of this endpoint is untouched. */
const LENS = { fulfillment: "1" };

/* ── the scripted database ────────────────────────────────────────────────────
   `plan` is rewritten by each test. Every key is a set of rows for one read;
   `null` means "that read throws", which is how a table that has not been
   migrated yet behaves. */
let plan;

/* Every statement the handler ran, in order. The count is the whole point of
   the opt-in tests below: this endpoint made 3 reads before this work, and the
   fulfillment layer adds 11 more. Those 11 must only happen when asked. */
let queries;

function freshPlan() {
  return {
    listRows: [],
    detailRow: null,
    transactions: [],
    crsResults: [],           // the UNFILTERED crs_results read the list already does
    messages: [],
    tasks: [],
    fundingRounds: [],
    invoices: [],
    businesses: [],
    demoModeEnabled: false,
    inquiryCases: [],
    consentRows: [],          // rows shaped like the client_consents read
    realCrsCounts: [],        // [{ client_id, n }] — is_demo ALREADY excluded
    documents: [],
    disputeResponses: [],
    disputeCases: [],
    cards: [],
    openTasks: [],
    rollupRow: {
      total_clients: 0, needs_pull: 0, action_needed: 0,
      total_prequal: null, total_prequal_clients: 0
    }
  };
}

function rowsOrThrow(value, what) {
  if (value === null) throw new Error(`relation "${what}" does not exist`);
  return { rows: value };
}

async function stubQuery(sql, params) {
  const text = String(sql);
  if (Array.isArray(queries)) queries.push(text);

  if (/FROM live JOIN staff/.test(text)) {
    return { rows: [{
      session_id: "session-1",
      expires_at: new Date(Date.now() + 3600_000),
      staff_id: "staff-1", org_id: ORG_ID,
      role: "closer", email: "staff@example.com", name: "Test Staff",
      status: "active", active_flag: null
    }] };
  }

  // ── the fulfillment read layer ───────────────────────────────────────────
  if (/AS total_clients/.test(text)) return rowsOrThrow(plan.rollupRow === null ? null : [plan.rollupRow], "clients");
  if (/FROM client_consents/.test(text)) return rowsOrThrow(plan.consentRows, "client_consents");
  if (/FROM crs_results/.test(text) && /is_demo/.test(text)) {
    return rowsOrThrow(plan.realCrsCounts, "crs_results");
  }
  if (/FROM inquiry_removal_cases/.test(text)) return rowsOrThrow(plan.inquiryCases, "inquiry_removal_cases");
  if (/FROM documents/.test(text)) return rowsOrThrow(plan.documents, "documents");
  if (/FROM dispute_responses/.test(text)) return rowsOrThrow(plan.disputeResponses, "dispute_responses");
  if (/FROM dispute_cases/.test(text)) return rowsOrThrow(plan.disputeCases, "dispute_cases");
  if (/FROM cards ca/.test(text)) return rowsOrThrow(plan.cards, "cards");
  if (/FROM tasks\b/.test(text) && /done = false/.test(text)) return rowsOrThrow(plan.openTasks, "tasks");
  if (/FROM funding_rounds/.test(text) && /client_id = ANY/.test(text)) {
    return rowsOrThrow(plan.fundingRounds, "funding_rounds");
  }
  if (/FROM v_invoice_balance/.test(text) && /client_id = ANY/.test(text)) {
    return rowsOrThrow(plan.invoices, "v_invoice_balance");
  }

  // ── everything the two endpoints already read ────────────────────────────
  if (/demo_mode_enabled/.test(text)) return { rows: [{ demo_mode_enabled: plan.demoModeEnabled }] };
  if (/SELECT 1 FROM clients WHERE id/.test(text)) {
    return { rows: plan.detailRow ? [{ "?column?": 1 }] : [] };
  }
  if (/FROM clients c/.test(text)) return { rows: plan.listRows };
  if (/FROM clients WHERE id/.test(text)) return { rows: plan.detailRow ? [plan.detailRow] : [] };
  if (/FROM transactions/.test(text)) return { rows: plan.transactions };
  if (/FROM crs_results/.test(text)) return { rows: plan.crsResults };
  if (/FROM messages/.test(text)) return { rows: plan.messages };
  if (/FROM tasks/.test(text)) return { rows: plan.tasks };
  if (/FROM funding_rounds/.test(text)) return { rows: plan.fundingRounds };
  if (/FROM v_invoice_balance/.test(text)) return { rows: plan.invoices };
  if (/FROM businesses/.test(text)) return { rows: plan.businesses };

  return { rows: [] };
}

/* A client_consents row as the batched read returns it. */
const consentRow = (over = {}) => ({
  client_id: CLIENT_ID,
  is_valid: true,
  revoked_at: null,
  granted_at: new Date("2026-01-01T00:00:00Z"),
  ...over
});

/* One row of the list SQL, including the two raw columns the derivation reads.
   `custom_fields_raw` and `tags_raw` never appear in the response. */
const listRow = (over = {}) => ({
  id: CLIENT_ID,
  first_name: "Dana", last_name: "Reyes", email: "dana.reyes@example.com",
  outcome_tier: "FULL_FUNDING", funded: false, funded_amount: null,
  is_demo: false,
  custom_fields_raw: { crs_paid: true },
  tags_raw: [],
  crs_paid: true, deposit_paid: null, sale_closed: null,
  total_funding_estimate: "50000",
  created_at: new Date("2026-01-01T00:00:00Z"),
  tx_count: "0", tx_latest_product: null, tx_latest_amount: null, tx_latest_status: null,
  crs_count: "1", task_count: "0",
  last_msg_channel: null, last_msg_direction: null, last_msg_at: null,
  ...over
});

const detailRow = (over = {}) => ({
  id: CLIENT_ID,
  first_name: "Dana", last_name: "Reyes", email: "dana.reyes@example.com",
  phone: "+15550001111",
  outcome_tier: "FULL_FUNDING", funded: false, funded_amount: null, days_to_fund: null,
  channel_source: "paid", tags: [], pipeline_ids: [],
  dnd_sms: false, dnd_email: false, dnd_voice: false, consent_sms: true,
  custom_fields: { crs_paid: true },
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-03T00:00:00Z"),
  ...over
});

/* The keys the client list answered with before any of this existed. */
const LIST_KEYS_BEFORE = [
  "id", "first_name", "last_name", "email", "outcome_tier", "funded",
  "funded_amount", "is_demo", "custom_fields", "transactions", "crs_count",
  "task_count", "last_message", "created_at"
];

/* The keys the client detail answered with before any of this existed. */
const DETAIL_KEYS_BEFORE = [
  "ok", "client", "transactions", "crs_results", "messages", "tasks",
  "funding_rounds", "invoices", "inquiry_removal_case", "tier_reasoning",
  "tri_merge", "utilisation", "income_estimates", "business_credit",
  "latest_booking", "open_blockers"
];

let realQuery;

describe("dashboard reads: the fulfillment next action", () => {
  before(() => { realQuery = db.query; db.query = stubQuery; });
  after(() => { db.query = realQuery; });
  beforeEach(() => { plan = freshPlan(); queries = []; });

  /* ── the new fields arrive ─────────────────────────────────────────────── */

  test("client detail carries next_action, active_blockers and funding_round", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [];                       // no real credit pull yet
    plan.fundingRounds = [{
      client_id: CLIENT_ID, id: "r1", round_number: 2, status: "submitted",
      hold_reason: null, approved_amount: null
    }];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.ok("next_action" in r.body, "next_action never reached the response");
    assert.ok(Array.isArray(r.body.active_blockers), "active_blockers must always be an array");
    assert.equal(r.body.next_action.key, "pull_crs",
      "paid, consented, no real credit row — the chip should be Pull CRS. Got: " +
      JSON.stringify(r.body.next_action));
    assert.equal(r.body.next_action.label, "Pull CRS");
    assert.ok(r.body.next_action.why && r.body.next_action.why.length > 0,
      "a chip with no plain-English reason is not usable by a closer");
    assert.equal(r.body.funding_round.number, 2);
    assert.equal(r.body.funding_round.approved_amount, null,
      "a round nobody has approved must stay null, never 0");
    assert.equal(r.body.next_action_degraded, false);
  });

  test("client detail keeps every field it answered with before", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [consentRow()];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200);
    for (const key of DETAIL_KEYS_BEFORE) {
      assert.ok(key in r.body, `the client control panel lost "${key}"`);
    }
  });

  test("the client list carries a chip per client and keeps every old field", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [];

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.count, 1);
    const c = r.body.clients[0];
    for (const key of LIST_KEYS_BEFORE) {
      assert.ok(key in c, `the client list lost "${key}"`);
    }
    assert.equal(c.next_action.key, "pull_crs", JSON.stringify(c.next_action));
    assert.ok(Array.isArray(c.active_blockers));
    assert.equal(c.next_action_degraded, false);
    assert.ok(!("custom_fields_raw" in c), "the raw blob leaked into the response");
    assert.ok(!("tags_raw" in c), "the raw tag array leaked into the response");
  });

  /* ── the derivation is OPT-IN ──────────────────────────────────────────────
     This endpoint is not only the Fulfillment lens. It is also the client
     picker on the Client Control Panel, and anything else that wants a list of
     clients. The derivation costs eleven extra reads, so it happens only when
     the caller asks with ?fulfillment=1. Everyone else must get back exactly
     what they got before this work existed — same reads, same reply. */

  test("nobody asked: the list makes the same three reads it always made", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];

    const r = res();
    await clientsHandler(req(), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(queries.length, 3,
      "the client picker paid for reads it does not use. Expected the 3 statements this " +
      "endpoint has always made (the session, demo mode, the list itself) and got " +
      queries.length + ":\n" + queries.map((q) => q.trim().slice(0, 70)).join("\n"));
    assert.ok(!queries.some((q) => /FROM client_consents/.test(q)),
      "the consent read ran for a caller that never asked for a next action");
    assert.ok(!queries.some((q) => /AS total_clients/.test(q)),
      "the tile count ran for a caller that never asked for tiles");
  });

  test("somebody asked: the eleven extra reads happen, and only then", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(queries.length, 14,
      "expected the 3 original reads plus the 11 the fulfillment layer adds, got " +
      queries.length);
    assert.ok(queries.some((q) => /FROM client_consents/.test(q)), "the consent read never ran");
    assert.ok(queries.some((q) => /AS total_clients/.test(q)), "the tile count never ran");
  });

  test("nobody asked: the reply carries not one key more than it did before", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];
    plan.rollupRow = {
      total_clients: 47, needs_pull: 12, action_needed: 26,
      total_prequal: "50000", total_prequal_clients: 1
    };

    const r = res();
    await clientsHandler(req(), r);

    assert.deepEqual(Object.keys(r.body), ["ok", "count", "clients"],
      "the reply grew a key for a caller that asked for nothing new");
    const c = r.body.clients[0];
    assert.deepEqual(Object.keys(c), LIST_KEYS_BEFORE,
      "a client row grew or lost a key for a caller that asked for nothing new");
    for (const key of ["next_action", "active_blockers", "funding_round", "next_action_degraded"]) {
      assert.ok(!(key in c), `"${key}" was published to a caller that never asked for it`);
    }
  });

  test("a value that is not a yes is a no — the flag never turns itself on", async () => {
    for (const value of ["0", "false", "no", "", "maybe", undefined]) {
      plan = freshPlan();
      queries = [];
      plan.listRows = [listRow()];
      plan.consentRows = [consentRow()];

      const r = res();
      await clientsHandler(req({ fulfillment: value }), r);

      assert.equal(queries.length, 3, `fulfillment=${JSON.stringify(value)} switched the work on`);
      assert.ok(!("next_action" in r.body.clients[0]),
        `fulfillment=${JSON.stringify(value)} published a next action`);
    }
  });

  /* ── a failure must leave today's screen alone ─────────────────────────── */

  test("one bad row part-way through the page attaches nothing to the good rows", async () => {
    /* The comment on this block promises ALL OR NOTHING. Attaching as it goes
       breaks that promise on a page: the clients before the bad row would keep
       their chips and the clients after it would have none, and the screen
       cannot tell "no action" from "we never got there". The second row throws,
       so the FIRST row is the one that proves it. */
    const good = listRow({ id: "aaaaaaaa-1111-2222-3333-444444444444" });
    const bad = listRow();
    Object.defineProperty(bad, "tags_raw", {
      enumerable: true,
      get() { throw new Error("derivation fault on the second row"); }
    });
    plan.listRows = [good, bad];
    plan.consentRows = [consentRow()];

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.equal(r.code, 200, "a broken row took the whole list down: " + JSON.stringify(r.body));
    assert.equal(r.body.count, 2, "a broken row cost the list a client");
    for (const c of r.body.clients) {
      for (const key of LIST_KEYS_BEFORE) {
        assert.ok(key in c, `a broken row cost the list "${key}"`);
      }
    }
    assert.ok(!("next_action" in r.body.clients[0]),
      "the row BEFORE the failure kept a chip, so the list came back half answered");
    assert.ok(!("next_action" in r.body.clients[1]),
      "the row that failed still published a chip");
    assert.ok(!("rollups" in r.body),
      "the tiles were published off a page whose chips could not be worked out");
  });

  test("a derivation that throws leaves the client detail response untouched", async () => {
    /* Fault injection at the exact seam: the derivation block reads
       client.tags, and nothing else in the handler does. One throw, then the
       getter behaves, so the later redact() pass is not what is being tested. */
    let reads = 0;
    plan.detailRow = detailRow();
    Object.defineProperty(plan.detailRow, "tags", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads === 1) throw new Error("derivation fault");
        return [];
      }
    });
    plan.consentRows = [consentRow()];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(reads > 0, true, "the fault was never reached — this test proves nothing");
    assert.equal(r.code, 200, "a broken derivation took the whole screen down: " + JSON.stringify(r.body));
    for (const key of DETAIL_KEYS_BEFORE) {
      assert.ok(key in r.body, `a broken derivation cost the screen "${key}"`);
    }
    assert.ok(!("next_action" in r.body), "a failed derivation still published a next action");
    assert.ok(!("active_blockers" in r.body), "a failed derivation still published blockers");
    assert.ok(!("funding_round" in r.body), "a failed derivation still published a funding round");
  });

  test("a derivation that throws leaves the client list response untouched", async () => {
    const row = listRow();
    Object.defineProperty(row, "tags_raw", {
      enumerable: true,
      get() { throw new Error("derivation fault"); }
    });
    plan.listRows = [row];
    plan.consentRows = [consentRow()];

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.equal(r.code, 200, "a broken derivation took the whole list down: " + JSON.stringify(r.body));
    assert.equal(r.body.count, 1);
    const c = r.body.clients[0];
    for (const key of LIST_KEYS_BEFORE) {
      assert.ok(key in c, `a broken derivation cost the list "${key}"`);
    }
    assert.ok(!("next_action" in c), "a failed derivation still published a next action");
    assert.ok(!("rollups" in r.body), "a failed derivation still published the tiles");
  });

  test("tables that were never migrated cost the chip, never the screen", async () => {
    // Every read the fulfillment layer added, refusing at once.
    plan.detailRow = detailRow();
    plan.consentRows = null;
    plan.realCrsCounts = null;
    plan.documents = null;
    plan.disputeResponses = null;
    plan.disputeCases = null;
    plan.cards = null;

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    for (const key of DETAIL_KEYS_BEFORE) {
      assert.ok(key in r.body, `a missing table cost the screen "${key}"`);
    }
    assert.equal(r.body.next_action, null,
      "a client whose consent could not be read was still handed an instruction");
    assert.equal(r.body.next_action_degraded, true,
      "the screen was not told the answer is partial");
  });

  /* ── GATE A: no consent on file, never "Pull CRS" ──────────────────────── */

  test("GATE A: a client with no recorded consent is never told to pull credit", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [];                    // nothing on file at all
    plan.realCrsCounts = [];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200);
    assert.notEqual(r.body.next_action && r.body.next_action.key, "pull_crs",
      "a client with no written permission was told to pull their credit");
    assert.equal(r.body.next_action.key, "get_consent",
      "the truthful answer is Get Consent. Got: " + JSON.stringify(r.body.next_action));
    assert.ok(
      r.body.active_blockers.some((b) => b.key === "consent_missing" && b.severity === "high"),
      "missing written permission was not raised as a blocker: " +
      JSON.stringify(r.body.active_blockers)
    );
  });

  test("GATE A on the list: revoked permission reads as revoked, not as 'none'", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow({
      is_valid: false,
      revoked_at: new Date("2026-02-04T00:00:00Z")
    })];
    plan.realCrsCounts = [];

    const r = res();
    await clientsHandler(req(LENS), r);

    const c = r.body.clients[0];
    assert.equal(c.next_action.key, "get_consent", JSON.stringify(c.next_action));
    assert.match(c.next_action.why, /took their written permission back/,
      "a revoked consent was described as never given: " + c.next_action.why);
  });

  /* ── GATE A ON THE ARRAY THIS ENDPOINT EMITS ────────────────────────────────

     THE DEFECT THESE CLOSE. The relabel used to run only inside the
     derivation, so only `active_blockers` came out safe. This endpoint ALSO
     returns the raw `open_blockers` array, and the client control panel paints
     THAT array in two more places — the pre-existing Blockers panel
     (public/app/client-control-panel.html:1335) and the new control block's
     fallback when no derivation arrives (:1174). A real client with no
     recorded permission had the top panel reading "Funding intake — pull CRS"
     while the block below it read "waiting on written permission".

     So the response itself must never carry the raw words. These assert the
     RESPONSE, not the derivation — a fix that only helps active_blockers fails
     here. The pre-existing panel painting these rows is proved in
     src/http/client-panel-screen.test.mjs. */

  // The row openBlockers() builds from the one workflow that raises a
  // pull-credit task (src/workflows/s-06-post-call-funding-purchased.mjs:25).
  const pullTaskRow = {
    id: "t9",
    title: "Funding intake — pull CRS",
    body: null, due_at: null, done: false,
    assignee_role: "closer", assignee_staff_id: null,
    source_workflow: "s-06-post-call-funding-purchased",
    created_at: new Date("2026-02-01T00:00:00Z")
  };
  const emitted = (body) => (body.open_blockers || []).find((b) => b.id === "t9");

  test("GATE A: the response's own open_blockers array never says pull credit without permission", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [];                    // checked, nothing on file
    plan.realCrsCounts = [];
    plan.tasks = [pullTaskRow];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    const b = emitted(r.body);
    assert.ok(b, "the blocker was dropped from the response — hiding it is a lie by omission: " +
      JSON.stringify(r.body.open_blockers));
    assert.equal(b.label, "Funding intake — waiting on written permission");
    assert.equal(b.recorded_label, "Funding intake — pull CRS",
      "the words on the record must survive, labelled as the record and never as an instruction");
    // RELABEL, NOT HIDE — everything a closer acts on is still there.
    assert.equal(b.kind, "task");
    assert.equal(b.detail, "owned by closer");
    assert.equal(b.source, "s-06-post-call-funding-purchased");

    for (const row of r.body.open_blockers) {
      assert.doesNotMatch(String(row.label), /pull/i,
        "the pre-existing Blockers panel is fed this array verbatim: " + JSON.stringify(row));
    }
  });

  test("GATE A: the two arrays in one response say the same thing", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [];
    plan.realCrsCounts = [];
    plan.tasks = [pullTaskRow];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    const raw = emitted(r.body);
    const derived = r.body.active_blockers.find((x) => x.id === "t9");
    assert.ok(raw && derived);
    assert.equal(raw.label, derived.label,
      "two panels on one screen were shown two different labels for the same blocker");
    assert.equal(raw.recorded_label, derived.recorded_label);
  });

  test("GATE A: a consent read that FAILED says we could not check, on both arrays", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = null;                  // the read throws — we never found out
    plan.realCrsCounts = [];
    plan.tasks = [pullTaskRow];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    const b = emitted(r.body);
    assert.equal(b.label, "Funding intake — we could not check written permission");
    assert.doesNotMatch(b.label, /pull/i);
    assert.doesNotMatch(b.label, /waiting on/i,
      "we told staff they are waiting on permission, and we never managed to look");
    assert.equal(b.recorded_label, "Funding intake — pull CRS");

    // And something has to SAY we could not check, not only imply it.
    const said = r.body.active_blockers.find((x) => x.key === "consent_unknown");
    assert.ok(said, "nothing on screen says the permission record could not be read: " +
      JSON.stringify(r.body.active_blockers));
    assert.equal(said.severity, "high");
    assert.match(said.detail, /could not be read/i);
    assert.ok(!r.body.active_blockers.some((x) => x.key === "consent_missing"),
      "we did not look, so we may not report that there is nothing on file");
    assert.equal(r.body.next_action_degraded, true);
  });

  test("GATE A: the derivation failing does not put the raw words back", async () => {
    /* The fulfillment block is deliberately optional — when it cannot run, the
       three derived keys are absent and the screen falls back to today's
       display. Today's display is fed by open_blockers, so the fallback path
       is exactly where the leak used to live. */
    plan.detailRow = detailRow();
    plan.consentRows = null;
    plan.realCrsCounts = null;                // more reads that throw
    plan.documents = null;
    plan.tasks = [pullTaskRow];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    for (const row of r.body.open_blockers) {
      assert.doesNotMatch(String(row.label), /pull/i,
        "the fallback display got the raw instruction: " + JSON.stringify(row));
    }
  });

  test("live written permission: the real task title reaches the screen byte for byte", async () => {
    plan.detailRow = detailRow();
    plan.consentRows = [consentRow()];        // valid, unrevoked, unexpired
    plan.realCrsCounts = [];
    plan.tasks = [pullTaskRow];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    const b = emitted(r.body);
    assert.equal(b.label, "Funding intake — pull CRS",
      "with written permission on file there is nothing to keep from anyone");
    assert.equal(b.recorded_label, undefined, "nothing was rewritten, so nothing was recorded");
    assert.equal(b.detail, "owned by closer");
    const derived = r.body.active_blockers.find((x) => x.id === "t9");
    assert.equal(derived.label, "Funding intake — pull CRS");
  });

  /* ── GATE B: repair-only never sees a funding chip ─────────────────────── */

  test("GATE B: a repair-only client is never shown a funding chip", async () => {
    plan.detailRow = detailRow({
      outcome_tier: "REPAIR_ONLY",
      custom_fields: { crs_paid: true, crs_status: "Complete", ready_for_next_round: true }
    });
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [{ client_id: CLIENT_ID, n: 1 }];
    plan.tasks = [{
      id: "t1", title: "Pre-funding review", done: false,
      source_workflow: "c-05-pre-funding-review", assignee_role: "funding_advisor"
    }];
    plan.cards = [{ client_id: CLIENT_ID, pipeline_key: "funding_card_stacking", stage_key: "approved" }];

    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);

    const funding = ["review_funding_file", "prepare_next_round", "apply_for_funding", "ready_to_fund"];
    const key = r.body.next_action && r.body.next_action.key;
    assert.ok(!funding.includes(key),
      "a credit-repair-only client was shown a funding action: " + JSON.stringify(r.body.next_action));
    assert.equal(r.body.next_action, null,
      "every funding condition is true and the client bought repair only — the honest answer " +
      "is nothing at all. Got: " + JSON.stringify(r.body.next_action));
    assert.equal(r.body.next_action_degraded, false,
      "that nothing must be a truthful nothing, not a read that failed");
  });

  test("GATE B on the list: a tier nobody recorded gets no funding chip either", async () => {
    plan.listRows = [listRow({
      outcome_tier: null,
      custom_fields_raw: { crs_paid: true, crs_status: "Complete", ready_for_next_round: true }
    })];
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [{ client_id: CLIENT_ID, n: 1 }];

    const r = res();
    await clientsHandler(req(LENS), r);

    const c = r.body.clients[0];
    const funding = ["review_funding_file", "prepare_next_round", "apply_for_funding", "ready_to_fund"];
    assert.ok(!funding.includes(c.next_action && c.next_action.key),
      "an unrecorded product type was treated as a funding plan: " + JSON.stringify(c.next_action));
  });

  /* ── demo credit rows are not pulls ────────────────────────────────────── */

  test("a demo credit row does not count as a pull", async () => {
    /* crs_count says 1 — that is the list's own count and it has NO is_demo
       filter (Phase 0). The demo-filtered count says 0. The chip must follow
       the filtered count, and the old field must be left exactly as it was. */
    plan.listRows = [listRow({ crs_count: "1" })];
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [];                        // the only row is a demo row

    const r = res();
    await clientsHandler(req(LENS), r);

    const c = r.body.clients[0];
    assert.equal(c.crs_count, 1, "the existing crs_count field was changed");
    assert.equal(c.next_action.key, "pull_crs",
      "a demo credit row was counted as a real pull, so the client was told nothing was needed: " +
      JSON.stringify(c.next_action));
  });

  test("a real credit row does stop the pull chip", async () => {
    plan.listRows = [listRow({ crs_count: "1" })];
    plan.consentRows = [consentRow()];
    plan.realCrsCounts = [{ client_id: CLIENT_ID, n: 1 }];

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.notEqual(r.body.clients[0].next_action && r.body.clients[0].next_action.key, "pull_crs",
      "a client whose credit is already in was told to pull it again");
  });

  /* ── the six rollups ───────────────────────────────────────────────────── */

  test("the rollups return null, never 0, where nothing honest backs them", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];
    plan.rollupRow = {
      total_clients: 47, needs_pull: 12, action_needed: 26,
      total_prequal: "50000", total_prequal_clients: 1
    };

    const r = res();
    await clientsHandler(req(LENS), r);

    const t = r.body.rollups;
    assert.ok(t, "the six tiles never reached the response");
    assert.equal(t.total_clients, 47);
    assert.equal(t.needs_pull, 12);
    assert.equal(t.action_needed, 26);
    assert.strictEqual(t.ready, null,
      "'Ready' has no definition and no source — 0 would claim nobody is ready");
    assert.strictEqual(t.total_approved, null,
      "'Total Approved' has no real rows behind it — 0 would claim nobody was approved");
    assert.strictEqual(t.total_prequal, "50000",
      "prequal money must pass through raw, not be rounded or coerced");
    assert.strictEqual(t.total_prequal_clients, 1,
      "the screen cannot be honest about a company total that came from one client " +
      "unless it is told how many contributed");
  });

  test("no prequal recorded anywhere stays null, it does not become zero", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];
    plan.rollupRow = {
      total_clients: 3, needs_pull: 0, action_needed: 0,
      total_prequal: null, total_prequal_clients: 0
    };

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.strictEqual(r.body.rollups.total_prequal, null,
      "unknown money became $0, which is a claim nobody made");
    assert.strictEqual(r.body.rollups.total_prequal_clients, 0);
  });

  test("a rollup read that fails costs the tiles, never the list", async () => {
    plan.listRows = [listRow()];
    plan.consentRows = [consentRow()];
    plan.rollupRow = null;                       // the count refuses

    const r = res();
    await clientsHandler(req(LENS), r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.count, 1, "a failed tile count emptied the client list");
    assert.ok(!("rollups" in r.body), "a failed count published tiles anyway");
    assert.ok(r.body.clients[0].next_action, "a failed tile count also cost the chips");
  });
});

/* ── source facts the scripted database cannot prove ──────────────────────────
   These assert rules that live in SQL text. They are cheap, and each one has
   already been a live defect in this repository. */
describe("the fulfillment read layer: rules that live in the SQL", () => {
  const src = readFileSync(new URL("../fulfillment/read-signals.mjs", import.meta.url), "utf8");

  test("the credit count the derivation reads excludes demo rows", () => {
    const block = src.slice(src.indexOf("const REAL_CRS_SQL"), src.indexOf("const ACTIVE_INQUIRY_SQL"));
    assert.match(block, /COALESCE\(is_demo, false\) = false/,
      "the derivation's credit count lost its is_demo filter, so demo rows count as real pulls");
  });

  test("the 'needs pull' tile excludes demo rows too", () => {
    const block = src.slice(src.indexOf("const ROLLUPS_SQL"));
    assert.match(block, /COALESCE\(cr\.is_demo, false\) = false/,
      "the Needs Pull tile counts demo credit rows as real ones");
  });

  test("the consent rule is imported, never a second hand-typed copy", () => {
    assert.match(src, /CONSENT_VALID_SQL/,
      "the batched consent read stopped using the exported predicate");
    assert.ok(!/revoked_at IS NULL/.test(src),
      "a second copy of the credit-pull consent rule was typed into the read layer. " +
      "src/consent/index.mjs owns that predicate; import CONSENT_VALID_SQL instead.");
  });

  test("nothing in the fulfillment layer writes", () => {
    for (const file of ["../fulfillment/read-signals.mjs", "../fulfillment/next-action.mjs"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.ok(!/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i.test(text),
        `${file} contains a write. This layer is read and display only.`);
    }
  });
});
