// POST /api/demo/simulate — load a simulated client (owner/admin).
// DELETE /api/demo/simulate — tear down simulated clients.
//
//   POST {} or { } → create one simulated client + CRS + tradelines + card
//   DELETE { client_id? } → remove that demo client, or all org demos

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../../src/http/read-api.mjs";
import { loadSimulatedClient, teardownSimulated } from "../../src/demo/simulate-client.mjs";
import { safeError } from "../../src/http/health.mjs";

const FINANCE_ROLES = new Set(["owner", "admin"]);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, FINANCE_ROLES)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  try {
    if (req.method === "POST") {
      const result = await loadSimulatedClient(db, {
        orgId: staff.org_id,
        staffId: staff.id
      });
      return res.status(200).json({
        ok: true,
        client_id: result.client.id,
        email: result.email,
        tradeline_count: result.tradeline_count,
        card_id: result.card?.id || null,
        crs_id: result.crs.id,
        href: result.finance_os_href
      });
    }

    if (req.method === "DELETE") {
      const clientId = (req.body && req.body.client_id) || (req.query && req.query.client_id) || null;
      const result = await teardownSimulated(db, {
        orgId: staff.org_id,
        clientId
      });
      return res.status(200).json({ ok: true, ...result });
    }

    res.setHeader("allow", "POST, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
