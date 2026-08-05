// POST /api/marketing-flags — store an objection pattern for marketing routing.
// Does not send anything externally.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { CallOutcomeError, createMarketingFlag } from "../src/sales/call-outcomes.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  try {
    const row = await createMarketingFlag(database, {
      orgId,
      staffId: staff.id,
      belief: body.belief,
      leadSource: body.lead_source || null,
      setterLabel: body.setter_label || null,
      outcomeCount: body.outcome_count,
      periodStart: body.period_start,
      periodEnd: body.period_end,
      note: body.note || null
    });
    return res.status(201).json({ ok: true, flag: row });
  } catch (e) {
    if (e instanceof CallOutcomeError) {
      return res.status(e.status).json({
        ok: false,
        error: e.code,
        message: e.message
      });
    }
    throw e;
  }
}
