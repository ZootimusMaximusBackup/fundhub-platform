// POST /api/creative/actions — approve / reject / archive a creative asset.
//
// Approvals was read-only. This is the write path UNIT 8 needs so the review
// queue can clear. Nothing here invents provider credentials.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

const ACTIONS = new Set(["approve", "reject", "archive"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  const action = String(body.action || "").toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "unknown_action", allowed: [...ACTIONS] });
  }
  const assetId = body.asset_id;
  if (!assetId) return res.status(400).json({ ok: false, error: "asset_id_required" });

  try {
    const asset = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const found = (await tx.query(
        `SELECT * FROM creative_assets WHERE id = $1 AND partner_id = $2`,
        [assetId, partnerId]
      )).rows[0];
      if (!found) {
        const e = new Error("asset not found");
        e.code = "NOT_FOUND";
        throw e;
      }

      if (action === "archive") {
        const r = await tx.query(
          `UPDATE creative_assets SET archived_at = now(), updated_at = now()
            WHERE id = $1 AND partner_id = $2 AND archived_at IS NULL
            RETURNING *`,
          [assetId, partnerId]
        );
        return r.rows[0] || found;
      }

      if (action === "approve") {
        if (found.archived_at) {
          const e = new Error("archived assets cannot be approved");
          e.code = "ARCHIVED";
          throw e;
        }
        const r = await tx.query(
          `UPDATE creative_assets
              SET compliance_state = 'approved', blocked_reasons = '[]'::jsonb, updated_at = now()
            WHERE id = $1 AND partner_id = $2
            RETURNING *`,
          [assetId, partnerId]
        );
        return r.rows[0];
      }

      // reject
      const reasons = Array.isArray(body.reasons) && body.reasons.length
        ? body.reasons
        : [{ code: "human_reject", rule_set: "approval", message: String(body.reason || "Rejected by reviewer") }];
      const r = await tx.query(
        `UPDATE creative_assets
            SET compliance_state = 'blocked', blocked_reasons = $3::jsonb, updated_at = now()
          WHERE id = $1 AND partner_id = $2 AND archived_at IS NULL
          RETURNING *`,
        [assetId, partnerId, JSON.stringify(reasons)]
      );
      return r.rows[0] || found;
    });

    return res.status(200).json({ ok: true, action, asset });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (err.code === "ARCHIVED") return res.status(400).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
