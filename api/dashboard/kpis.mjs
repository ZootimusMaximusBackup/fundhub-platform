// GET /api/dashboard/kpis?period=today|7d|30d|qtd
//
// Company money + funnel KPIs for Command Center and Ops & Admin.
// Auth: same dashboard gate as the other /api/dashboard/* routes.

import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { computeKpis, formatCents, formatRate } from "../../src/dashboard/kpis.mjs";

const PERIODS = new Set(["today", "7d", "30d", "qtd"]);

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "forbidden" });

  const period = String(req.query?.period || "7d").toLowerCase();
  if (!PERIODS.has(period)) {
    return res.status(400).json({ ok: false, error: "invalid_period", allowed: [...PERIODS] });
  }

  try {
    const kpis = await computeKpis(db, { orgId, period });
    return res.status(200).json({
      ok: true,
      kpis,
      display: {
        cash: formatCents(kpis.cash_collected_cents),
        funded: String(kpis.funded_count),
        funded_amount: formatCents(kpis.funded_amount_cents),
        close: formatRate(kpis.close_rate),
        show: formatRate(kpis.show_rate),
        cpf: kpis.cost_per_funded_cents != null
          ? formatCents(kpis.cost_per_funded_cents)
          : "—",
        clients: String(kpis.new_clients),
        pipeline_movement: String(kpis.pipeline_movement)
      }
    });
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(500).json({
      ok: false,
      error: "query_failed",
      message: "Something went wrong loading KPIs.",
      detail: safeError(err)
    });
  }
}
