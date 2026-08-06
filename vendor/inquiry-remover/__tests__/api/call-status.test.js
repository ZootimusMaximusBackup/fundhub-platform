"use strict";

jest.mock("../../src/lib/bland-client");
jest.mock("../../src/lib/auth");

const bland = require("../../src/lib/bland-client");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/call-status");

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

const MOCK_CALL = {
  call_id: "call_abc",
  queue_status: "completed",
  completed: true,
  call_length: 95,
  to: "+18883973742",
  from: "+15550001111",
  answered_by: "human",
  transferred_to: "+15550009999",
  summary: "Call transferred",
  metadata: { case_id: "recCASE1" }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.API_SECRET = "secret";
  requireAuth.mockReturnValue(true);
  bland.getCall.mockResolvedValue(MOCK_CALL);
});

describe("GET /api/call-status", () => {
  test("returns 405 for non-GET requests", async () => {
    const req = { method: "POST", headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body.error).toBe("Method not allowed");
  });

  test("returns auth failure result when requireAuth returns false", async () => {
    requireAuth.mockReturnValue(false);
    const req = { method: "GET", headers: {}, query: { call_id: "call_abc" } };
    const res = makeRes();
    await handler(req, res);
    expect(bland.getCall).not.toHaveBeenCalled();
  });

  test("returns 400 when call_id query param is missing", async () => {
    const req = { method: "GET", headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain("call_id");
  });

  test("returns 400 when query object is undefined", async () => {
    const req = { method: "GET", headers: {}, query: undefined };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  test("returns 200 with call data on success", async () => {
    const req = { method: "GET", headers: {}, query: { call_id: "call_abc" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.callId).toBe("call_abc");
    expect(res._body.status).toBe("completed");
    expect(res._body.completed).toBe(true);
    expect(res._body.callLength).toBe(95);
    expect(res._body.toNumber).toBe("+18883973742");
    expect(res._body.fromNumber).toBe("+15550001111");
    expect(res._body.answeredBy).toBe("human");
    expect(res._body.transferredTo).toBe("+15550009999");
    expect(res._body.summary).toBe("Call transferred");
    expect(res._body.metadata).toEqual({ case_id: "recCASE1" });
  });

  test("calls bland.getCall with the correct call_id", async () => {
    const req = { method: "GET", headers: {}, query: { call_id: "call_xyz" } };
    const res = makeRes();
    await handler(req, res);
    expect(bland.getCall).toHaveBeenCalledWith("call_xyz");
  });

  test("returns in_progress status when queue_status absent and completed=false", async () => {
    bland.getCall.mockResolvedValue({ call_id: "call_abc", completed: false });
    const req = { method: "GET", headers: {}, query: { call_id: "call_abc" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._body.status).toBe("in_progress");
  });

  test("returns 500 when bland.getCall throws", async () => {
    bland.getCall.mockRejectedValue(new Error("Bland API failure"));
    const req = { method: "GET", headers: {}, query: { call_id: "call_abc" } };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.ok).toBe(false);
  });

  test("returns null for optional fields when not present in call data", async () => {
    bland.getCall.mockResolvedValue({
      call_id: "call_minimal",
      completed: true
    });
    const req = { method: "GET", headers: {}, query: { call_id: "call_minimal" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._body.callLength).toBeNull();
    expect(res._body.answeredBy).toBeNull();
    expect(res._body.transferredTo).toBeNull();
    expect(res._body.summary).toBeNull();
    expect(res._body.metadata).toBeNull();
  });
});
