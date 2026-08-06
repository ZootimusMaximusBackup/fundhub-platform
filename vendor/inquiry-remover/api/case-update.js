"use strict";

/**
 * POST /api/case-update
 *
 * Console writes back to a case. Whitelisted fields only:
 *   remover_notes   — free text
 *   case_status     — human-driven transitions ("Completed", "Blocked",
 *                     "Queued" for a manual retry). The AI caller still never
 *                     marks Completed; this endpoint exists so the HUMAN can.
 *   ai_call_status  — manual correction if a webhook was missed
 *
 * Body: { case_id: "recXXX", fields: { ... } }
 * Auth: Bearer API_SECRET.
 */

const airtable = require("../src/lib/airtable-client");
const { requireAuth } = require("../src/lib/auth");

const INQUIRY_REMOVAL_CASES_TABLE = "tblYOliwtT0RETm2S";
const ALLOWED = new Set(["remover_notes", "case_status", "ai_call_status"]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireAuth(req, res)) return;

  const { case_id, fields } = req.body || {};
  if (!case_id || !fields || typeof fields !== "object") {
    return res.status(400).json({ error: "case_id and fields are required" });
  }

  const clean = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    return res.status(400).json({ error: `No allowed fields. Allowed: ${[...ALLOWED].join(", ")}` });
  }

  try {
    const updated = await airtable.updateRecord(INQUIRY_REMOVAL_CASES_TABLE, case_id, clean);
    return res.status(200).json({ ok: true, id: updated.id, fields: updated.fields });
  } catch (err) {
    console.error("[case-update] Airtable update failed:", err.message);
    return res.status(502).json({ error: "Airtable update failed", message: err.message });
  }
};
