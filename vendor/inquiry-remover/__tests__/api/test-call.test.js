"use strict";

jest.mock("../../src/lib/airtable-client");
jest.mock("../../src/lib/bland-client");

const handler = require("../../api/test-call");
const airtable = require("../../src/lib/airtable-client");
const bland = require("../../src/lib/bland-client");

function mockReqRes(body = {}, method = "POST") {
  const req = { method, body, headers: {} };
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  return { req, res };
}

const TEST_PII = {
  fields: {
    owner_first_name: "Chris",
    owner_last_name: "Stanbridge",
    ssn_full: "123-45-6789",
    dob: "01/15/1985",
    phone: "+15551234567",
    street1: "100 Main St",
    city: "Miami",
    state: "FL",
    zip: "33101",
  },
};

const TEST_CLIENT = {
  fields: { phone: "+15551234567" },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FUNDHUB_REP_NUMBER = "+15559999999";
  airtable.getRecord.mockImplementation((table, id) => {
    if (id === "recbkULA5vvRKqLdz") return Promise.resolve(TEST_PII);
    if (id === "rec6mxe7hUW16wnRU") return Promise.resolve(TEST_CLIENT);
    return Promise.reject(new Error("Unknown record"));
  });
  bland.createCall.mockResolvedValue({ call_id: "test-call-123" });
});

describe("POST /api/test-call", () => {
  test("rejects non-POST", async () => {
    const { req, res } = mockReqRes({}, "GET");
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  test("rejects invalid bureau", async () => {
    const { req, res } = mockReqRes({ bureau: "XX", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  test("rejects missing phone", async () => {
    const { req, res } = mockReqRes({ bureau: "EX", phone: "" });
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  test("launches Experian call successfully", async () => {
    const { req, res } = mockReqRes({ bureau: "EX", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.call_id).toBe("test-call-123");
    expect(res._json.bureau).toBe("Experian");
    expect(bland.createCall).toHaveBeenCalledTimes(1);
  });

  test("launches Equifax call successfully", async () => {
    const { req, res } = mockReqRes({ bureau: "EQ", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.bureau).toBe("Equifax");
  });

  test("launches TransUnion call successfully", async () => {
    const { req, res } = mockReqRes({ bureau: "TU", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.bureau).toBe("TransUnion");
  });

  test("handles Airtable error", async () => {
    airtable.getRecord.mockRejectedValue(new Error("Airtable down"));
    const { req, res } = mockReqRes({ bureau: "EX", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._json.ok).toBe(false);
  });

  test("handles missing SSN", async () => {
    airtable.getRecord.mockImplementation((table, id) => {
      if (id === "recbkULA5vvRKqLdz") return Promise.resolve({ fields: { ...TEST_PII.fields, ssn_full: "" } });
      return Promise.resolve(TEST_CLIENT);
    });
    const { req, res } = mockReqRes({ bureau: "EX", phone: "+15551111111" });
    await handler(req, res);
    expect(res._status).toBe(500);
  });

  test("passes phone as transfer number", async () => {
    const { req, res } = mockReqRes({ bureau: "EX", phone: "+15559876543" });
    await handler(req, res);
    expect(res._json.transfer_to).toBe("+15559876543");
    const callConfig = bland.createCall.mock.calls[0][0];
    expect(callConfig.requestData.transfer_number).toBe("+15559876543");
  });
});
