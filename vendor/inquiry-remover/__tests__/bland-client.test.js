"use strict";

// Mock global fetch before requiring the module
global.fetch = jest.fn();

// Set env var so the module picks it up on load
process.env.BLAND_API_KEY = "test-bland-key";

const bland = require("../src/lib/bland-client");

function mockFetchOk(jsonData) {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => jsonData,
    text: async () => JSON.stringify(jsonData)
  });
}

function mockFetchError(status, text = "Bad Request") {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("bland-client — createCall", () => {
  test("POSTs to /calls with required fields", async () => {
    mockFetchOk({ call_id: "call_abc123", status: "queued" });

    const result = await bland.createCall({
      phoneNumber: "+18005551234",
      task: "Navigate the IVR"
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bland.ai/v1/calls");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.phone_number).toBe("+18005551234");
    expect(body.task).toBe("Navigate the IVR");
    expect(body.wait_for_greeting).toBe(true);
  });

  test("includes optional fields when provided", async () => {
    mockFetchOk({ call_id: "call_xyz", status: "queued" });

    await bland.createCall({
      phoneNumber: "+18005551234",
      task: "Do stuff",
      requestData: { key: "val" },
      transferNumber: "+15550009999",
      voice: "mason",
      dtmfSequence: "1234",
      webhookUrl: "https://example.com/webhook",
      metadata: { case_id: "rec123" }
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.request_data).toEqual({ key: "val" });
    expect(body.transfer_phone_number).toBe("+15550009999");
    expect(body.voice).toBe("mason");
    expect(body.precall_dtmf_sequence).toBe("1234");
    expect(body.webhook).toBe("https://example.com/webhook");
    expect(body.metadata).toEqual({ case_id: "rec123" });
  });

  test("returns API response", async () => {
    const apiResponse = { call_id: "call_abc", status: "queued" };
    mockFetchOk(apiResponse);

    const result = await bland.createCall({ phoneNumber: "+1", task: "t" });
    expect(result).toEqual(apiResponse);
  });

  test("throws when API returns non-ok status", async () => {
    mockFetchError(400, "Invalid phone number");
    await expect(bland.createCall({ phoneNumber: "bad", task: "t" })).rejects.toThrow(
      "Bland API POST /calls failed: 400"
    );
  });
});

describe("bland-client — getCall", () => {
  test("GETs /calls/:callId", async () => {
    const callData = { call_id: "call_abc", status: "completed" };
    mockFetchOk(callData);

    const result = await bland.getCall("call_abc");

    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bland.ai/v1/calls/call_abc");
    expect(result).toEqual(callData);
  });

  test("throws on API error", async () => {
    mockFetchError(404, "Not found");
    await expect(bland.getCall("nonexistent")).rejects.toThrow("404");
  });
});

describe("bland-client — listCalls", () => {
  test("GETs /calls", async () => {
    mockFetchOk({ calls: [] });
    await bland.listCalls();
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bland.ai/v1/calls");
  });

  test("returns the API response", async () => {
    const data = { calls: [{ call_id: "c1" }] };
    mockFetchOk(data);
    const result = await bland.listCalls();
    expect(result).toEqual(data);
  });
});

describe("bland-client — getCallTranscript", () => {
  test("returns transcripts array when present", async () => {
    const transcripts = [{ user: "Hello", agent: "" }];
    mockFetchOk({ call_id: "c1", transcripts });

    const result = await bland.getCallTranscript("c1");
    expect(result).toEqual(transcripts);
  });

  test("falls back to transcript field when transcripts is absent", async () => {
    const transcript = [{ text: "Hello" }];
    mockFetchOk({ call_id: "c1", transcript });

    const result = await bland.getCallTranscript("c1");
    expect(result).toEqual(transcript);
  });

  test("returns empty array when neither field is present", async () => {
    mockFetchOk({ call_id: "c1" });
    const result = await bland.getCallTranscript("c1");
    expect(result).toEqual([]);
  });
});

describe("bland-client — stopCall", () => {
  test("POSTs to /calls/:callId/stop", async () => {
    mockFetchOk({ status: "stopped" });

    await bland.stopCall("call_abc");

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bland.ai/v1/calls/call_abc/stop");
    expect(options.method).toBe("POST");
  });

  test("throws on API error", async () => {
    mockFetchError(500, "Server error");
    await expect(bland.stopCall("call_abc")).rejects.toThrow("500");
  });
});

describe("bland-client — Authorization header", () => {
  test("sends BLAND_API_KEY as Authorization header", async () => {
    mockFetchOk({ call_id: "c1" });
    await bland.getCall("c1");
    const options = global.fetch.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("test-bland-key");
  });
});
