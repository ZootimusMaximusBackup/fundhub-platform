import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentJson, mediaFromBytes, processBureauResponse, onBureauResponseDocsReceived, RETAKE_TEMPLATE_KEY } from "./response-agent.mjs";
import { runParseAdvanceLoop, confirmHeldParse } from "./parse-loop.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const CASE_ID = "33333333-3333-3333-3333-333333333333";
const ITEM_ID = "44444444-4444-4444-4444-444444444444";
const CLEAR = "Experian response for account ending 4521: the item has been deleted from your file. Account 4521 deleted.";
const OPEN_ITEMS = [{ id: ITEM_ID, case_id: CASE_ID, creditor: "Midland", account_last4: "4521", round: "R1", status: "sent" }];

function fakeDb() {
  const responses = [], itemUpdates = [];
  return {
    responses, itemUpdates,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes("FROM dispute_items")) return { rows: OPEN_ITEMS.map((r) => ({ ...r })) };
      if (s.includes("INSERT INTO dispute_responses")) {
        const row = { id: "resp-" + (responses.length + 1), case_id: params[0], org_id: params[1], client_id: params[2], raw_text: params[3], parse_json: JSON.parse(params[4]), confidence: params[5], confirmed: params[6], confirmed_by: params[7] };
        responses.push(row); return { rows: [row] };
      }
      if (s.includes("UPDATE dispute_items")) { itemUpdates.push({ id: params[0], status: params[1], round: params[2], outcome: params[3] }); return { rows: [] }; }
      if (s.includes("INSERT INTO repair_decision_log")) return { rows: [] };
      if (s.includes("FROM dispute_responses")) return { rows: responses.filter((r) => r.id === params[0]) };
      if (s.includes("UPDATE dispute_responses")) { const row = responses.find((r) => r.id === params[0]); if (row) { row.confirmed = true; row.confirmed_by = params[1]; } return { rows: [] }; }
      return { rows: [] };
    }
  };
}

describe("C1/C2 bureau-response agent shapes", () => {
  it("parseAgentJson accepts pass and retake", () => {
    assert.equal(parseAgentJson(JSON.stringify({ quality: "pass", text: CLEAR, bureau_guess: "EX", message_to_client: "" })).quality, "pass");
    assert.equal(parseAgentJson(JSON.stringify({ quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "retake please" })).quality, "retake");
  });
  it("mediaFromBytes maps image and pdf", () => {
    assert.equal(mediaFromBytes("image/jpeg", Buffer.from("x"))[0].type, "image");
    assert.equal(mediaFromBytes("application/pdf", Buffer.from("%PDF"))[0].type, "document");
  });
  it("C1 clear letter auto-advances", async () => {
    const db = fakeDb();
    const result = await processBureauResponse(db, {
      orgId: ORG, clientId: CLIENT, documentId: "doc-1", bytes: Buffer.from("clear"), mimeType: "image/jpeg", items: OPEN_ITEMS,
      callModelImpl: async () => ({ mode: "live", text: JSON.stringify({ quality: "pass", text: CLEAR, bureau_guess: "EX", message_to_client: "" }), error: null }),
      sendTemplatedImpl: async () => ({ sent: true }), onEvent: async () => ({})
    });
    assert.equal(result.status, "advanced");
    assert.equal(result.parse.outcomes[0].outcome, "deleted");
    assert.ok(result.parse.confidence >= 0.85);
    assert.equal(db.itemUpdates[0].status, "deleted");
    assert.equal(db.responses[0].confirmed_by, null);
    assert.notEqual(db.responses[0].confirmed_by, "system_high_confidence");
  });
  it("high-confidence auto-parse does not store system_high_confidence as a staff id", async () => {
    const db = fakeDb();
    const result = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: CLEAR, items: OPEN_ITEMS,
      confirmedBy: "system_high_confidence", onEvent: async () => ({})
    });
    assert.equal(result.status, "advanced");
    assert.ok(result.parseResult.confidence >= 0.85);
    assert.equal(db.responses[0].confirmed, true);
    assert.equal(db.responses[0].confirmed_by, null);
  });
  it("C1 low confidence held then confirm advances", async () => {
    const db = fakeDb();
    const held = await runParseAdvanceLoop(db, { orgId: ORG, clientId: CLIENT, text: "We received your letter about Midland.", items: OPEN_ITEMS, onEvent: async () => ({}) });
    assert.equal(held.status, "held");
    const confirmed = await confirmHeldParse(db, { orgId: ORG, responseId: held.responseId, confirmedBy: "staff-1", confirmedOutcomes: [{ itemId: ITEM_ID, outcome: "verified" }], onEvent: async () => ({}) });
    assert.equal(confirmed.status, "advanced");
    assert.equal(db.itemUpdates[0].status, "escalated");
  });
  it("C2 blurry retake no parse", async () => {
    const db = fakeDb(); const emails = [];
    const result = await processBureauResponse(db, {
      orgId: ORG, clientId: CLIENT, documentId: "blur", bytes: Buffer.from("b"), mimeType: "image/jpeg", items: OPEN_ITEMS,
      callModelImpl: async () => ({ mode: "live", text: JSON.stringify({ quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "blurry — retake" }), error: null }),
      sendTemplatedImpl: async (_d, a) => { emails.push(a); return { sent: false }; }, onEvent: async () => ({})
    });
    assert.equal(result.status, "retake");
    assert.equal(result.parse, null);
    assert.equal(db.itemUpdates.length, 0);
    assert.equal(emails[0].templateKey, RETAKE_TEMPLATE_KEY);
  });
  it("skips non-bureau docs.received", async () => {
    const r = await onBureauResponseDocsReceived(null, { orgId: ORG, clientId: CLIENT, payload: { kind: "client_upload", document_id: "x" } });
    assert.equal(r.skipped, true);
  });
});
