// POST /api/ops/hire-closer
//
// Writes today’s C-suite tasks from a fresh pulse (actOnBrain).
// Packed → hire-closer task + LinkedIn closer job via postJob.
// Gap → diagnose task. Real spend > 0 → ads review task.
// Re-evaluates packed on the server. Does not trust a client flag.
//
// Does not fire anyone. Does not call suspendStaff. Does not close a job.
// Does not auto-enqueue fire, raise, or bonus. Does not buy ads.
//
// Gate: owner, admin (same people as ROLE_SETS.OPS / HIRING).

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { ROLE_SETS, requireRole as requireRoleSet, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { actOnBrain } from "../../src/ops/pulse.mjs";

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);
const SESSION_OWNED = ["org_id", "packed", "staff_id"];

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = deps.staff || await requireRole("owner", "admin")(req, res, { db: database });
  if (!staff) return;
  if (!requireRoleSet(res, staff, ROLE_SETS.OPS)) return;

  const body = req.body || {};
  for (const field of SESSION_OWNED) {
    if (hasOwn(body, field)) {
      return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
    }
  }

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "forbidden" });

  try {
    const out = await actOnBrain(database, { orgId });
    return res.status(200).json({
      ok: true,
      acted: out.acted,
      reason: out.reason,
      calendar: out.calendar,
      task: out.task,
      linkedin: out.linkedin,
      diagnose: out.diagnose,
      ads_task: out.ads_task,
      fire: out.fire || { auto_enqueue: false, rule_locked: false, note: "no fire rule yet" },
      raise: out.raise || { auto_enqueue: false, rule_locked: false, note: "no raise rule yet" },
      bonus: out.bonus || { auto_enqueue: false, rule_locked: false, note: "no bonus rule yet" }
    });
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(500).json({
      ok: false,
      error: "query_failed",
      message: "Something went wrong creating the hire task.",
      detail: safeError(err)
    });
  }
}
