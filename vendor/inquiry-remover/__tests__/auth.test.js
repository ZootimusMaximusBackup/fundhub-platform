"use strict";

const { requireAuth } = require("../src/lib/auth");

function makeRes() {
  const res = {
    _status: null,
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

describe("requireAuth", () => {
  const ORIGINAL_ENV = process.env.API_SECRET;

  beforeEach(() => {
    process.env.API_SECRET = "test-secret-token";
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.API_SECRET;
    } else {
      process.env.API_SECRET = ORIGINAL_ENV;
    }
  });

  test("returns true when Bearer token matches API_SECRET", () => {
    const req = { headers: { authorization: "Bearer test-secret-token" } };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(true);
    expect(res._status).toBeNull();
  });

  test("returns false and sends 401 when Authorization header is missing", () => {
    const req = { headers: {} };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: "Unauthorized" });
  });

  test("returns false and sends 401 when token is wrong", () => {
    const req = { headers: { authorization: "Bearer wrong-token" } };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: "Unauthorized" });
  });

  test("returns false and sends 401 when only the secret value is passed without Bearer prefix", () => {
    const req = { headers: { authorization: "test-secret-token" } };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });

  test("returns false and sends 500 when API_SECRET env var is not set", () => {
    delete process.env.API_SECRET;
    const req = { headers: { authorization: "Bearer anything" } };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: "Server misconfigured" });
  });

  test("returns false and sends 401 when authorization header is null", () => {
    const req = { headers: { authorization: null } };
    const res = makeRes();
    const result = requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});
