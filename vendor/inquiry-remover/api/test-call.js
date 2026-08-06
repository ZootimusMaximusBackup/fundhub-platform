"use strict";

/**
 * POST /api/test-call
 *
 * Simple test endpoint — launches a Bland AI call using the pre-configured
 * test client in Airtable.
 *
 * Body: { bureau: "EX"|"EQ"|"TU", phone: "+1..." }
 */

const airtable = require("../src/lib/airtable-client");
const bland = require("../src/lib/bland-client");
const { buildCallPacket, buildCallMetadata, extractClientData } = require("../src/lib/packet-builder");
const { buildExperianCallConfig } = require("../src/agents/experian-prompt");
const { buildEquifaxCallConfig } = require("../src/agents/equifax-prompt");
const { buildTransUnionCallConfig } = require("../src/agents/transunion-prompt");

const BUREAU_CONFIGS = {
  EX: buildExperianCallConfig,
  EQ: buildEquifaxCallConfig,
  TU: buildTransUnionCallConfig,
};

const BUREAU_NAMES = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" };

// Test client records in Airtable (FUNDHUB MATRIX)
const TEST_PII_RECORD = "recbkULA5vvRKqLdz";
const TEST_CLIENT_RECORD = "rec6mxe7hUW16wnRU";
const PII_IDENTITY_TABLE = "tblRwLZR7uHDRb0LW";
const CLIENTS_TABLE = "tblmSXx3cL7g43Eyi";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const secret = process.env.API_SECRET;
  if (secret) {
    const provided = req.headers["x-api-secret"] || req.headers["authorization"]?.replace("Bearer ", "") || "";
    if (provided !== secret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const { bureau, phone } = req.body || {};

  // Validate inputs
  const bureauKey = (bureau || "").toUpperCase();
  if (!BUREAU_CONFIGS[bureauKey]) {
    return res.status(400).json({ ok: false, error: "Invalid bureau. Use EX, EQ, or TU" });
  }
  const transferPhone = (phone || "").trim();
  if (!transferPhone || transferPhone.length < 10) {
    return res.status(400).json({ ok: false, error: "Valid phone number required" });
  }

  try {
    // Fetch test client PII from Airtable
    const [piiRecord, clientRecord] = await Promise.all([
      airtable.getRecord(PII_IDENTITY_TABLE, TEST_PII_RECORD),
      airtable.getRecord(CLIENTS_TABLE, TEST_CLIENT_RECORD),
    ]);

    const clientData = extractClientData(piiRecord.fields, clientRecord.fields);

    if (!clientData.ssn) {
      return res.status(500).json({ ok: false, error: "Test client SSN not found in Airtable" });
    }

    // Build call packet and config
    const requestData = buildCallPacket(clientData, [], transferPhone, bureauKey);
    const metadata = buildCallMetadata(TEST_CLIENT_RECORD, bureauKey, `test_${Date.now()}`);
    metadata.test_call = true;

    const buildConfig = BUREAU_CONFIGS[bureauKey];
    const callConfig = buildConfig(requestData, { metadata });

    // Launch the call
    const call = await bland.createCall(callConfig);

    console.log(`[test-call] Launched ${BUREAU_NAMES[bureauKey]} test call: ${call.call_id}, transfer → ${transferPhone}`);

    return res.status(200).json({
      ok: true,
      call_id: call.call_id,
      bureau: BUREAU_NAMES[bureauKey],
      transfer_to: transferPhone,
      message: `${BUREAU_NAMES[bureauKey]} call launched! Your phone will ring when the AI reaches a rep.`,
    });
  } catch (err) {
    console.error("[test-call] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
