"use strict";

jest.mock("../../src/lib/airtable-client");
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/lib/packet-builder");
jest.mock("../../src/agents/experian-prompt");
jest.mock("../../src/agents/equifax-prompt");
jest.mock("../../src/agents/transunion-prompt");
jest.mock("../../src/lib/schedule-utils");
jest.mock("../../src/lib/auth");

const airtable = require("../../src/lib/airtable-client");
const bland = require("../../src/lib/bland-client");
const { buildCallPacket, buildCallMetadata, extractClientData } = require("../../src/lib/packet-builder");
const { buildExperianCallConfig } = require("../../src/agents/experian-prompt");
const { isBusinessHours, nextBusinessHourSlot } = require("../../src/lib/schedule-utils");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/schedule-call");

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

// Airtable record fixtures
const CASE_RECORD = {
  id: "recCASE1",
  fields: { client: ["recCLIENT1"] }
};
const CLIENT_RECORD = {
  id: "recCLIENT1",
  fields: { identity: ["recPII1"], phone: "555-111-0000" }
};
const PII_RECORD = {
  id: "recPII1",
  fields: {
    owner_first_name: "John",
    owner_last_name: "Doe",
    ssn_full: "123456789",
    dob: "01/15/1985",
    street1: "456 Oak Ave",
    city: "Miami",
    state: "FL",
    zip: "33101"
  }
};

const BASE_REQ = {
  method: "POST",
  headers: { authorization: "Bearer secret" },
  body: {
    case_id: "recCASE1",
    ghl_contact_id: "ghl_c1",
    round: "recROUND1",
    selected_bureaus_raw: "EX",
    inquiry_remover_user_id: "recUSER1"
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.API_SECRET = "secret";
  process.env.AIRTABLE_API_KEY = "test-airtable-key";
  process.env.BLAND_API_KEY = "test-bland-key";
  process.env.FUNDHUB_REP_NUMBER = "+15550009999";

  requireAuth.mockReturnValue(true);

  airtable.getRecord = jest.fn()
    .mockResolvedValueOnce(CASE_RECORD)    // case lookup
    .mockResolvedValueOnce(CLIENT_RECORD)  // client lookup
    .mockResolvedValueOnce(PII_RECORD);    // PII lookup
  airtable.updateRecord = jest.fn().mockResolvedValue({});

  extractClientData.mockReturnValue({
    firstName: "John",
    lastName: "Doe",
    middleName: "",
    ssn: "123456789",
    dob: "01/01/1985",
    phone: "+15551234567",
    address: { line1: "123 Main St", city: "Miami", state: "FL", zip: "33101" }
  });
  buildCallPacket.mockReturnValue({ client_first_name: "John", transfer_number: "+15550009999" });
  buildCallMetadata.mockReturnValue({ client_id: "recCLIENT1", bureau: "EX" });
  buildExperianCallConfig.mockReturnValue({ phoneNumber: "+18883973742", task: "..." });
  bland.createCall.mockResolvedValue({ call_id: "call_new_123", status: "queued" });
});

describe("POST /api/schedule-call", () => {
  test("returns 405 for non-POST requests", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  test("returns auth failure when requireAuth returns false", async () => {
    requireAuth.mockReturnValue(false);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(airtable.getRecord).not.toHaveBeenCalled();
  });

  test("returns 500 when AIRTABLE_API_KEY is not set", async () => {
    delete process.env.AIRTABLE_API_KEY;
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toContain("AIRTABLE_API_KEY");
  });

  test("returns 500 when BLAND_API_KEY is not set", async () => {
    delete process.env.BLAND_API_KEY;
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toContain("BLAND_API_KEY");
  });

  test("returns 400 when case_id is missing", async () => {
    const req = { ...BASE_REQ, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("case_id");
  });

  describe("within business hours — immediate launch", () => {
    beforeEach(() => {
      isBusinessHours.mockReturnValue(true);
      nextBusinessHourSlot.mockReturnValue(new Date());
    });

    test("returns status='calling' and a call_id", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._body.ok).toBe(true);
      expect(res._body.status).toBe("calling");
      expect(res._body.call_id).toBe("call_new_123");
    });

    test("calls bland.createCall", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);
      expect(bland.createCall).toHaveBeenCalledTimes(1);
    });

    test("updates Airtable case to Calling after launch", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);

      // Second updateRecord call should be Calling
      const calls = airtable.updateRecord.mock.calls;
      const callingUpdate = calls.find(c => c[2].case_status === "Calling");
      expect(callingUpdate).toBeDefined();
      expect(callingUpdate[2].ai_call_status).toContain("bland:call_new_123");
    });
  });

  describe("outside business hours — schedules for later", () => {
    const futureDate = new Date("2026-03-24T14:00:00.000Z");

    beforeEach(() => {
      isBusinessHours.mockReturnValue(false);
      nextBusinessHourSlot.mockReturnValue(futureDate);
    });

    test("returns status='scheduled' and null call_id", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._body.status).toBe("scheduled");
      expect(res._body.call_id).toBeNull();
    });

    test("does not call bland.createCall", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);
      expect(bland.createCall).not.toHaveBeenCalled();
    });

    test("includes scheduled_for in response", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);
      expect(res._body.scheduled_for).toBe(futureDate.toISOString());
    });

    test("updates Airtable with Scheduled status and scheduled time", async () => {
      const req = { ...BASE_REQ };
      const res = makeRes();
      await handler(req, res);

      expect(airtable.updateRecord).toHaveBeenCalledWith(
        "tblYOliwtT0RETm2S",
        "recCASE1",
        expect.objectContaining({
          case_status: "Scheduled",
          ai_call_scheduled_for: futureDate.toISOString()
        })
      );
    });
  });

  test("returns 400 when case has no linked client", async () => {
    airtable.getRecord = jest.fn().mockResolvedValueOnce({
      id: "recCASE1",
      fields: { client: [] }
    });
    isBusinessHours.mockReturnValue(true);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("no linked client");
  });

  test("returns 400 when client has no PII_IDENTITY link", async () => {
    airtable.getRecord = jest.fn()
      .mockResolvedValueOnce(CASE_RECORD)
      .mockResolvedValueOnce({ id: "recCLIENT1", fields: { identity: [] } });
    isBusinessHours.mockReturnValue(true);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("PII_IDENTITY");
  });

  test("returns bureaus array in response", async () => {
    isBusinessHours.mockReturnValue(false);
    nextBusinessHourSlot.mockReturnValue(new Date());
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(Array.isArray(res._body.bureaus)).toBe(true);
    expect(res._body.bureaus).toContain("EX");
  });

  test("rejects empty bureau selection instead of defaulting to Experian", async () => {
    isBusinessHours.mockReturnValue(true);
    const req = { ...BASE_REQ, body: { ...BASE_REQ.body, selected_bureaus_raw: "" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("No valid bureaus");
    expect(bland.createCall).not.toHaveBeenCalled();
  });

  test("returns 500 on unexpected error", async () => {
    airtable.getRecord = jest.fn().mockRejectedValue(new Error("Network error"));
    isBusinessHours.mockReturnValue(true);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
  });
});
