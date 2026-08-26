// GET /api/read/ops-pulse?period=today|7d|30d|qtd
//
// Daily pulse + two briefs + hire recommendation. READ ONLY.
// Does not create tasks. Does not post to LinkedIn. Does not fire anyone.
//
// Gate: ROLE_SETS.OPS (owner, admin). Job-applicant PII stays on HIRING.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { computePulse } from "../../src/ops/pulse.mjs";
import { briefsFromPulse } from "../../src/ops/briefs.mjs";

const PERIODS = new Set(["today", "7d", "30d", "qtd"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = deps.staff || await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "forbidden" });

  const period = String(req.query?.period || "7d").toLowerCase();
  if (!PERIODS.has(period)) {
    return res.status(400).json({ ok: false, error: "invalid_period", allowed: [...PERIODS] });
  }

  try {
    const pulse = await computePulse(database, { orgId: staff.org_id, period });
    const briefs = briefsFromPulse(pulse);
    return res.status(200).json({
      ok: true,
      pulse,
      briefs,
      hire: pulse.hire,
      ads: pulse.ads,
      gaps: pulse.gaps,
      fire: pulse.fire,
      raise: pulse.raise,
      bonus: pulse.bonus
    });
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(500).json({
      ok: false,
      error: "query_failed",
      message: "Something went wrong loading today's pulse.",
      detail: safeError(err)
    });
  }
}
