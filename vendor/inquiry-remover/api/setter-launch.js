"use strict";

/**
 * POST /api/setter-launch
 *
 * Launches an outbound setter call via Bland AI to a lead.
 *
 * Request body:
 * {
 *   "contactId": "ghl_contact_id",     // GHL contact ID (required)
 *   "firstName": "John",                // Lead first name (required)
 *   "lastName": "Doe",                  // Lead last name
 *   "phone": "+1xxxxxxxxxx",            // Lead phone (required, E.164)
 *   "calendarId": "cal_xxx",            // GHL calendar ID (optional, overrides env)
 *   "repName": "Chris"                  // Rep name for personalization
 * }
 */

const bland = require("../src/lib/bland-client");
const { buildSetterCallConfig } = require("../src/agents/setter-prompt");
const { requireAuth } = require("../src/lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) return;

  if (!process.env.BLAND_API_KEY) {
    return res.status(500).json({ error: "BLAND_API_KEY not configured" });
  }

  const { contactId, firstName, lastName, phone, calendarId, repName } = req.body || {};

  if (!contactId) {
    return res.status(400).json({ error: "contactId is required" });
  }
  if (!firstName) {
    return res.status(400).json({ error: "firstName is required" });
  }
  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  try {
    const requestData = {
      lead_first_name: firstName,
      lead_last_name: lastName || "",
      lead_phone: phone,
      rep_name: repName || "our credit specialist",
      company_name: "FundHub",
      contact_id: contactId,
      calendar_id: calendarId || process.env.GHL_CALENDAR_ID || "",
      transfer_number: process.env.FUNDHUB_REP_NUMBER || ""
    };

    const metadata = {
      contact_id: contactId,
      call_type: "setter",
      initiated_at: new Date().toISOString()
    };

    const callConfig = buildSetterCallConfig(requestData, { metadata });
    const call = await bland.createCall(callConfig);

    console.log(`[setter-launch] Call launched: call_id=${call.call_id} contact=${contactId}`);

    return res.status(200).json({
      ok: true,
      callId: call.call_id,
      status: call.status || "queued",
      contactId,
      metadata
    });
  } catch (err) {
    console.error("[setter-launch] Error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};
