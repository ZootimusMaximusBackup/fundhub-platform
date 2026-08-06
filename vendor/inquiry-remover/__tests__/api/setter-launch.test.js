"use strict";

// Mock dependencies before importing the handler
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/agents/setter-prompt");
jest.mock("../../src/lib/auth");

const bland = require("../../src/lib/bland-client");
const { buildSetterCallConfig } = require("../../src/agents/setter-prompt");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/setter-launch");

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

const BASE_REQ = {
  method: "POST",
  headers: { authorization: "Bearer secret" },
  body: {
    contactId: "ghl_contact_1",
    firstName: "John",
    lastName: "Doe",
    phone: "+15551234567",
    calendarId: "cal_abc",
    repName: "Chris"
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BLAND_API_KEY = "test-bland-key";
  process.env.API_SECRET = "secret";

  // Default: auth passes
  requireAuth.mockReturnValue(true);

  // Default mock implementations
  buildSetterCallConfig.mockReturnValue({
    phoneNumber: "+15551234567",
    task: "...",
    requestData: {}
  });
  bland.createCall.mockResolvedValue({ call_id: "call_setter_1", status: "queued" });
});

describe("POST /api/setter-launch", () => {
  test("returns 405 for non-POST requests", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body.error).toBe("Method not allowed");
  });

  test("returns auth failure result when requireAuth returns false", async () => {
    requireAuth.mockReturnValue(false);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(bland.createCall).not.toHaveBeenCalled();
  });

  test("returns 500 when BLAND_API_KEY is not set", async () => {
    delete process.env.BLAND_API_KEY;
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toContain("BLAND_API_KEY");
  });

  test("returns 400 when contactId is missing", async () => {
    const req = { ...BASE_REQ, body: { firstName: "John", phone: "+15551234567" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("contactId");
  });

  test("returns 400 when firstName is missing", async () => {
    const req = { ...BASE_REQ, body: { contactId: "ghl_1", phone: "+15551234567" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("firstName");
  });

  test("returns 400 when phone is missing", async () => {
    const req = { ...BASE_REQ, body: { contactId: "ghl_1", firstName: "John" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("phone");
  });

  test("returns 200 with call info on successful launch", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.callId).toBe("call_setter_1");
    expect(res._body.contactId).toBe("ghl_contact_1");
    expect(res._body.status).toBe("queued");
  });

  test("calls buildSetterCallConfig with correct requestData and metadata", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_first_name: "John",
        lead_last_name: "Doe",
        lead_phone: "+15551234567",
        rep_name: "Chris",
        company_name: "FundHub",
        contact_id: "ghl_contact_1",
        calendar_id: "cal_abc"
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          contact_id: "ghl_contact_1",
          call_type: "setter"
        })
      })
    );
  });

  test("defaults lastName to empty string when not provided", async () => {
    const req = {
      ...BASE_REQ,
      body: { contactId: "ghl_1", firstName: "John", phone: "+15551234567" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({ lead_last_name: "" }),
      expect.anything()
    );
  });

  test("defaults repName to 'our credit specialist' when not provided", async () => {
    const req = {
      ...BASE_REQ,
      body: { contactId: "ghl_1", firstName: "John", phone: "+15551234567" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({ rep_name: "our credit specialist" }),
      expect.anything()
    );
  });

  test("uses GHL_CALENDAR_ID env when calendarId not in body", async () => {
    process.env.GHL_CALENDAR_ID = "env_cal_123";
    const req = {
      ...BASE_REQ,
      body: { contactId: "ghl_1", firstName: "John", phone: "+15551234567" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({ calendar_id: "env_cal_123" }),
      expect.anything()
    );
    delete process.env.GHL_CALENDAR_ID;
  });

  test("passes FUNDHUB_REP_NUMBER env as transfer_number in requestData", async () => {
    process.env.FUNDHUB_REP_NUMBER = "+15559990000";
    const req = {
      ...BASE_REQ,
      body: { contactId: "ghl_1", firstName: "John", phone: "+15551234567" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(buildSetterCallConfig).toHaveBeenCalledWith(
      expect.objectContaining({ transfer_number: "+15559990000" }),
      expect.anything()
    );
    delete process.env.FUNDHUB_REP_NUMBER;
  });

  test("returns 500 when bland.createCall throws", async () => {
    bland.createCall.mockRejectedValue(new Error("Bland API failure"));
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
    expect(res._body.error).toBe("Internal server error");
  });

  test("returns 500 when buildSetterCallConfig throws", async () => {
    buildSetterCallConfig.mockImplementation(() => {
      throw new Error("Config error");
    });
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
  });
});
