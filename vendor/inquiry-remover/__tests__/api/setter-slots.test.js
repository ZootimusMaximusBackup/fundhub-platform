"use strict";

jest.mock("../../src/lib/ghl-client");
jest.mock("../../src/lib/auth");

const ghl = require("../../src/lib/ghl-client");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/setter-slots");

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
    calendar_id: "cal_123",
    preference: "any"
  }
};

// Build slot data for next 7 days (using real future dates)
function buildMockSlots() {
  const slots = {};
  const now = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const dateKey = d.toISOString().split("T")[0];
    // Morning slot at 10am ET, afternoon slot at 2pm ET
    const morning = new Date(d);
    morning.setHours(10, 0, 0, 0);
    const afternoon = new Date(d);
    afternoon.setHours(14, 0, 0, 0);
    slots[dateKey] = [morning.toISOString(), afternoon.toISOString()];
  }
  return slots;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.API_SECRET = "secret";
  delete process.env.GHL_CALENDAR_ID;

  requireAuth.mockReturnValue(true);
  ghl.isConfigured = jest.fn().mockReturnValue(true);
  ghl.getFreeSlots = jest.fn().mockResolvedValue({ slots: buildMockSlots() });
});

describe("POST /api/setter-slots", () => {
  // ---- Method & auth ----

  test("returns 405 for non-POST requests", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body.error).toBe("Method not allowed");
  });

  test("returns auth failure when requireAuth returns false", async () => {
    requireAuth.mockReturnValue(false);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);
    expect(ghl.getFreeSlots).not.toHaveBeenCalled();
  });

  // ---- No calendar fallback ----

  test("returns verbal fallback when no calendarId and no GHL_CALENDAR_ID env", async () => {
    const req = { ...BASE_REQ, body: { preference: "any" } };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.available_slots).toContain("don't have the scheduling system");
  });

  test("uses GHL_CALENDAR_ID env when calendar_id not in body", async () => {
    process.env.GHL_CALENDAR_ID = "env_cal_456";
    const req = { ...BASE_REQ, body: { preference: "any" } };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.getFreeSlots).toHaveBeenCalledWith(
      "env_cal_456",
      expect.any(String),
      expect.any(String)
    );
    delete process.env.GHL_CALENDAR_ID;
  });

  // ---- GHL not configured fallback ----

  test("returns fallback when ghl.isConfigured() returns false", async () => {
    ghl.isConfigured.mockReturnValue(false);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.available_slots).toContain("temporarily unavailable");
    expect(ghl.getFreeSlots).not.toHaveBeenCalled();
  });

  // ---- Happy path ----

  test("returns formatted slots on success", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(typeof res._body.available_slots).toBe("string");
    expect(res._body.available_slots.length).toBeGreaterThan(0);
    // Should contain day names
    expect(res._body.available_slots).toMatch(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  });

  test("passes calendar_id from body to ghl.getFreeSlots", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.getFreeSlots).toHaveBeenCalledWith(
      "cal_123",
      expect.any(String),
      expect.any(String)
    );
  });

  test("limits to 3 slot options", async () => {
    // Build lots of slots
    const manySlots = {};
    const now = new Date();
    for (let i = 1; i <= 7; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const dateKey = d.toISOString().split("T")[0];
      const times = [];
      for (let h = 9; h <= 16; h++) {
        const t = new Date(d);
        t.setHours(h, 0, 0, 0);
        times.push(t.toISOString());
      }
      manySlots[dateKey] = times;
    }
    ghl.getFreeSlots.mockResolvedValue({ slots: manySlots });

    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    // Count commas — 3 items = 2 commas
    const commaCount = (res._body.available_slots.match(/,/g) || []).length;
    expect(commaCount).toBe(2);
  });

  // ---- Preference filtering ----

  test("filters to morning slots when preference is 'morning'", async () => {
    // Only afternoon slots available (2pm)
    const afternoonOnly = {};
    const d = new Date(Date.now() + 86400000);
    const dateKey = d.toISOString().split("T")[0];
    const afternoon = new Date(d);
    afternoon.setHours(14, 0, 0, 0);
    afternoonOnly[dateKey] = [afternoon.toISOString()];
    ghl.getFreeSlots.mockResolvedValue({ slots: afternoonOnly });

    const req = { ...BASE_REQ, body: { calendar_id: "cal_123", preference: "morning" } };
    const res = makeRes();
    await handler(req, res);

    // Should get the "booked this week" fallback since no morning slots
    expect(res._body.available_slots).toContain("booked this week");
  });

  test("defaults preference to 'any' when not provided", async () => {
    const req = { ...BASE_REQ, body: { calendar_id: "cal_123" } };
    const res = makeRes();
    await handler(req, res);

    // Should succeed and return slots
    expect(res._status).toBe(200);
    expect(res._body.available_slots).toMatch(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  });

  // ---- Empty / error handling ----

  test("returns 'booked this week' message when no slots available", async () => {
    ghl.getFreeSlots.mockResolvedValue({ slots: {} });
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.available_slots).toContain("booked this week");
  });

  test("returns fallback message when ghl.getFreeSlots throws", async () => {
    ghl.getFreeSlots.mockRejectedValue(new Error("GHL API error"));
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.available_slots).toContain("trouble checking the calendar");
  });

  test("handles slotsData without .slots wrapper", async () => {
    // Some GHL responses return flat object
    const flatSlots = buildMockSlots();
    ghl.getFreeSlots.mockResolvedValue(flatSlots);

    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.available_slots).toMatch(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  });
});
