// POST /api/campaigns/write — push a pause / resume / budget change to Meta.
// Reuses src/adplatforms guardedWrite + meta adapter. No fabricated tokens.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { guardedWrite, adapterFor } from "../../src/adplatforms/index.mjs";
import { safeError } from "../../src/http/health.mjs";

const ACTIONS = new Set(["pause", "resume", "update_budget"]);

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
  const campaignId = body.campaign_id;
  if (!campaignId) return res.status(400).json({ ok: false, error: "campaign_id_required" });

  try {
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const camp = (await tx.query(
        `SELECT c.*, conn.encrypted_access_token, conn.external_ad_account_id,
                conn.partner_id AS conn_partner_id, conn.id AS connection_id
           FROM campaigns c
           JOIN ad_platform_connections conn ON conn.id = c.connection_id
          WHERE c.id = $1 AND c.partner_id = $2`,
        [campaignId, partnerId]
      )).rows[0];
      if (!camp) {
        const e = new Error("campaign not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      if (camp.platform !== "meta") {
        const e = new Error("only Meta writes are supported on this route today");
        e.code = "PLATFORM";
        throw e;
      }
      if (!camp.external_id) {
        const e = new Error("campaign has no external_id — sync from Meta first");
        e.code = "NO_EXTERNAL";
        throw e;
      }

      const connection = {
        id: camp.connection_id,
        partner_id: camp.conn_partner_id,
        encrypted_access_token: camp.encrypted_access_token,
        external_ad_account_id: camp.external_ad_account_id
      };
      const adapter = adapterFor("meta");
      const budgetCents = body.budget_cents != null ? Number(body.budget_cents) : null;

      return guardedWrite(tx, {
        orgId: camp.org_id,
        partnerId,
        platform: "meta",
        targetType: "campaign",
        targetId: camp.id,
        reason: body.reason || `chat/campaigns write: ${action}`,
        actor: "human",
        userId: principal.staffId || null,
        before: { status: camp.status, budget_cents: camp.budget_cents },
        after: {
          status: action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : camp.status,
          budget_cents: action === "update_budget" ? budgetCents : camp.budget_cents
        },
        budget: action === "update_budget" ? {
          campaignId: camp.id,
          currentCents: camp.budget_cents,
          proposedCents: budgetCents
        } : null,
        execute: async () => {
          if (action === "pause") return adapter.pause(connection, { externalId: camp.external_id });
          if (action === "resume") return adapter.resume(connection, { externalId: camp.external_id });
          return adapter.updateBudget(connection, {
            externalId: camp.external_id,
            budgetCents
          });
        }
      });
    });

    if (result.blocked) {
      return res.status(400).json({
        ok: false,
        error: "blocked",
        state: result.state,
        reasons: result.reasons
      });
    }
    return res.status(200).json({ ok: true, action, result: result.result, action_log_id: result.actionLogId });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (err.code === "PLATFORM" || err.code === "NO_EXTERNAL") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
