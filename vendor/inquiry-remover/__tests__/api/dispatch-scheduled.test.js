"use strict";

jest.mock("../../src/lib/airtable-client");
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/lib/packet-builder");
jest.mock("../../src/agents/experian-prompt");
jest.mock("../../src/agents/equifax-prompt");
jest.mock("../../src/agents/transunion-prompt");
jest.mock("../../src/lib/schedule-utils");

const airtable = require("../../src/lib/airtable-client");
const bland = require("../../src/lib/bland-client");
const { buildCallPacket, buildCallMetadata, extractClientData } = require("../../src/lib/packet-builder");
const { buildExperianCallConfig } = require("../../src/agents/experian-prompt");
const { isBusinessHours } = require("../../src/lib/schedule-utils");

const handler = require("../../api/dispatch-scheduled");

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

// Airtable fixtures
const CLIENT_RECORD = {
  id: "recCLIENT1",
  fields: { identity: ["recPII1"], phone: "555-000-1111" }
};
const PII_RECORD = {
  id: "recPII1",
  fields: {
    owner_first_name: "Jane",
    owner_last_name: "Doe",
    ssn_full: "987654321",
    zip: "10001",
    street1: "100 Main St",
    city: "New York",
    state: "NY"
  }
};

const CASE_RECORD_1 = {
  id: "recCASE1",
  fields: {
    client: ["recCLIENT1"],
    selected_bureaus_raw: "EX"
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  process.env.AIRTABLE_API_KEY = "test-airtable-key";
  process.env.BLAND_API_KEY = "test-bland-key";
  process.env.FUNDHUB_REP_NUMBER = "+15550009999";

  isBusinessHours.mockReturnValue(true);
  airtable.listRecords = jest.fn().mockResolvedValue({ records: [] });
  airtable.getRecord = jest.fn()
    .mockResolvedValue(CLIENT_RECORD)  // default: client lookup
  ;
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
  buildCallPacket.mockReturnValue({ client_first_name: "Jane", transfer_number: "+15550009999" });
  buildCallMetadata.mockReturnValue({ client_id: "recCLIENT1", bureau: "EX" });
  buildExperianCallConfig.mockReturnValue({ phoneNumber: "+18883973742", task: "..." });
  bland.createCall.mockResolvedValue({ call_id: "call_dispatched_1", status: "queued" });
});

describe("dispatch-scheduled handler", () => {
  test("returns 405 for non-GET/POST requests", async () => {
    const req = { method: "DELETE", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  test("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const req = { method: "GET", headers: { authorization: "" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe("Server misconfigured");
  });

  test("returns 401 when token does not match CRON_SECRET", async () => {
    const req = { method: "GET", headers: { authorization: "Bearer wrong-token" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe("Unauthorized");
  });

  test("accepts valid Bearer token", async () => {
    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  test("accepts POST method", async () => {
    const req = { method: "POST", headers: { authorization: "Bearer cron-secret" }, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  test("returns early with dispatched=0 when outside business hours", async () => {
    isBusinessHours.mockReturnValue(false);
    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.dispatched).toBe(0);
    expect(res._body.reason).toBe("outside_business_hours");
    expect(airtable.listRecords).not.toHaveBeenCalled();
  });

  test("returns dispatched=0 when no records are scheduled", async () => {
    airtable.listRecords.mockResolvedValue({ records: [] });
    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.dispatched).toBe(0);
    expect(res._body.results).toEqual([]);
  });

  test("dispatches scheduled calls and returns count", async () => {
    airtable.listRecords.mockResolvedValue({ records: [CASE_RECORD_1] });
    airtable.getRecord = jest.fn()
      .mockResolvedValueOnce(CLIENT_RECORD)
      .mockResolvedValueOnce(PII_RECORD);

    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.dispatched).toBe(1);
    expect(res._body.failed).toBe(0);
    expect(res._body.results[0]).toEqual(
      expect.objectContaining({
        case_id: "recCASE1",
        status: "dispatched",
        call_id: "call_dispatched_1"
      })
    );
  });

  test("calls bland.createCall for each dispatched case", async () => {
    airtable.listRecords.mockResolvedValue({ records: [CASE_RECORD_1] });
    airtable.getRecord = jest.fn()
      .mockResolvedValueOnce(CLIENT_RECORD)
      .mockResolvedValueOnce(PII_RECORD);

    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(bland.createCall).toHaveBeenCalledTimes(1);
  });

  test("updates Airtable case to Calling after dispatch", async () => {
    airtable.listRecords.mockResolvedValue({ records: [CASE_RECORD_1] });
    airtable.getRecord = jest.fn()
      .mockResolvedValueOnce(CLIENT_RECORD)
      .mockResolvedValueOnce(PII_RECORD);

    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(airtable.updateRecord).toHaveBeenCalledWith(
      "tblYOliwtT0RETm2S",
      "recCASE1",
      expect.objectContaining({
        case_status: "Calling",
        ai_call_status: "bland:call_dispatched_1"
      })
    );
  });

  test("marks case as failed in results when dispatch throws", async () => {
    airtable.listRecords.mockResolvedValue({ records: [CASE_RECORD_1] });
    airtable.getRecord = jest.fn().mockRejectedValue(new Error("Network error"));

    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.failed).toBe(1);
    expect(res._body.results[0].status).toBe("failed");
    expect(res._body.results[0].error).toBe("call_failed");
  });

  test("returns 500 when AIRTABLE_API_KEY is not set", async () => {
    delete process.env.AIRTABLE_API_KEY;
    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toContain("AIRTABLE_API_KEY");
  });

  test("returns 500 when airtable.listRecords throws", async () => {
    airtable.listRecords.mockRejectedValue(new Error("Airtable down"));
    const req = { method: "GET", headers: { authorization: "Bearer cron-secret" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
  });
});
