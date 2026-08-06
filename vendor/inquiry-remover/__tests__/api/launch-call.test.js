"use strict";

// Mock dependencies before importing the handler
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/lib/packet-builder");
jest.mock("../../src/agents/experian-prompt");
jest.mock("../../src/agents/equifax-prompt");
jest.mock("../../src/agents/transunion-prompt");
jest.mock("../../src/lib/auth");

const bland = require("../../src/lib/bland-client");
const { buildCallPacket, buildCallMetadata } = require("../../src/lib/packet-builder");
const { buildExperianCallConfig } = require("../../src/agents/experian-prompt");
const { buildEquifaxCallConfig } = require("../../src/agents/equifax-prompt");
const { buildTransUnionCallConfig } = require("../../src/agents/transunion-prompt");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/launch-call");

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

const VALID_CLIENT_DATA = {
  firstName: "Jane",
  lastName: "Smith",
  ssn: "987654321",
  address: { zip: "10001" }
};

const BASE_REQ = {
  method: "POST",
  headers: { authorization: "Bearer secret" },
  body: {
    clientData: VALID_CLIENT_DATA,
    inquiries: [],
    transferNumber: "+15550009999",
    clientId: "recABC"
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BLAND_API_KEY = "test-bland-key";
  process.env.API_SECRET = "secret";

  // Default: auth passes
  requireAuth.mockReturnValue(true);

  // Default mock implementations
  buildCallPacket.mockReturnValue({ client_first_name: "Jane" });
  buildCallMetadata.mockReturnValue({ client_id: "recABC", bureau: "EX" });
  buildExperianCallConfig.mockReturnValue({ phoneNumber: "+18883973742", task: "..." });
  buildEquifaxCallConfig.mockReturnValue({ phoneNumber: "+18665495097", task: "..." });
  buildTransUnionCallConfig.mockReturnValue({ phoneNumber: "+18009168800", task: "..." });
  bland.createCall.mockResolvedValue({ call_id: "call_123", status: "queued" });
});

describe("POST /api/launch-call", () => {
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

  test("returns 400 when clientData is missing", async () => {
    const req = { ...BASE_REQ, body: { inquiries: [] } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("clientData");
  });

  test("returns 400 when transferNumber is missing and FUNDHUB_REP_NUMBER env not set", async () => {
    delete process.env.FUNDHUB_REP_NUMBER;
    const req = { ...BASE_REQ, body: { clientData: VALID_CLIENT_DATA } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("transferNumber");
  });

  test("returns 200 with call info on successful launch (default EX)", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.callId).toBe("call_123");
    expect(res._body.bureau).toBe("EX");
    expect(buildExperianCallConfig).toHaveBeenCalled();
  });

  test("calls buildCallPacket with clientData, inquiries, transferNumber, and bureau", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(buildCallPacket).toHaveBeenCalledWith(
      VALID_CLIENT_DATA,
      [],
      "+15550009999",
      "EX"
    );
  });

  test("routes to Equifax when bureau=EQ", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, bureau: "EQ" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.bureau).toBe("EQ");
    expect(buildEquifaxCallConfig).toHaveBeenCalled();
    expect(buildExperianCallConfig).not.toHaveBeenCalled();
  });

  test("routes to TransUnion when bureau=TU", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, bureau: "TU" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.bureau).toBe("TU");
    expect(buildTransUnionCallConfig).toHaveBeenCalled();
    expect(buildExperianCallConfig).not.toHaveBeenCalled();
  });

  test("accepts lowercase bureau param", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, bureau: "eq" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.bureau).toBe("EQ");
  });

  test("returns 400 for invalid bureau", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, bureau: "XX" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toContain("Invalid bureau");
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

  test("returns 500 when buildCallPacket throws (e.g. missing SSN)", async () => {
    buildCallPacket.mockImplementation(() => {
      throw new Error("Valid 9-digit SSN is required");
    });
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
  });

  test("uses FUNDHUB_REP_NUMBER env var when transferNumber not in body", async () => {
    process.env.FUNDHUB_REP_NUMBER = "+15550008888";
    const req = {
      ...BASE_REQ,
      body: { clientData: VALID_CLIENT_DATA, inquiries: [] }
    };
    const res = makeRes();
    await handler(req, res);

    expect(buildCallPacket).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "+15550008888",
      "EX"
    );
    delete process.env.FUNDHUB_REP_NUMBER;
  });
});
