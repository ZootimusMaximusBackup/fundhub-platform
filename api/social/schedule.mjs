// POST /api/social/schedule — queue an organic post (Social Studio).
// Wraps src/social/scheduler.mjs schedule().

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { schedule } from "../../src/social/scheduler.mjs";
import { safeError } from "../../src/http/health.mjs";
import { assertSuiteEnabled, SUITE_OFF } from "../../src/brand/meter.mjs";

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

  const channelId = body.channel_id;
  const caption = String(body.caption || "").trim();
  const offerType = body.offer_type || "funding";
  if (!channelId) return res.status(400).json({ ok: false, error: "channel_id_required" });
  if (!caption) return res.status(400).json({ ok: false, error: "caption_required" });

  try {
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const org = (await tx.query(
        `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!org) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      await assertSuiteEnabled(tx, partnerId);
      return schedule(tx, {
        orgId: org.org_id,
        partnerId,
        channelId,
        assetId: body.asset_id || null,
        caption,
        offerType,
        scheduledFor: body.scheduled_for || null
      });
    });

    return res.status(200).json({
      ok: true,
      state: result.state,
      reasons: result.reasons || [],
      post: result.post
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
