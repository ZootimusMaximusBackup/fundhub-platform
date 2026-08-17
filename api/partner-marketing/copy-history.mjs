// GET/POST /api/partner-marketing/copy-history — list or restore a section.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, SUITE_OFF } from "../../src/brand/meter.mjs";
import { listSectionHistory, restoreSection } from "../../src/brand/copy-generate.mjs";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;

  try {
    if (req.method === "GET") {
      const pageId = (req.query || {}).page_id;
      if (!isUuid(pageId)) return res.status(400).json({ ok: false, error: "page_id_required" });
      const items = await withPartnerScope(
        principal.kind === "partner"
          ? { kind: "partner", partnerId: principal.partnerId }
          : { kind: "staff" },
        async (tx) => {
          const page = (await tx.query(
            `SELECT id, partner_id FROM partner_pages WHERE id = $1`, [pageId]
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
          return listSectionHistory(tx, {
            pageId,
            sectionId: (req.query || {}).section_id || null
          });
        }
      );
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.page_id) || !isUuid(body.version_id)) {
        return res.status(400).json({ ok: false, error: "page_id_and_version_id_required" });
      }
      const out = await withPartnerScope(
        principal.kind === "partner"
          ? { kind: "partner", partnerId: principal.partnerId }
          : { kind: "staff" },
        async (tx) => {
          const page = (await tx.query(
            `SELECT * FROM partner_pages WHERE id = $1`, [body.page_id]
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
          return restoreSection({
            db: tx,
            orgId: page.org_id,
            partnerId: page.partner_id,
            page,
            versionId: body.version_id
          });
        }
      );
      return res.status(200).json({ ok: true, ...out });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "FORBIDDEN") return res.status(403).json({ ok: false, error: "forbidden" });
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    if (err.code === "locked_section") {
      return res.status(400).json({ ok: false, error: "locked_section" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
