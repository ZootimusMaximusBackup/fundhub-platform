// GET /api/read/deal-math — net cash and monthly from the closer's typed numbers.
// No table. Session org is required so the read sits behind the same staff gate.

import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dealMath } from "../../src/sales/deal-math.mjs";

function num(q, key) {
  if (q == null || q[key] == null || q[key] === "") return 0;
  const n = Number(q[key]);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res, deps = {}) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: deps.db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const q = req.query || {};
  const data = dealMath({
    orgId: staff.org_id,
    deposit: num(q, "deposit"),
    feePercent: num(q, "fee"),
    debts: num(q, "debts"),
    minPercent: num(q, "min") || 3,
    drawn: num(q, "drawn")
  });
  return res.status(200).json({ ok: true, ...data });
}
