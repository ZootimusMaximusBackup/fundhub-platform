// POST /api/partner-marketing/generate-copy — rewrite unlocked page sections.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, SUITE_OFF, CAP_HIT } from "../../src/brand/meter.mjs";
import { generateSectionCopy } from "../../src/brand/copy-generate.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;
  const body = req.body || {};
  const pageId = body.page_id;
  if (!isUuid(pageId)) return res.status(400).json({ ok: false, error: "page_id_required" });

  try {
    const out = await withPartnerScope(
      principal.kind === "partner"
        ? { kind: "partner", partnerId: principal.partnerId }
        : { kind: "staff" },
      async (tx) => {
        const page = (await tx.query(
          `SELECT * FROM partner_pages WHERE id = $1`, [pageId]
        )).rows[0];
        if (!page) {
          const e = new Error("page not found");
          e.code = "NOT_FOUND";
          throw e;
        }
        if (!canAccessPartnerMarketing(principal, page.partner_id)) {
          const e = new Error("forbidden");
          e.code = "FORBIDDEN";
          throw e;
        }
        const brand = (await tx.query(
          `SELECT * FROM partner_brand WHERE partner_id = $1`, [page.partner_id]
        )).rows[0] || {};
        return generateSectionCopy({
          db: tx,
          orgId: page.org_id,
          partnerId: page.partner_id,
          page,
          brand,
          sectionId: String(body.section_id || "").trim() || null,
          env: process.env
        });
      }
    );
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    if (err.code === "FORBIDDEN") return res.status(403).json({ ok: false, error: "forbidden" });
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    if (err.code === CAP_HIT) {
      return res.status(429).json({ ok: false, error: "token_cap",
        message: "This partner has used this month's writing budget.",
        usage: err.usage || null });
    }
    if (err.code === "locked_section") {
      return res.status(400).json({ ok: false, error: "locked_section",
        message: "That block is locked and cannot be rewritten." });
    }
    if (err.code === "no_model") {
      return res.status(503).json({ ok: false, error: "no_model",
        message: "The writing robot is not set on this site." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
