"use strict";

// call-webhook.js uses require() inside function bodies for airtable-client and
// ghl-client, so we must mock them at the module-registry level.
jest.mock("../../src/lib/airtable-client");
jest.mock("../../src/lib/ghl-client");

const airtable = require("../../src/lib/airtable-client");
const ghl = require("../../src/lib/ghl-client");

const handler = require("../../api/call-webhook");

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

// Minimal valid webhook payload (transferred call)
const TRANSFERRED_PAYLOAD = {
  call_id: "call_111",
  status: "completed",
  completed: true,
  call_length: 120,
  transferred_to: "+15550001234",
  metadata: { case_id: "recCASE1", ghl_contact_id: "ghl_contact_1" },
  transcripts: [],
  summary: "Call transferred to rep"
};

// Failed call payload
const FAILED_PAYLOAD = {
  call_id: "call_222",
  status: "failed",
  completed: false,
  call_length: 5,
  metadata: { case_id: "recCASE2", ghl_contact_id: null }
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BLAND_WEBHOOK_SECRET;
  delete process.env.AIRTABLE_API_KEY;

  // Default mock implementations
  airtable.updateRecord = jest.fn().mockResolvedValue({});
  ghl.isConfigured = jest.fn().mockReturnValue(false);
  ghl.updateContactCustomFields = jest.fn().mockResolvedValue({});
  ghl.addContactNote = jest.fn().mockResolvedValue({});
});

describe("POST /api/call-webhook", () => {
  test("returns 405 for non-POST requests", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  test("returns 400 when body has no call_id", async () => {
    const req = { method: "POST", headers: {}, body: { status: "completed" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("Invalid webhook payload");
  });

  test("returns 400 when body is missing entirely", async () => {
    const req = { method: "POST", headers: {}, body: null };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  test("returns 200 on successful transferred call", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = {
      method: "POST",
      headers: {},
      body: TRANSFERRED_PAYLOAD
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.outcome).toBe("transferred");
    expect(res._body.case_status).toBe("Awaiting Remover");
  });

  test("maps transferred_to → outcome='transferred' → case_status='Awaiting Remover'", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = { method: "POST", headers: {}, body: TRANSFERRED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.outcome).toBe("transferred");
    expect(res._body.case_status).toBe("Awaiting Remover");
  });

  test("maps status='failed' → outcome='failed' → case_status='Call Failed'", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = { method: "POST", headers: {}, body: FAILED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.outcome).toBe("failed");
    expect(res._body.case_status).toBe("Call Failed");
  });

  test("maps status='no-answer' → outcome='no_answer' → case_status='Call Failed'", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = {
      method: "POST",
      headers: {},
      body: { call_id: "c3", status: "no-answer", metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("no_answer");
    expect(res._body.case_status).toBe("Call Failed");
  });

  test("maps answered_by='voicemail' → outcome='left_voicemail' → case_status='Call Failed'", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = {
      method: "POST",
      headers: {},
      body: { call_id: "c4", status: "completed", answered_by: "voicemail", metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("left_voicemail");
    expect(res._body.case_status).toBe("Call Failed");
  });

  test("maps completed=true + call_length>30 (no transfer) → reached_human → Awaiting Remover", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = {
      method: "POST",
      headers: {},
      body: { call_id: "c5", status: "completed", completed: true, call_length: 60, metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("reached_human");
    expect(res._body.case_status).toBe("Awaiting Remover");
  });

  test("calls airtable.updateRecord when case_id and AIRTABLE_API_KEY are present", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    const req = { method: "POST", headers: {}, body: TRANSFERRED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(airtable.updateRecord).toHaveBeenCalledWith(
      "tblYOliwtT0RETm2S",
      "recCASE1",
      expect.objectContaining({
        case_status: "Awaiting Remover",
        ai_call_status: "transferred"
      })
    );
  });

  test("does not call airtable.updateRecord when AIRTABLE_API_KEY is missing", async () => {
    const req = { method: "POST", headers: {}, body: TRANSFERRED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(airtable.updateRecord).not.toHaveBeenCalled();
  });

  test("still returns 200 if airtable.updateRecord throws", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    airtable.updateRecord.mockRejectedValue(new Error("Airtable error"));
    const req = { method: "POST", headers: {}, body: TRANSFERRED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200); // non-fatal
  });

  test("calls GHL update when ghl.isConfigured() returns true and ghl_contact_id is set", async () => {
    process.env.AIRTABLE_API_KEY = "test-key";
    ghl.isConfigured.mockReturnValue(true);
    const req = { method: "POST", headers: {}, body: TRANSFERRED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.updateContactCustomFields).toHaveBeenCalledWith(
      "ghl_contact_1",
      expect.objectContaining({ ai_call_master_status: "transferred" })
    );
    expect(ghl.addContactNote).toHaveBeenCalled();
  });

  test("validates webhook signature when BLAND_WEBHOOK_SECRET is set", async () => {
    process.env.BLAND_WEBHOOK_SECRET = "my-secret";
    const crypto = require("crypto");
    const rawBody = JSON.stringify(TRANSFERRED_PAYLOAD);
    const validSig = crypto.createHmac("sha256", "my-secret").update(rawBody).digest("hex");

    const req = {
      method: "POST",
      headers: { "x-webhook-signature": validSig },
      body: TRANSFERRED_PAYLOAD
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  test("returns 401 when BLAND_WEBHOOK_SECRET is set but signature is invalid", async () => {
    process.env.BLAND_WEBHOOK_SECRET = "my-secret";
    const req = {
      method: "POST",
      headers: { "x-webhook-signature": "bad-signature" },
      body: TRANSFERRED_PAYLOAD
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.error).toContain("signature");
  });
});
