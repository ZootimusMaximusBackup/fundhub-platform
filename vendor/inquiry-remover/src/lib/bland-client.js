"use strict";

/**
 * bland-client.js — Bland AI API Client
 *
 * Thin wrapper around the Bland AI REST API for outbound call operations.
 * No separate LLM/Agent setup needed — task (prompt) is sent per call.
 */

const BLAND_API_BASE = "https://api.bland.ai/v1";

function authHeaders() {
  return {
    Authorization: process.env.BLAND_API_KEY,
    "Content-Type": "application/json"
  };
}

async function blandFetch(path, options = {}) {
  const url = `${BLAND_API_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Bland API ${options.method || "GET"} ${path} failed: ${resp.status} ${text.substring(0, 300)}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// Call Operations
// ---------------------------------------------------------------------------

/**
 * Create an outbound call.
 *
 * @param {Object} params
 * @param {string} params.phoneNumber - Number to call (E.164)
 * @param {string} params.task - System prompt / instructions for the AI
 * @param {Object} [params.requestData] - Dynamic variables (available as {{key}} in task)
 * @param {string} [params.transferNumber] - Number for warm transfer
 * @param {string} [params.voice] - Voice ID (mason, david, josh, etc.)
 * @param {boolean} [params.waitForGreeting] - Wait for callee to speak first
 * @param {string} [params.dtmfSequence] - Pre-call DTMF digits
 * @param {string} [params.webhookUrl] - URL for call status webhooks
 * @param {Object} [params.metadata] - Custom metadata
 */
async function createCall({
  phoneNumber,
  task,
  requestData,
  transferNumber,
  voice,
  waitForGreeting = true,
  dtmfSequence,
  webhookUrl,
  metadata,
  maxDuration,
  firstSentence,
  amd,
  record
}) {
  const body = {
    phone_number: phoneNumber,
    task,
    wait_for_greeting: waitForGreeting
  };

  if (maxDuration) body.max_duration = maxDuration;
  if (firstSentence) body.first_sentence = firstSentence;
  if (amd) body.amd = amd;
  if (record) body.record = record;

  if (requestData) body.request_data = requestData;
  if (transferNumber) body.transfer_phone_number = transferNumber;
  if (voice) body.voice = voice;
  if (dtmfSequence) body.precall_dtmf_sequence = dtmfSequence;
  if (webhookUrl) body.webhook = webhookUrl;
  // TODO: Caller ID blocking (*67) — block_caller_id is NOT a real Bland AI parameter.
  // Chris needs to contact Bland AI support to enable anonymous outbound at the account level,
  // or use the `from` parameter with a Twilio number that has caller ID blocking enabled.
  if (metadata) body.metadata = metadata;

  console.log(`[bland-client] createCall to=${phoneNumber} webhook=${webhookUrl || "none"} voice=${voice || "default"}`);

  return blandFetch("/calls", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

/**
 * Get call details by ID.
 */
async function getCall(callId) {
  return blandFetch(`/calls/${callId}`);
}

/**
 * List all calls.
 */
async function listCalls() {
  return blandFetch("/calls");
}

/**
 * Get call transcript (corrected endpoint).
 */
async function getCallTranscript(callId) {
  const call = await getCall(callId);
  return call.transcripts || call.transcript || [];
}

/**
 * Stop an active call.
 */
async function stopCall(callId) {
  return blandFetch(`/calls/${callId}/stop`, {
    method: "POST"
  });
}

/**
 * Analyze a completed call.
 *
 * @param {string} callId
 * @param {string[]} questions - Questions to answer about the call
 */
async function analyzeCall(callId, questions) {
  return blandFetch(`/calls/${callId}/analyze`, {
    method: "POST",
    body: JSON.stringify({ questions })
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createCall,
  getCall,
  listCalls,
  getCallTranscript,
  stopCall,
  analyzeCall
};
