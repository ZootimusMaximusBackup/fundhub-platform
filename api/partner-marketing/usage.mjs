// GET /api/partner-marketing/usage — tokens used this month vs the hard cap.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, remainingTokens } from "../../src/brand/meter.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;
  const partnerId = (req.query || {}).partner_id;
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  if (!canAccessPartnerMarketing(principal, partnerId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  try {
    const snap = await withPartnerScope(
      principal.kind === "partner"
        ? { kind: "partner", partnerId: principal.partnerId }
        : { kind: "staff" },
      (tx) => remainingTokens(tx, partnerId)
    );
    return res.status(200).json({ ok: true, partner_id: partnerId, ...snap });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
