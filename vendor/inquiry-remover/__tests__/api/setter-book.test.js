"use strict";

jest.mock("../../src/lib/ghl-client");
jest.mock("../../src/lib/auth");

const ghl = require("../../src/lib/ghl-client");
const { requireAuth } = require("../../src/lib/auth");

const handler = require("../../api/setter-book");

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
    contact_id: "ghl_contact_1",
    selected_time: "2026-04-02T14:00:00.000Z",
    lead_name: "John Doe"
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.API_SECRET = "secret";
  delete process.env.GHL_CALENDAR_ID;

  requireAuth.mockReturnValue(true);
  ghl.isConfigured = jest.fn().mockReturnValue(true);
  ghl.createAppointment = jest.fn().mockResolvedValue({ id: "appt_123" });
});

describe("POST /api/setter-book", () => {
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
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  // ---- No calendar fallback ----

  test("returns verbal fallback when no calendarId and no GHL_CALENDAR_ID env", async () => {
    const req = {
      ...BASE_REQ,
      body: { contact_id: "ghl_1", selected_time: "2026-04-02T14:00:00.000Z" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("booking system is not set up");
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  test("uses GHL_CALENDAR_ID env when calendar_id not in body", async () => {
    process.env.GHL_CALENDAR_ID = "env_cal_789";
    const req = {
      ...BASE_REQ,
      body: { contact_id: "ghl_1", selected_time: "2026-04-02T14:00:00.000Z" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "env_cal_789" })
    );
    delete process.env.GHL_CALENDAR_ID;
  });

  // ---- Missing field fallbacks ----

  test("returns fallback when contact_id is missing", async () => {
    const req = {
      ...BASE_REQ,
      body: { calendar_id: "cal_123", selected_time: "2026-04-02T14:00:00.000Z" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("couldn't identify the contact");
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  test("returns fallback when selected_time is missing", async () => {
    const req = {
      ...BASE_REQ,
      body: { calendar_id: "cal_123", contact_id: "ghl_1" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("No time was selected");
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  // ---- GHL not configured fallback ----

  test("returns fallback when ghl.isConfigured() returns false", async () => {
    ghl.isConfigured.mockReturnValue(false);
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("temporarily unavailable");
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  // ---- Happy path with ISO time ----

  test("returns appointment confirmation for valid ISO time", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("Appointment confirmed");
    expect(res._body.appointment_id).toBe("appt_123");
  });

  test("calls ghl.createAppointment with correct params", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "cal_123",
        contactId: "ghl_contact_1",
        startTime: expect.any(String),
        endTime: expect.any(String),
        title: "FundHub Credit Consultation — John Doe"
      })
    );
  });

  test("endTime is 30 minutes after startTime", async () => {
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    const callArgs = ghl.createAppointment.mock.calls[0][0];
    const start = new Date(callArgs.startTime).getTime();
    const end = new Date(callArgs.endTime).getTime();
    expect(end - start).toBe(30 * 60000); // 30 minutes
  });

  test("defaults lead_name to 'Lead' when not provided", async () => {
    const req = {
      ...BASE_REQ,
      body: { calendar_id: "cal_123", contact_id: "ghl_1", selected_time: "2026-04-02T14:00:00.000Z" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(ghl.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ title: "FundHub Credit Consultation — Lead" })
    );
  });

  // ---- Time parsing — natural language ----

  test("parses 'Tuesday at 2pm' as a valid time", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, selected_time: "Tuesday at 2pm" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("Appointment confirmed");
    expect(ghl.createAppointment).toHaveBeenCalled();
  });

  test("parses 'tomorrow at 10am' as a valid time", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, selected_time: "tomorrow at 10am" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("Appointment confirmed");
  });

  test("parses 'today 3pm' as a valid time", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, selected_time: "today 3pm" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("Appointment confirmed");
  });

  test("parses 'Wednesday at 11:30 AM' as a valid time", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, selected_time: "Wednesday at 11:30 AM" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("Appointment confirmed");
  });

  // ---- Unparseable time fallback ----

  test("returns verbal fallback for unparseable time string", async () => {
    const req = {
      ...BASE_REQ,
      body: { ...BASE_REQ.body, selected_time: "sometime next week maybe" }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("couldn't parse that time");
    expect(ghl.createAppointment).not.toHaveBeenCalled();
  });

  // ---- GHL error fallback ----

  test("returns verbal fallback when ghl.createAppointment throws", async () => {
    ghl.createAppointment.mockRejectedValue(new Error("GHL API error"));
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.confirmation).toContain("issue booking the appointment");
  });

  test("returns appointment_id as null when GHL response has no id", async () => {
    ghl.createAppointment.mockResolvedValue({});
    const req = { ...BASE_REQ };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.appointment_id).toBeNull();
  });
});
