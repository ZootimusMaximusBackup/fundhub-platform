"use strict";

/**
 * setter-webhook-cadence.test.js
 *
 * Integration tests verifying that setter-webhook.js correctly triggers
 * triggerOutboundCadence (no_answer/voicemail) and triggerThreeWayHandoff
 * (confirmed) via the setter-outbound-cadence module.
 *
 * Kept in a separate file from setter-outbound-cadence.test.js so that
 * top-level jest.mock() hoisting works correctly for all mocked modules.
 */

jest.mock("../../src/lib/ghl-client");
jest.mock("../../src/lib/bland-client");
jest.mock("../../src/agents/setter-prompt");
jest.mock("../../src/lib/setter-outbound-cadence");

const ghl = require("../../src/lib/ghl-client");
const bland = require("../../src/lib/bland-client");
const { SETTER_ANALYSIS_QUESTIONS } = require("../../src/agents/setter-prompt");
const cadence = require("../../src/lib/setter-outbound-cadence");
const handler = require("../../api/setter-webhook");

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json = (b) => { res._body = b; return res; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BLAND_WEBHOOK_SECRET;

  ghl.isConfigured = jest.fn().mockReturnValue(false);
  ghl.updateContactCustomFields = jest.fn().mockResolvedValue({});
  ghl.addContactNote = jest.fn().mockResolvedValue({});
  ghl.addContactTags = jest.fn().mockResolvedValue({});
  bland.analyzeCall = jest.fn().mockResolvedValue({ answers: {} });

  cadence.triggerOutboundCadence = jest.fn().mockResolvedValue({
    ok: true,
    doubleDial: { ok: true },
    smsCadence: { ok: true }
  });
  cadence.triggerThreeWayHandoff = jest.fn().mockResolvedValue({ ok: true });
});

describe("setter-webhook → cadence wiring", () => {
  test("triggers outbound cadence on no_answer outcome", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "call_x",
        status: "no-answer",
        metadata: {
          ghl_contact_id: "ghl_1",
          first_name: "Jane",
          prequal_amount: "80000",
          appointment_time: "2026-04-15T14:00:00Z",
          closer_name: "Chris"
        }
      }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res._body.outcome).toBe("no_answer");
    expect(cadence.triggerOutboundCadence).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "ghl_1",
        firstName: "Jane",
        prequalAmount: "80000",
        closerName: "Chris",
        triggerReason: "no_answer",
        originalCallId: "call_x"
      })
    );
    expect(cadence.triggerThreeWayHandoff).not.toHaveBeenCalled();
  });

  test("triggers outbound cadence on voicemail outcome", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "call_v",
        status: "completed",
        answered_by: "voicemail",
        metadata: {
          ghl_contact_id: "ghl_2",
          first_name: "Bob",
          prequal_amount: "50000"
        }
      }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res._body.outcome).toBe("voicemail");
    expect(cadence.triggerOutboundCadence).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "ghl_2",
        firstName: "Bob",
        triggerReason: "voicemail"
      })
    );
    expect(cadence.triggerThreeWayHandoff).not.toHaveBeenCalled();
  });

  test("triggers 3-way handoff on confirmed outcome", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "call_c",
        status: "completed",
        completed: true,
        call_length: 120,
        summary: "Lead confirmed their appointment",
        metadata: {
          ghl_contact_id: "ghl_3",
          first_name: "Amy",
          prequal_amount: "95000",
          appointment_time: "2026-04-15T14:00:00Z",
          closer_name: "Mike",
          zoom_link: "https://zoom.us/j/999"
        }
      }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res._body.outcome).toBe("confirmed");
    expect(cadence.triggerThreeWayHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "ghl_3",
        firstName: "Amy",
        prequalAmount: "95000",
        closerName: "Mike",
        zoomLink: "https://zoom.us/j/999"
      })
    );
    expect(cadence.triggerOutboundCadence).not.toHaveBeenCalled();
  });

  test("does NOT trigger cadence or handoff on failed outcome", async () => {
    const req = {
      method: "POST", headers: {},
      body: { call_id: "call_f", status: "failed", metadata: { ghl_contact_id: "ghl_4" } }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(cadence.triggerOutboundCadence).not.toHaveBeenCalled();
    expect(cadence.triggerThreeWayHandoff).not.toHaveBeenCalled();
  });

  test("does NOT trigger cadence or handoff on reschedule outcome", async () => {
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "call_r",
        status: "completed",
        completed: true,
        call_length: 90,
        summary: "Lead asked to reschedule for next week",
        metadata: { ghl_contact_id: "ghl_5" }
      }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(cadence.triggerOutboundCadence).not.toHaveBeenCalled();
    expect(cadence.triggerThreeWayHandoff).not.toHaveBeenCalled();
  });

  test("still returns 200 if triggerOutboundCadence rejects", async () => {
    cadence.triggerOutboundCadence.mockRejectedValue(new Error("Cadence error"));
    const req = {
      method: "POST", headers: {},
      body: { call_id: "call_e", status: "no-answer", metadata: { ghl_contact_id: "ghl_6" } }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  test("still returns 200 if triggerThreeWayHandoff rejects", async () => {
    cadence.triggerThreeWayHandoff.mockRejectedValue(new Error("Handoff error"));
    const req = {
      method: "POST", headers: {},
      body: {
        call_id: "call_h",
        status: "completed",
        completed: true,
        call_length: 120,
        summary: "Lead confirmed the appointment",
        metadata: { ghl_contact_id: "ghl_7", first_name: "Tim" }
      }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  test("does not trigger cadence when ghl_contact_id is missing from metadata", async () => {
    const req = {
      method: "POST", headers: {},
      body: { call_id: "call_n", status: "no-answer", metadata: {} }
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    // No contact_id → entire GHL block skipped including cadence
    expect(cadence.triggerOutboundCadence).not.toHaveBeenCalled();
    expect(cadence.triggerThreeWayHandoff).not.toHaveBeenCalled();
  });
});
