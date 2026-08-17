// GET/POST /api/partner-marketing/enable — owner-only switch per partner.
// GET is readable by the owning partner or owner/admin. POST is owner only.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import {
  canAccessPartnerMarketing, isOwner, remainingTokens, setSuiteEnabled
} from "../../src/brand/meter.mjs";

function partnerIdOf(req) {
  return (req.query && req.query.partner_id) || (req.body && req.body.partner_id);
}

function scopeFor(principal, partnerId) {
  return principal.kind === "partner"
    ? { kind: "partner", partnerId: principal.partnerId }
    : { kind: "staff" };
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;

  const partnerId = partnerIdOf(req);
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  if (!canAccessPartnerMarketing(principal, partnerId)) {
    return res.status(403).json({ ok: false, error: "forbidden",
      message: "only the owning partner or an admin may read this" });
  }

  try {
    if (req.method === "GET") {
      const snap = await withPartnerScope(scopeFor(principal, partnerId), (tx) =>
        remainingTokens(tx, partnerId));
      return res.status(200).json({ ok: true, partner_id: partnerId, ...snap });
    }

    if (req.method === "POST") {
      if (!isOwner(principal)) {
        return res.status(403).json({ ok: false, error: "forbidden",
          message: "only the owner can turn this on" });
      }
      const enabled = req.body && req.body.enabled;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ ok: false, error: "enabled_required" });
      }
      const out = await withPartnerScope({ kind: "staff" }, async (tx) => {
        const partner = (await tx.query(
          `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
        )).rows[0];
        if (!partner) {
          const e = new Error("partner not found");
          e.code = "NOT_FOUND";
          throw e;
        }
        const set = await setSuiteEnabled(tx, {
          orgId: partner.org_id, partnerId, enabled
        });
        const snap = await remainingTokens(tx, partnerId);
        return { ...set, ...snap };
      });
      return res.status(200).json({ ok: true, partner_id: partnerId, ...out });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
