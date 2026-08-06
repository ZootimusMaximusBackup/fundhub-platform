"use strict";

/**
 * GET /api/call-status?call_id=xxx
 *
 * Check the status of an ongoing or completed call via Bland AI.
 */

const bland = require("../src/lib/bland-client");
const { requireAuth } = require("../src/lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) return;

  const callId = req.query?.call_id;
  if (!callId) {
    return res.status(400).json({ error: "call_id query parameter is required" });
  }

  try {
    const call = await bland.getCall(callId);

    return res.status(200).json({
      ok: true,
      callId: call.call_id,
      status: call.queue_status || (call.completed ? "complete" : "in_progress"),
      completed: call.completed,
      callLength: call.call_length || null,
      toNumber: call.to,
      fromNumber: call.from,
      answeredBy: call.answered_by || null,
      transferredTo: call.transferred_to || null,
      summary: call.summary || null,
      metadata: call.metadata || null
    });
  } catch (err) {
    console.error("call-status lookup failed:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
};
