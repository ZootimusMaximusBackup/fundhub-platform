import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyInquiryRemovalSignature,
  normalizeInquiryRemovalEvent,
  handleInquiryRemovalWebhook,
  EVENT_TYPES
} from "./inquiry-removal.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";

const SECRET = "ira_whsec_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
const INQ = "44444444-4444-4444-8444-444444444444";

function fakeDb({ caseRow, inquiryRow } = {}) {
  const store = { events: [], cases: caseRow ? [caseRow] : [], inquiries: inquiryRow ? [inquiryRow] : [] };
  let n = 0;
  return {
    store,
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: ORG }] };
      if (/FROM clients WHERE id/.test(sql)) {
        return { rows: [{ id: CLIENT, org_id: ORG }] };
      }
      if (/INSERT INTO inquiry_removal_cases/.test(sql)) {
        const row = {
          id: CASE, org_id: ORG, client_id: CLIENT,
          external_case_id: params[2], case_status: params[3],
          selected_bureaus_raw: params[6], master_call_state: params[7],
          open_inquiry_count: 0, hold_started_at: null
        };
        store.cases.push(row);
        return { rows: [row] };
      }
      if (/UPDATE inquiry_removal_cases c\s+SET open_inquiry_count/.test(sql)
          || /UPDATE inquiry_removal_cases SET\s+open_inquiry_count/.test(sql)) {
        const row = store.cases[0];
        if (row) row.open_inquiry_count = store.inquiries.filter((i) => i.is_open).length;
        return { rows: row ? [row] : [] };
      }
      if (/UPDATE inquiry_removal_cases SET/.test(sql)) {
        const row = { ...(store.cases[0] || { id: CASE, org_id: ORG, client_id: CLIENT }),
          master_call_state: params[1], case_status: params[2] || "Calling",
          hold_started_at: params[3] || null, open_inquiry_count: 0 };
        store.cases[0] = row;
        return { rows: [row] };
      }
      if (/SELECT \* FROM inquiry_removal_cases WHERE id/.test(sql)) {
        return { rows: store.cases.filter((c) => c.id === params[0]) };
      }
      if (/SELECT \* FROM inquiry_removal_cases WHERE external_case_id/.test(sql)
          || /SELECT \* FROM inquiry_removal_cases WHERE org_id/.test(sql)) {
        return { rows: store.cases.slice(0, 1) };
      }
      if (/INSERT INTO inquiry_log/.test(sql)) {
        const row = {
          id: INQ, org_id: ORG, client_id: CLIENT, case_id: params[2],
          external_inquiry_id: params[3], bureau: params[4],
          inquiry: params[5], inquiry_name: params[6], call_state: params[7],
          status: params[8], is_open: params[9]
        };
        store.inquiries.push(row);
        return { rows: [row] };
      }
      if (/UPDATE inquiry_log SET/.test(sql)) {
        const row = {
          ...(store.inquiries[0] || { id: INQ, org_id: ORG, client_id: CLIENT, case_id: CASE }),
          status: "Cleared", is_open: false
        };
        store.inquiries[0] = row;
        return { rows: [row] };
      }
      if (/SELECT \* FROM inquiry_log WHERE id/.test(sql)
          || /SELECT \* FROM inquiry_log WHERE external_inquiry_id/.test(sql)
          || /SELECT \* FROM inquiry_log WHERE org_id/.test(sql)) {
        return { rows: store.inquiries.slice(0, 1) };
      }
      if (/INSERT INTO events/.test(sql)) {
        const row = { id: `evt-${++n}` };
        store.events.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

test("verifyInquiryRemovalSignature: accept hex / sha256= prefix; refuse bad / empty / no-secret", () => {
  const raw = JSON.stringify({ type: "case.created" });
  assert.equal(verifyInquiryRemovalSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyInquiryRemovalSignature(raw, "sha256=" + sign(raw), SECRET), true);
  assert.equal(verifyInquiryRemovalSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyInquiryRemovalSignature(raw, "", SECRET), false);
  assert.equal(verifyInquiryRemovalSignature(raw, sign(raw), null), false);
});

test("normalizeInquiryRemovalEvent: flattens IRA payload fields", () => {
  const evt = normalizeInquiryRemovalEvent({
    type: "call_state.changed",
    client_id: CLIENT,
    external_case_id: "recABC",
    master_call_state: "holding",
    hold_started_at: "2026-08-04T12:00:00Z"
  });
  assert.equal(evt.type, "call_state.changed");
  assert.equal(evt.clientId, CLIENT);
  assert.equal(evt.externalCaseId, "recABC");
  assert.equal(evt.masterCallState, "holding");
  assert.ok(EVENT_TYPES.has(evt.type));
});

test("handleInquiryRemovalWebhook: refuses bad signature", async () => {
  const raw = JSON.stringify({ type: "case.created", client_id: CLIENT });
  const out = await handleInquiryRemovalWebhook({
    db: fakeDb(), rawBody: raw, signatureHeader: "nope", secret: SECRET
  });
  assert.equal(out.status, 401);
  assert.equal(out.reason, "bad_signature");
});

test("handleInquiryRemovalWebhook: case.created upserts a case", async () => {
  const raw = JSON.stringify({
    type: "case.created",
    id: "evt-1",
    client_id: CLIENT,
    external_case_id: "recCASE1",
    case_status: "Scheduled",
    selected_bureaus_raw: "EX,TU",
    inquiries: [{ bureau: "EX", inquiry_name: "Capital One", external_inquiry_id: "recINQ1" }]
  });
  const db = fakeDb();
  const out = await handleInquiryRemovalWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "case.created");
  assert.ok(out.case);
  assert.equal(out.case.external_case_id, "recCASE1");
});

test("handleInquiryRemovalWebhook: inquiry.cleared emits inquiry.removed when case empties", async () => {
  clearHandlers();
  _resetOrgCache();
  const caseRow = {
    id: CASE, org_id: ORG, client_id: CLIENT,
    external_case_id: "recCASE1", case_status: "Awaiting Remover",
    open_inquiry_count: 1
  };
  const inquiryRow = {
    id: INQ, org_id: ORG, client_id: CLIENT, case_id: CASE,
    status: "Open", is_open: true
  };
  const db = fakeDb({ caseRow, inquiryRow });
  // After clear, refreshOpenCount returns 0 open → case Cleared path.
  const orig = db.query.bind(db);
  db.query = (sql, params) => {
    if (/UPDATE inquiry_removal_cases c\s+SET open_inquiry_count/.test(sql)) {
      return { rows: [{ ...caseRow, open_inquiry_count: 0, case_status: "Awaiting Remover" }] };
    }
    if (/UPDATE inquiry_removal_cases SET\s+case_status = 'Cleared'/.test(sql)
        || /case_status = 'Cleared'/.test(sql)) {
      return { rows: [{ ...caseRow, case_status: "Cleared", open_inquiry_count: 0, cleared_at: new Date() }] };
    }
    return orig(sql, params);
  };

  const raw = JSON.stringify({
    type: "inquiry.cleared",
    id: "evt-clear-1",
    inquiry_id: INQ,
    client_id: CLIENT
  });
  const out = await handleInquiryRemovalWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(out.ok, true);
  assert.equal(out.caseCleared, true);
  assert.equal(out.emitted.length, 1);
  assert.equal(out.emitted[0].name, "inquiry.removed");
});

test("handleInquiryRemovalWebhook: unknown type is ignored, not an error", async () => {
  const raw = JSON.stringify({ type: "ping" });
  const out = await handleInquiryRemovalWebhook({
    db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(out.ok, true);
  assert.match(out.reason, /^ignored:/);
});
