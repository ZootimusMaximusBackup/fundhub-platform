// POST /api/social/publish — run publishDue for one partner (or all with due posts).
// The Netlify social-publish-sweeper cron calls the same path on a schedule.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { publishDue } from "../../src/social/scheduler.mjs";
import { publishDueAll, ensureSocialAdapters } from "../../src/social/publish-all.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  ensureSocialAdapters();

  try {
    if (body.all === true || body.all === 1 || body.all === "1") {
      if (principal.kind !== "staff") {
        return res.status(403).json({ ok: false, error: "staff_only_for_all" });
      }
      const out = await publishDueAll(db, {});
      return res.status(200).json({ ok: true, ...out });
    }

    const partnerId = resolvePartnerId(principal, {
      partner_id: body.partner_id || (req.query || {}).partner_id
    });
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partner_id_required" });
    }

    const org = (await db.query(
      `SELECT org_id FROM partners WHERE id = $1`,
      [partnerId]
    )).rows[0];
    if (!org) return res.status(404).json({ ok: false, error: "partner_not_found" });

    const results = await publishDue(db, {
      orgId: org.org_id,
      partnerId
    });
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
