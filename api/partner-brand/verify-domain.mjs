// POST /api/partner-brand/verify-domain — real DNS TXT check for custom domains.
// Sets partner_brand.domain_verified when _fundhub.<domain> contains the token.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { siteVerifyToken, checkDomainTxt } from "../../src/brand/domain-verify.mjs";

const ROLES = new Set(["owner", "admin"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLES)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const body = req.body || {};
  const partnerId = body.partner_id;
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  try {
    const brand = (await db.query(
      `SELECT b.partner_id, b.domain, b.domain_verified, p.org_id
         FROM partner_brand b
         JOIN partners p ON p.id = b.partner_id
        WHERE b.partner_id = $1 AND p.org_id = $2`,
      [partnerId, staff.org_id]
    )).rows[0];

    if (!brand) return res.status(404).json({ ok: false, error: "brand_not_found" });
    if (!brand.domain) {
      return res.status(400).json({ ok: false, error: "domain_required", message: "Save a domain first." });
    }

    const token = siteVerifyToken(partnerId);
    const check = await checkDomainTxt(brand.domain, token);

    if (!check.ok) {
      return res.status(200).json({
        ok: false,
        verified: false,
        domain: brand.domain,
        host: check.host,
        expected: token,
        records: check.records,
        error: check.error || "txt_mismatch",
        message: `Add a TXT record at ${check.host} with value ${token}, then try again.`
      });
    }

    await db.query(
      `UPDATE partner_brand SET domain_verified = true, updated_at = now()
        WHERE partner_id = $1`,
      [partnerId]
    );

    return res.status(200).json({
      ok: true,
      verified: true,
      domain: brand.domain,
      host: check.host,
      expected: token,
      live_base: `https://${brand.domain}`,
      note: "Domain verified. Point the domain (CNAME/ALIAS) at this Netlify site so SSL and Host-based routing work."
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
