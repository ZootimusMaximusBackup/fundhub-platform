// POST /api/partner-marketing/generate-logo — typographic wordmark from the name.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, SUITE_OFF, recordUsage, assertSuiteEnabled } from "../../src/brand/meter.mjs";
import { wordmarkDataUrl } from "../../src/brand/wordmark.mjs";

export default async function handler(req, res, deps = {}) {
  const scoped = deps.withPartnerScope || withPartnerScope;
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;
  const partnerId = (req.body || {}).partner_id;
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  if (!canAccessPartnerMarketing(principal, partnerId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    const out = await scoped(
      principal.kind === "partner"
        ? { kind: "partner", partnerId: principal.partnerId }
        : { kind: "staff" },
      async (tx) => {
        await assertSuiteEnabled(tx, partnerId);
        const partner = (await tx.query(
          `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
        )).rows[0];
        if (!partner) {
          const e = new Error("partner not found");
          e.code = "NOT_FOUND";
          throw e;
        }
        const brand = (await tx.query(
          `SELECT * FROM partner_brand WHERE partner_id = $1`, [partnerId]
        )).rows[0];
        const name = String((req.body || {}).name || brand?.entity_name || "").trim();
        if (!name) {
          const e = new Error("name required");
          e.code = "name_required";
          throw e;
        }
        const url = wordmarkDataUrl({
          name,
          displayFace: brand?.display_face,
          ink: brand?.ink,
          paper: brand?.paper
        });
        const saved = (await tx.query(
          `INSERT INTO partner_brand (org_id, partner_id, entity_name, wordmark_url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (partner_id) DO UPDATE SET
             wordmark_url = EXCLUDED.wordmark_url,
             entity_name = COALESCE(NULLIF(EXCLUDED.entity_name, ''), partner_brand.entity_name),
             updated_at = now()
           RETURNING *`,
          [partner.org_id, partnerId, name, url]
        )).rows[0];
        await recordUsage(tx, {
          orgId: partner.org_id,
          partnerId,
          purpose: "logo",
          inputTokens: 0,
          outputTokens: 0,
          model: "wordmark-svg"
        });
        return saved;
      }
    );
    return res.status(200).json({ ok: true, brand: redact(out) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "not_found",
        message: "That partner is not on file." });
    }
    if (err.code === "name_required") {
      return res.status(400).json({ ok: false, error: "name_required",
        message: "Save a brand name first." });
    }
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
