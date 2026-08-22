// POST /api/commissions — approve or mark-paid on commission_ledger rows.
//
// COMPLIANCE REVIEW REQUIRED — commission timing / payout recording.
// Read path stays GET /api/read/commissions. This route only mutates status.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../src/http/read-api.mjs";
import { requireSessionOrg } from "../src/http/session-org.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { safeError } from "../src/http/health.mjs";
import {
  approveCommissions,
  markCommissionsPaid
} from "../src/commissions/payout.mjs";

export { approveCommissions, markCommissionsPaid };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Same gate as commission-rules: owner / admin / sales_manager.
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const action = String(req.body?.action || "").trim().toLowerCase();
  const ledgerIds = req.body?.ledger_ids;

  try {
    if (action === "approve") {
      const result = await approveCommissions(db, {
        orgId,
        ledgerIds,
        staff
      });
      if (result.status !== 200) {
        return res.status(result.status).json({ ok: false, error: result.error });
      }
      return res.status(200).json({
        ok: true,
        action: "approve",
        updated: result.updated,
        requested: result.requested,
        skipped: result.skipped,
        rows: result.rows
      });
    }

    if (action === "mark_paid") {
      const result = await markCommissionsPaid(db, {
        orgId,
        ledgerIds,
        payoutRef: req.body?.payout_ref,
        staff
      });
      if (result.status !== 200) {
        return res.status(result.status).json({ ok: false, error: result.error });
      }
      return res.status(200).json({
        ok: true,
        action: "mark_paid",
        updated: result.updated,
        requested: result.requested,
        skipped: result.skipped,
        payout_ref: result.payout_ref,
        rows: result.rows
      });
    }

    return res.status(400).json({
      ok: false,
      error: "action_required",
      allowed: ["approve", "mark_paid"]
    });
  } catch (err) {
    if (dbDown(err)) {
      return res.status(503).json({ ok: false, error: "db_unavailable" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
