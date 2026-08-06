"use strict";

const handler = require("../../api/health");

function makeReq(method = "GET") {
  return { method, headers: {}, query: {} };
}
function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    }
  };
  return res;
}

describe("GET /api/health", () => {
  it("returns 405 on non-GET", async () => {
    const res = makeRes();
    await handler(makeReq("POST"), res);
    expect(res._status).toBe(405);
  });

  it("returns 200 with ok:true and service name", async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.service).toBe("inquiry-removal-ai");
    expect(typeof res._body.timestamp).toBe("string");
  });

  it("does NOT disclose env/config state to an unauthenticated caller", async () => {
    process.env.BLAND_API_KEY = "secret";
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._body.env).toBeUndefined();
    expect(res._body.envComplete).toBeUndefined();
    delete process.env.BLAND_API_KEY;
  });
});
