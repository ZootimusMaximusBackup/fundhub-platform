"use strict";

jest.mock("../src/lib/bland-client");
jest.mock("../src/agents/setter-prompt");

const bland = require("../src/lib/bland-client");
const { buildSetterCallConfig } = require("../src/agents/setter-prompt");

const {
  triggerOutboundCadence,
  triggerThreeWayHandoff,
  _fireDoubleDial,
  _fireSmsCadence
} = require("../src/lib/setter-outbound-cadence");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace global fetch with a jest mock that returns a given response. */
function mockFetch(status = 200, body = "ok") {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(body)
  });
}

const BASE_OPTS = {
  contactId: "ghl_contact_1",
  firstName: "John",
  phone: "+15551234567",
  prequalAmount: "125000",
  appointmentTime: "2026-04-15T14:00:00Z",
  primaryFico: "720",
  closerName: "Chris",
  analyzerRecommendation: "funding",
  originalCallId: "call_orig_1",
  triggerReason: "no_answer"
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BLAND_API_KEY;
  delete process.env.GHL_SETTER_CADENCE_WEBHOOK_URL;
  delete process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL;
  delete process.env.GHL_CALENDAR_ID;
  delete process.env.FUNDHUB_REP_NUMBER;

  // Default: buildSetterCallConfig returns a minimal config
  buildSetterCallConfig.mockReturnValue({
    phone_number: "+15551234567",
    task: "mock task",
    amd: true,
    max_duration: 10
  });

  // Default: bland.createCall succeeds
  bland.createCall.mockResolvedValue({ call_id: "call_dd_1", status: "queued" });

  // Default: fetch succeeds
  mockFetch(200, "ok");
});

// ---------------------------------------------------------------------------
// triggerOutboundCadence — integration
// ---------------------------------------------------------------------------

describe("triggerOutboundCadence()", () => {
  test("returns ok:true when both double-dial and SMS cadence succeed", async () => {
    process.env.BLAND_API_KEY = "test-key";
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    const result = await triggerOutboundCadence(BASE_OPTS);

    expect(result.ok).toBe(true);
    expect(result.doubleDial.ok).toBe(true);
    expect(result.smsCadence.ok).toBe(true);
  });

  test("returns ok:false when double-dial fails (BLAND_API_KEY missing)", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";
    // BLAND_API_KEY intentionally not set

    const result = await triggerOutboundCadence(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.doubleDial.ok).toBe(false);
    expect(result.doubleDial.error).toMatch(/BLAND_API_KEY/);
    // SMS cadence may still succeed independently
    expect(result.smsCadence.ok).toBe(true);
  });

  test("returns ok:false when SMS cadence fails (env var missing)", async () => {
    process.env.BLAND_API_KEY = "test-key";
    // GHL_SETTER_CADENCE_WEBHOOK_URL intentionally not set

    const result = await triggerOutboundCadence(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.smsCadence.ok).toBe(false);
    expect(result.smsCadence.error).toMatch(/GHL_SETTER_CADENCE_WEBHOOK_URL/);
    // Double-dial still succeeds
    expect(result.doubleDial.ok).toBe(true);
  });

  test("double-dial fails when phone is missing — other steps unaffected", async () => {
    process.env.BLAND_API_KEY = "test-key";
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    const result = await triggerOutboundCadence({ ...BASE_OPTS, phone: "" });

    expect(result.doubleDial.ok).toBe(false);
    expect(result.doubleDial.error).toMatch(/phone/i);
    expect(result.smsCadence.ok).toBe(true);
  });

  test("both steps run in parallel — bland.createCall and fetch both called", async () => {
    process.env.BLAND_API_KEY = "test-key";
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    await triggerOutboundCadence(BASE_OPTS);

    expect(bland.createCall).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("still resolves (does not throw) if bland.createCall throws", async () => {
    process.env.BLAND_API_KEY = "test-key";
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";
    bland.createCall.mockRejectedValue(new Error("Bland API down"));

    const result = await triggerOutboundCadence(BASE_OPTS);

    expect(result.doubleDial.ok).toBe(false);
    expect(result.doubleDial.error).toBe("Bland API down");
    expect(result.smsCadence.ok).toBe(true); // unaffected
  });

  test("still resolves if fetch throws (network error)", async () => {
    process.env.BLAND_API_KEY = "test-key";
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";
    global.fetch = jest.fn().mockRejectedValue(new Error("Network failure"));

    const result = await triggerOutboundCadence(BASE_OPTS);

    expect(result.smsCadence.ok).toBe(false);
    expect(result.smsCadence.error).toBe("Network failure");
    expect(result.doubleDial.ok).toBe(true); // unaffected
  });
});

// ---------------------------------------------------------------------------
// _fireDoubleDial — unit
// ---------------------------------------------------------------------------

describe("_fireDoubleDial()", () => {
  test("calls buildSetterCallConfig with correct shape", async () => {
    process.env.BLAND_API_KEY = "test-key";

    await _fireDoubleDial(BASE_OPTS);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_number: "+15551234567",
        ghl_contact_id: "ghl_contact_1",
        first_name: "John",
        prequal_amount: "125000",
        closer_name: "Chris"
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          call_type: "setter_double_dial",
          double_dial_reason: "no_answer",
          original_call_id: "call_orig_1"
        })
      })
    );
  });

  test("sets voicemail_message on the call config", async () => {
    process.env.BLAND_API_KEY = "test-key";

    // Capture what createCall receives
    let capturedConfig = null;
    bland.createCall.mockImplementation((cfg) => {
      capturedConfig = cfg;
      return Promise.resolve({ call_id: "call_dd_2" });
    });
    buildSetterCallConfig.mockImplementation((rd, overrides) => ({
      phone_number: rd.phone_number,
      ...overrides
    }));

    await _fireDoubleDial(BASE_OPTS);

    expect(capturedConfig).toHaveProperty("voicemail_message");
    expect(capturedConfig.voicemail_message).toMatch(/Josh/);
    expect(capturedConfig.voicemail_message).toMatch(/FundHub/);
  });

  test("returns { ok: true, call_id } on success", async () => {
    process.env.BLAND_API_KEY = "test-key";
    bland.createCall.mockResolvedValue({ call_id: "call_dd_ok" });

    const result = await _fireDoubleDial(BASE_OPTS);

    expect(result).toEqual({ ok: true, call_id: "call_dd_ok" });
  });

  test("returns { ok: false, error } when BLAND_API_KEY missing", async () => {
    const result = await _fireDoubleDial(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/BLAND_API_KEY/);
    expect(bland.createCall).not.toHaveBeenCalled();
  });

  test("returns { ok: false, error } when phone is empty", async () => {
    process.env.BLAND_API_KEY = "test-key";

    const result = await _fireDoubleDial({ ...BASE_OPTS, phone: "" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/phone/i);
    expect(bland.createCall).not.toHaveBeenCalled();
  });

  test("returns { ok: false, error } when bland.createCall throws", async () => {
    process.env.BLAND_API_KEY = "test-key";
    bland.createCall.mockRejectedValue(new Error("API error"));

    const result = await _fireDoubleDial(BASE_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("API error");
  });

  test("sets maxDuration: 10 on call config", async () => {
    process.env.BLAND_API_KEY = "test-key";

    let captured = null;
    bland.createCall.mockImplementation((cfg) => {
      captured = cfg;
      return Promise.resolve({ call_id: "call_dur" });
    });
    buildSetterCallConfig.mockReturnValue({ maxDuration: undefined });

    await _fireDoubleDial(BASE_OPTS);

    // After fireDoubleDial overrides maxDuration on the returned config
    expect(captured).toHaveProperty("maxDuration", 10);
  });
});

// ---------------------------------------------------------------------------
// _fireSmsCadence — unit
// ---------------------------------------------------------------------------

describe("_fireSmsCadence()", () => {
  const SMS_OPTS = {
    contactId: "ghl_contact_1",
    firstName: "John",
    prequalAmount: "125000",
    appointmentTime: "2026-04-15T14:00:00Z",
    closerName: "Chris",
    triggerReason: "no_answer"
  };

  test("returns { ok: false, error } when GHL_SETTER_CADENCE_WEBHOOK_URL not set", async () => {
    const result = await _fireSmsCadence(SMS_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GHL_SETTER_CADENCE_WEBHOOK_URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("POSTs to GHL_SETTER_CADENCE_WEBHOOK_URL with correct payload shape", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    await _fireSmsCadence(SMS_OPTS);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.ghl.test/cadence",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe("setter_no_answer_cadence");
    expect(body.contact_id).toBe("ghl_contact_1");
    expect(body.first_name).toBe("John");
    expect(body.prequal_amount).toBe("125000");
    expect(body.trigger_reason).toBe("no_answer");
  });

  test("includes sms_templates in payload with all 3 messages", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    await _fireSmsCadence(SMS_OPTS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.sms_templates).toHaveProperty("sms_1_value_first");
    expect(body.sms_templates).toHaveProperty("sms_2_follow_up");
    expect(body.sms_templates).toHaveProperty("sms_3_break_up");
  });

  test("sms_1 references first_name and prequal_amount", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    await _fireSmsCadence(SMS_OPTS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const sms1 = body.sms_templates.sms_1_value_first;
    expect(sms1).toMatch(/John/);
    expect(sms1).toMatch(/125000/);
    expect(sms1).toMatch(/Josh/);
    expect(sms1).toMatch(/FundHub/);
  });

  test("sms_3 (break-up) includes reply YES and Josh sign-off", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    await _fireSmsCadence(SMS_OPTS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const sms3 = body.sms_templates.sms_3_break_up;
    expect(sms3).toMatch(/YES/);
    expect(sms3).toMatch(/Josh/);
    expect(sms3).toMatch(/125000/);
  });

  test("returns { ok: true } on HTTP 200", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";

    const result = await _fireSmsCadence(SMS_OPTS);

    expect(result).toEqual({ ok: true });
  });

  test("returns { ok: false, error } on HTTP 4xx", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";
    mockFetch(422, "Unprocessable Entity");

    const result = await _fireSmsCadence(SMS_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/422/);
  });

  test("returns { ok: false, error } on fetch network error", async () => {
    process.env.GHL_SETTER_CADENCE_WEBHOOK_URL = "https://hooks.ghl.test/cadence";
    global.fetch = jest.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await _fireSmsCadence(SMS_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Connection refused");
  });
});

// ---------------------------------------------------------------------------
// triggerThreeWayHandoff — unit
// ---------------------------------------------------------------------------

describe("triggerThreeWayHandoff()", () => {
  const HANDOFF_OPTS = {
    contactId: "ghl_contact_1",
    firstName: "John",
    prequalAmount: "125000",
    appointmentTime: "2026-04-15T14:00:00Z",
    closerName: "Chris",
    zoomLink: "https://zoom.us/j/123456789"
  };

  test("returns { ok: false, error } when GHL_SETTER_HANDOFF_WEBHOOK_URL not set", async () => {
    const result = await triggerThreeWayHandoff(HANDOFF_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GHL_SETTER_HANDOFF_WEBHOOK_URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("POSTs to GHL_SETTER_HANDOFF_WEBHOOK_URL with correct payload", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";

    await triggerThreeWayHandoff(HANDOFF_OPTS);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.ghl.test/handoff",
      expect.objectContaining({ method: "POST" })
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe("setter_three_way_handoff");
    expect(body.contact_id).toBe("ghl_contact_1");
    expect(body.first_name).toBe("John");
    expect(body.closer_name).toBe("Chris");
    expect(body.zoom_link).toBe("https://zoom.us/j/123456789");
  });

  test("handoff_sms references first_name, closer_name, prequal_amount, and zoom_link", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";

    await triggerThreeWayHandoff(HANDOFF_OPTS);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.handoff_sms).toMatch(/John/);
    expect(body.handoff_sms).toMatch(/Josh/);
    expect(body.handoff_sms).toMatch(/Chris/);
    expect(body.handoff_sms).toMatch(/125000/);
    expect(body.handoff_sms).toMatch(/zoom\.us/);
    expect(body.handoff_sms).toMatch(/15 minutes/);
  });

  test("returns { ok: true } on success", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";

    const result = await triggerThreeWayHandoff(HANDOFF_OPTS);

    expect(result).toEqual({ ok: true });
  });

  test("returns { ok: false, error } on HTTP 500", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";
    mockFetch(500, "Internal Server Error");

    const result = await triggerThreeWayHandoff(HANDOFF_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  test("returns { ok: false, error } on network error", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";
    global.fetch = jest.fn().mockRejectedValue(new Error("Timeout"));

    const result = await triggerThreeWayHandoff(HANDOFF_OPTS);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Timeout");
  });

  test("falls back to template placeholders when optional fields are omitted", async () => {
    process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL = "https://hooks.ghl.test/handoff";

    await triggerThreeWayHandoff({ contactId: "ghl_1", firstName: "Sara" });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.handoff_sms).toMatch(/Sara/);
    // Falls back to template placeholders for missing fields
    expect(body.handoff_sms).toMatch(/\{\{/);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for setter-webhook cadence wiring are in:
//   __tests__/api/setter-webhook-cadence.test.js
// (Kept separate to avoid jest.mock hoisting conflicts with the module-level
//  bland-client / setter-prompt mocks above.)
// ---------------------------------------------------------------------------
