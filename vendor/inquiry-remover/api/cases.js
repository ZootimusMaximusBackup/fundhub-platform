"use strict";

/**
 * GET /api/cases
 *
 * List inquiry-removal cases for the supervision console.
 *   ?status=Queued|Scheduled|Calling|Awaiting Remover|Call Failed|Blocked|Completed
 *   ?all=1        include Completed (excluded by default)
 *   ?max=100      max records (cap 200)
 *
 * Auth: Bearer API_SECRET (same as launch-call / schedule-call).
 * Returns { ok: true, cases: [{ id, fields }] } with fields passed through
 * verbatim from INQUIRY_REMOVAL_CASES so the console never lags a schema change.
 */

const airtable = require("../src/lib/airtable-client");
const { requireAuth } = require("../src/lib/auth");

const INQUIRY_REMOVAL_CASES_TABLE = "tblYOliwtT0RETm2S";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireAuth(req, res)) return;

  if (!process.env.AIRTABLE_API_KEY) {
    return res.status(500).json({ error: "AIRTABLE_API_KEY not configured" });
  }

  const status = (req.query?.status || "").trim();
  const includeAll = req.query?.all === "1";
  const max = Math.min(parseInt(req.query?.max || "100", 10) || 100, 200);

  // Escape single quotes for the Airtable formula.
  const q = (s) => String(s).replace(/'/g, "\\'");

  let filterByFormula;
  if (status) {
    filterByFormula = `{case_status}='${q(status)}'`;
  } else if (!includeAll) {
    filterByFormula = `{case_status}!='Completed'`;
  }

  try {
    const result = await airtable.listRecords(INQUIRY_REMOVAL_CASES_TABLE, {
      filterByFormula,
      maxRecords: max
    });
    const cases = (result.records || []).map((r) => ({ id: r.id, fields: r.fields || {} }));
    return res.status(200).json({ ok: true, count: cases.length, cases });
  } catch (err) {
    console.error("[cases] Airtable list failed:", err.message);
    return res.status(502).json({ error: "Airtable query failed", message: err.message });
  }
};
