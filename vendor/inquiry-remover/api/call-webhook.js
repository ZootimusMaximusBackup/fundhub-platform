"use strict";

/**
 * POST /api/call-webhook
 *
 * Receives webhook events from Bland AI after calls.
 * Bland sends a single webhook POST when the call completes.
 *
 * Updates:
 * 1. Airtable INQUIRY_REMOVAL_CASES — case_status, ai_call_status, remover_notes
 * 2. GHL contact — ai_call_master_status, ai_transfer_status custom fields + activity note
 *
 * Case status mapping by outcome:
 *   transferred / reached_human → "Awaiting Remover" (human takes over)
 *   no_answer / busy           → "Call Failed"       (retryable)
 *   failed / unknown           → "Call Failed"       (needs investigation)
 *   left_voicemail             → "Call Failed"       (retryable)
 *   completed_short            → "Call Failed"       (IVR likely hung up)
 *
 * The AI caller must NOT mark the case Completed — that's the human remover's job.
 *
 * Bland webhook payload:
 * {
 *   "call_id": "...",
 *   "status": "completed" | "no-answer" | "busy" | "failed" | "voicemail",
 *   "completed": true/false,
 *   "call_length": 123.4,  (seconds)
 *   "to": "+1...",
 *   "from": "+1...",
 *   "transcripts": [{ user: "...", agent: "...", ... }],
 *   "summary": "...",
 *   "metadata": { case_id, ghl_contact_id, client_id, bureau, ... },
 *   "answered_by": "human" | "voicemail",
 *   "transferred_to": "+1..." (if transfer happened)
 * }
 */

const bland = require("../src/lib/bland-client");
const { EXPERIAN_ANALYSIS_QUESTIONS } = require("../src/agents/experian-prompt");

const INQUIRY_REMOVAL_CASES_TABLE = "tblYOliwtT0RETm2S";

// Outcomes that mean the call progressed far enough to hand off to a human
const HANDOFF_OUTCOMES = new Set(["transferred", "reached_human"]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // -------------------------------------------------------------------------
  // Webhook signature verification
  // -------------------------------------------------------------------------
  const webhookSecret = process.env.BLAND_WEBHOOK_SECRET;
  if (webhookSecret) {
    const crypto = require("crypto");
    const signature = req.headers["x-webhook-signature"] || "";
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (signature !== expected) {
      console.error("[call-webhook] Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  } else {
    console.warn("[call-webhook] BLAND_WEBHOOK_SECRET not set — signature verification disabled");
  }

  const payload = req.body;
  if (!payload || !payload.call_id) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  const {
    call_id,
    status,
    completed,
    call_length,
    transcripts,
    summary,
    metadata,
    answered_by,
    transferred_to
  } = payload;

  console.log(`[webhook] call_id=${call_id}, status=${status}, completed=${completed}, length=${call_length}s`);

  if (transferred_to) {
    console.log(`[webhook] transferred_to=${transferred_to}`);
  }

  if (summary) {
    console.log(`[webhook] summary=${summary}`);
  }

  // Determine call outcome
  const outcome = determineOutcome(payload);
  const caseStatus = HANDOFF_OUTCOMES.has(outcome) ? "Awaiting Remover" : "Call Failed";
  console.log(`[webhook] outcome=${outcome}, case_status=${caseStatus}`);

  // Extract IDs from metadata
  const caseId = metadata?.case_id;
  const ghlContactId = metadata?.ghl_contact_id;

  // -------------------------------------------------------------------------
  // 1. Update Airtable INQUIRY_REMOVAL_CASES
  // -------------------------------------------------------------------------
  if (caseId && process.env.AIRTABLE_API_KEY) {
    try {
      await updateCaseAfterCall(caseId, {
        call_id,
        outcome,
        caseStatus,
        summary,
        transcripts,
        call_length,
        transferred_to
      });
      console.log(`[webhook] Updated INQUIRY_REMOVAL_CASES ${caseId} → ${caseStatus}`);
    } catch (err) {
      // Log but don't fail the webhook — Bland needs a 200
      console.error(`[webhook] Failed to update case ${caseId}:`, err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Update GHL contact (custom fields + activity note)
  // -------------------------------------------------------------------------
  if (ghlContactId) {
    try {
      await updateGhlContact(ghlContactId, {
        call_id,
        outcome,
        caseStatus,
        summary,
        call_length,
        transferred_to,
        caseId
      });
      console.log(`[webhook] Updated GHL contact ${ghlContactId}`);
    } catch (err) {
      // Non-fatal — GHL update is best-effort
      console.error(`[webhook] Failed to update GHL contact ${ghlContactId}:`, err.message);
    }
  } else {
    console.log("[webhook] No ghl_contact_id in metadata, skipping GHL update");
  }

  // -------------------------------------------------------------------------
  // 3. Trigger post-call analysis (best-effort, non-blocking)
  // -------------------------------------------------------------------------
  if (call_id && status === "completed") {
    triggerCallAnalysis(call_id, caseId).catch((err) => {
      console.error(`[webhook] Post-call analysis failed for ${call_id}:`, err.message);
    });
  }

  return res.status(200).json({
    ok: true,
    outcome,
    case_status: caseStatus,
    case_id: caseId || null,
    ghl_contact_id: ghlContactId || null
  });
};

// ---------------------------------------------------------------------------
// Airtable: Update INQUIRY_REMOVAL_CASES record
// ---------------------------------------------------------------------------

/**
 * Update INQUIRY_REMOVAL_CASES after AI call completes.
 *
 * - Successful calls (transferred/reached_human) → "Awaiting Remover"
 * - Failed calls → "Call Failed"
 * - The AI caller must NOT mark the case Completed — that's the human remover's job.
 */
async function updateCaseAfterCall(
  caseId,
  { call_id, outcome, caseStatus, summary, transcripts, call_length, transferred_to }
) {
  const airtable = require("../src/lib/airtable-client");

  // Build a concise transcript excerpt (first 1000 chars)
  let transcriptExcerpt = "";
  if (Array.isArray(transcripts) && transcripts.length > 0) {
    transcriptExcerpt = transcripts
      .map((t) => `${t.user ? "Human" : "AI"}: ${t.user || t.agent || ""}`)
      .join("\n")
      .substring(0, 1000);
  }

  const notes = [
    `Call ID: ${call_id}`,
    `Outcome: ${outcome}`,
    `Duration: ${call_length ? Math.round(call_length) + "s" : "N/A"}`,
    transferred_to ? `Transferred to: ${transferred_to}` : null,
    summary ? `Summary: ${summary}` : null,
    transcriptExcerpt ? `\nTranscript:\n${transcriptExcerpt}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const fields = {
    case_status: caseStatus,
    ai_call_status: outcome,
    remover_notes: notes
  };

  // Track transfer status separately if a transfer happened
  if (transferred_to) {
    fields.ai_transfer_status = "connected";
  }

  await airtable.updateRecord(INQUIRY_REMOVAL_CASES_TABLE, caseId, fields);
}

// ---------------------------------------------------------------------------
// GHL: Update contact custom fields + add activity note
// ---------------------------------------------------------------------------

/**
 * Update the GHL contact associated with this inquiry removal call.
 *
 * Sets custom fields:
 *   - ai_call_master_status: overall outcome (transferred, reached_human, failed, etc.)
 *   - ai_transfer_status: "connected" if warm transfer succeeded
 *
 * Adds an activity note summarizing the call result.
 */
async function updateGhlContact(
  contactId,
  { call_id, outcome, caseStatus, summary, call_length, transferred_to, caseId }
) {
  const ghl = require("../src/lib/ghl-client");

  if (!ghl.isConfigured()) {
    console.log("[webhook] GHL not configured (missing API key or location ID), skipping");
    return;
  }

  // Build custom fields update
  const customFields = {
    ai_call_master_status: outcome
  };

  if (transferred_to) {
    customFields.ai_transfer_status = "connected";
  }

  // Update custom fields
  await ghl.updateContactCustomFields(contactId, customFields);

  // Add activity note so the team can see call results in the CRM timeline
  const noteLines = [
    `Inquiry Removal AI Call — ${caseStatus}`,
    `Outcome: ${outcome}`,
    `Duration: ${call_length ? Math.round(call_length) + "s" : "N/A"}`,
    caseId ? `Case: ${caseId}` : null,
    transferred_to ? `Transferred to: ${transferred_to}` : null,
    summary ? `\n${summary}` : null
  ]
    .filter(Boolean)
    .join("\n");

  await ghl.addContactNote(contactId, noteLines);
}

// ---------------------------------------------------------------------------
// Post-call analysis (async, best-effort)
// ---------------------------------------------------------------------------

async function triggerCallAnalysis(callId, caseId) {
  try {
    const analysis = await bland.analyzeCall(callId, EXPERIAN_ANALYSIS_QUESTIONS);
    console.log(`[webhook] Call analysis for ${callId}:`, JSON.stringify(analysis).substring(0, 500));

    // If we have a case ID, append analysis to remover_notes
    if (caseId && process.env.AIRTABLE_API_KEY) {
      const airtable = require("../src/lib/airtable-client");
      const record = await airtable.getRecord(INQUIRY_REMOVAL_CASES_TABLE, caseId);
      const existingNotes = record.fields.remover_notes || "";
      const analysisText = Object.entries(analysis.answers || analysis || {})
        .map(([q, a]) => `Q: ${q}\nA: ${a}`)
        .join("\n\n");
      if (analysisText) {
        await airtable.updateRecord(INQUIRY_REMOVAL_CASES_TABLE, caseId, {
          remover_notes: existingNotes + "\n\n--- AI Analysis ---\n" + analysisText
        });
      }
    }
  } catch (err) {
    // Non-fatal — analysis is supplementary
    console.error(`[webhook] analyzeCall failed for ${callId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

function determineOutcome(payload) {
  if (payload.transferred_to) return "transferred";
  if (payload.answered_by === "voicemail") return "left_voicemail";
  if (payload.status === "no-answer") return "no_answer";
  if (payload.status === "busy") return "busy";
  if (payload.status === "failed") return "failed";
  if (payload.completed && payload.call_length > 30) return "reached_human";
  if (payload.completed) return "completed_short";
  return "unknown";
}
