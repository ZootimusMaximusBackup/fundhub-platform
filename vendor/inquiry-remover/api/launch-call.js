"use strict";

/**
 * POST /api/launch-call
 *
 * Launches an outbound dispute call via Bland AI to any bureau.
 *
 * Request body:
 * {
 *   "bureau": "EX" | "EQ" | "TU",   (default: "EX")
 *   "clientData": { firstName, middleName, lastName, ssn, dob, phone, address: { line1, city, state, zip } },
 *   "inquiries": [{ creditorName, date }],
 *   "transferNumber": "+1xxxxxxxxxx",
 *   "clientId": "airtable_record_id"
 * }
 */

const bland = require("../src/lib/bland-client");
const { buildCallPacket, buildCallMetadata } = require("../src/lib/packet-builder");
const { resolveSex, pickVoice } = require("../src/lib/client-sex");
const { buildExperianCallConfig } = require("../src/agents/experian-prompt");
const { buildEquifaxCallConfig } = require("../src/agents/equifax-prompt");
const { buildTransUnionCallConfig } = require("../src/agents/transunion-prompt");
const { requireAuth } = require("../src/lib/auth");

const BUREAU_CONFIGS = {
  EX: buildExperianCallConfig,
  EQ: buildEquifaxCallConfig,
  TU: buildTransUnionCallConfig
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) return;

  if (!process.env.BLAND_API_KEY) {
    return res.status(500).json({ error: "BLAND_API_KEY not configured" });
  }

  const { clientData, inquiries, transferNumber, clientId, bureau: rawBureau } = req.body || {};
  const bureau = (rawBureau || "EX").toUpperCase();

  if (!BUREAU_CONFIGS[bureau]) {
    return res.status(400).json({ error: `Invalid bureau: ${rawBureau}. Must be EX, EQ, or TU.` });
  }

  if (!clientData) {
    return res.status(400).json({ error: "clientData is required" });
  }

  const transfer = transferNumber || process.env.FUNDHUB_REP_NUMBER;
  if (!transfer) {
    return res.status(400).json({ error: "transferNumber is required (or set FUNDHUB_REP_NUMBER env var)" });
  }

  try {
    // Build the call packet (dynamic variables for the agent)
    const requestData = buildCallPacket(clientData, inquiries || [], transfer, bureau);
    const metadata = buildCallMetadata(clientId || "unknown", bureau);

    // Build Bland AI call config from bureau-specific prompt template
    const buildConfig = BUREAU_CONFIGS[bureau];
    // Gendered voice (see schedule-call): env-configured, neutral default until set.
    const voice = pickVoice(resolveSex(clientData.sex, clientData.firstName));
    const callConfig = buildConfig(requestData, { metadata, voice });

    // Launch the call via Bland AI
    const call = await bland.createCall(callConfig);

    return res.status(200).json({
      ok: true,
      callId: call.call_id,
      status: call.status || "queued",
      bureau,
      metadata
    });
  } catch (err) {
    console.error(`Launch call failed (${bureau}):`, err.message);
    return res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
};
