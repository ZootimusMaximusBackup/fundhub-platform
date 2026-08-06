"use strict";

// setter-webhook.js uses require() inside function bodies for ghl-client,
// so we must mock at the module-registry level.
jest.mock("../../src/lib/ghl-client");
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/agents/setter-prompt");

const ghl = require("../../src/lib/ghl-client");
const bland = require("../../src/lib/bland-client");
const { SETTER_ANALYSIS_QUESTIONS } = require("../../src/agents/setter-prompt");

const handler = require("../../api/setter-webhook");

// ---- helpers ----
function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

// Minimal valid webhook payload — confirmed (transferred)
const BOOKED_PAYLOAD = {
  call_id: "call_s1",
  status: "completed",
  completed: true,
  call_length: 120,
  transferred_to: "+15550001234",
  metadata: { ghl_contact_id: "ghl_contact_1" },
  transcripts: [],
  summary: "Lead booked an appointment"
};

// Voicemail payload
const VOICEMAIL_PAYLOAD = {
  call_id: "call_s2",
  status: "completed",
  answered_by: "voicemail",
  metadata: { ghl_contact_id: "ghl_contact_2" }
};

// No answer payload
const NO_ANSWER_PAYLOAD = {
  call_id: "call_s3",
  status: "no-answer",
  metadata: { ghl_contact_id: "ghl_contact_3" }
};

// Failed payload
const FAILED_PAYLOAD = {
  call_id: "call_s4",
  status: "failed",
  completed: false,
  metadata: {}
};

// Long call with "not interested" summary
const NOT_INTERESTED_PAYLOAD = {
  call_id: "call_s5",
  status: "completed",
  completed: true,
  call_length: 90,
  summary: "The lead said they are not interested in credit repair.",
  metadata: { ghl_contact_id: "ghl_contact_5" }
};

// Long call with "callback" summary
const CALLBACK_PAYLOAD = {
  call_id: "call_s6",
  status: "completed",
  completed: true,
  call_length: 80,
  summary: "Lead asked us to call back later this week.",
  metadata: { ghl_contact_id: "ghl_contact_6" }
};

// Short completed call (<15s, no transfer) — triggers no_answer threshold
const SHORT_CALL_PAYLOAD = {
  call_id: "call_s7",
  status: "completed",
  completed: true,
  call_length: 12,
  metadata: { ghl_contact_id: "ghl_contact_7" }
};

// Very short completed call (<=10s)
const VERY_SHORT_CALL_PAYLOAD = {
  call_id: "call_s8",
  status: "completed",
  completed: true,
  call_length: 5,
  metadata: {}
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BLAND_WEBHOOK_SECRET;

  // Default mock implementations
  ghl.isConfigured = jest.fn().mockReturnValue(false);
  ghl.updateContactCustomFields = jest.fn().mockResolvedValue({});
  ghl.addContactNote = jest.fn().mockResolvedValue({});
  ghl.addContactTags = jest.fn().mockResolvedValue({});
  bland.analyzeCall = jest.fn().mockResolvedValue({ answers: {} });
});

describe("POST /api/setter-webhook", () => {
  // ---- Method & payload validation ----

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

  // ---- Outcome classification ----

  test("maps transferred_to → outcome='confirmed'", async () => {
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.outcome).toBe("confirmed");
  });

  test("maps answered_by='voicemail' → outcome='voicemail'", async () => {
    const req = { method: "POST", headers: {}, body: VOICEMAIL_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("voicemail");
  });

  test("maps status='no-answer' → outcome='no_answer'", async () => {
    const req = { method: "POST", headers: {}, body: NO_ANSWER_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("no_answer");
  });

  test("maps status='busy' → outcome='no_answer'", async () => {
    const req = {
      method: "POST", headers: {},
      body: { call_id: "cx", status: "busy", metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("no_answer");
  });

  test("maps status='failed' → outcome='failed'", async () => {
    const req = { method: "POST", headers: {}, body: FAILED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("failed");
  });

  test("maps long completed call with 'not interested' summary → outcome='confirmed' (default for answered calls)", async () => {
    const req = { method: "POST", headers: {}, body: NOT_INTERESTED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    // summary has no reschedule/confirm signals → defaults to confirmed
    expect(res._body.outcome).toBe("confirmed");
  });

  test("maps long completed call with 'callback' summary → outcome='reschedule'", async () => {
    const req = { method: "POST", headers: {}, body: CALLBACK_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("reschedule");
  });

  test("maps long completed call with 'appointment' summary → outcome='confirmed'", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "cx", status: "completed", completed: true,
        call_length: 100, summary: "Lead scheduled an appointment for Thursday.",
        metadata: {}
      }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("confirmed");
  });

  test("maps long completed call with generic summary → outcome='confirmed' (default)", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "cx", status: "completed", completed: true,
        call_length: 90, summary: "Had a nice conversation about credit.",
        metadata: {}
      }
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("confirmed");
  });

  test("maps short completed call (<15s, no transfer) → outcome='no_answer'", async () => {
    const req = { method: "POST", headers: {}, body: SHORT_CALL_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("no_answer");
  });

  test("maps very short completed call (<=10s) → outcome='no_answer'", async () => {
    const req = { method: "POST", headers: {}, body: VERY_SHORT_CALL_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.outcome).toBe("no_answer");
  });

  // ---- GHL updates ----

  test("calls GHL update when ghl_contact_id present and GHL configured", async () => {
    ghl.isConfigured.mockReturnValue(true);
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.updateContactCustomFields).toHaveBeenCalledWith(
      "ghl_contact_1",
      expect.objectContaining({
        cf_call_confirmed: "true",
        cf_last_progress_action: "ai_call_confirmed"
      })
    );
    expect(ghl.addContactNote).toHaveBeenCalledWith(
      "ghl_contact_1",
      expect.stringContaining("AI Setter Call")
    );
  });

  test("does not write custom fields for voicemail outcome (tag-only)", async () => {
    ghl.isConfigured.mockReturnValue(true);
    const req = { method: "POST", headers: {}, body: VOICEMAIL_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    // voicemail is tag-only — updateContactCustomFields should NOT be called
    expect(ghl.updateContactCustomFields).not.toHaveBeenCalled();
  });

  test("adds 'setter:voicemail' tag for voicemail outcome", async () => {
    ghl.isConfigured.mockReturnValue(true);
    const req = { method: "POST", headers: {}, body: VOICEMAIL_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.addContactTags).toHaveBeenCalledWith("ghl_contact_2", ["setter:voicemail"]);
  });

  test("adds 'setter:no-answer' tag for no_answer outcome", async () => {
    ghl.isConfigured.mockReturnValue(true);
    const req = { method: "POST", headers: {}, body: NO_ANSWER_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.addContactTags).toHaveBeenCalledWith("ghl_contact_3", ["setter:no-answer"]);
  });

  test("does not call GHL when ghl_contact_id is missing", async () => {
    ghl.isConfigured.mockReturnValue(true);
    const req = {
      method: "POST", headers: {},
      body: { call_id: "cx", status: "completed", metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.updateContactCustomFields).not.toHaveBeenCalled();
  });

  test("does not call GHL when ghl.isConfigured() returns false", async () => {
    ghl.isConfigured.mockReturnValue(false);
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.updateContactCustomFields).not.toHaveBeenCalled();
  });

  test("still returns 200 if GHL update throws", async () => {
    ghl.isConfigured.mockReturnValue(true);
    ghl.updateContactCustomFields.mockRejectedValue(new Error("GHL error"));
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200); // non-fatal
  });

  // ---- Post-call analysis ----

  test("triggers analysis for completed calls", async () => {
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    // Give the async analysis a tick to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(bland.analyzeCall).toHaveBeenCalledWith("call_s1", SETTER_ANALYSIS_QUESTIONS);
  });

  test("does not trigger analysis for non-completed calls", async () => {
    const req = { method: "POST", headers: {}, body: FAILED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);

    await new Promise((r) => setTimeout(r, 10));
    expect(bland.analyzeCall).not.toHaveBeenCalled();
  });

  // ---- Signature verification ----

  test("validates webhook signature when BLAND_WEBHOOK_SECRET is set", async () => {
    process.env.BLAND_WEBHOOK_SECRET = "my-secret";
    const crypto = require("crypto");
    const rawBody = JSON.stringify(BOOKED_PAYLOAD);
    const validSig = crypto.createHmac("sha256", "my-secret").update(rawBody).digest("hex");

    const req = {
      method: "POST",
      headers: { "x-webhook-signature": validSig },
      body: BOOKED_PAYLOAD
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
      body: BOOKED_PAYLOAD
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.error).toContain("signature");
  });

  test("skips signature verification when BLAND_WEBHOOK_SECRET is not set", async () => {
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  // ---- contact_id in response ----

  test("returns contact_id in response when present in metadata", async () => {
    const req = { method: "POST", headers: {}, body: BOOKED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.contact_id).toBe("ghl_contact_1");
  });

  test("returns null contact_id when not present in metadata", async () => {
    const req = { method: "POST", headers: {}, body: FAILED_PAYLOAD };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.contact_id).toBeNull();
  });
});
