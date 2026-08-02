// GET/POST /api/partner-pages — Brand Studio funnel page drafts.
//
//   GET  ?partner_id=     list pages
//   POST { partner_id, funnel_key, title?, slug? }  create from template
//   PATCH { id, title?, slug?, status?, body_json? }

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";

const ROLES = new Set(["owner", "admin"]);
const FUNNELS = {
  apply: { title: "Application funnel", slug: "apply" },
  diag: { title: "Diagnostic funnel", slug: "diagnostic" },
  edu: { title: "Education funnel", slug: "education" },
  aff: { title: "Affiliate recruit", slug: "affiliate" },
  book: { title: "Booking funnel", slug: "book" }
};

function defaultBody(funnelKey) {
  const meta = FUNNELS[funnelKey] || { title: funnelKey };
  return {
    template: funnelKey,
    sections: [
      { type: "hero", headline: meta.title, sub: "Edit this page in Brand Studio." },
      { type: "cta", label: "Start", href: "#apply" }
    ]
  };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLES)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  try {
    if (req.method === "GET") {
      const partnerId = req.query?.partner_id;
      if (!isUuid(partnerId)) {
        return res.status(400).json({ ok: false, error: "partner_id_required" });
      }
      const r = await db.query(
        `SELECT id, partner_id, funnel_key, title, slug, status, body_json, created_at, updated_at
           FROM partner_pages
          WHERE org_id = $1 AND partner_id = $2
          ORDER BY updated_at DESC`,
        [staff.org_id, partnerId]
      );
      return res.status(200).json({ ok: true, items: r.rows, templates: Object.keys(FUNNELS) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const partnerId = body.partner_id;
      const funnelKey = String(body.funnel_key || "").toLowerCase();
      if (!isUuid(partnerId)) return res.status(400).json({ ok: false, error: "partner_id_required" });
      if (!FUNNELS[funnelKey]) {
        return res.status(400).json({
          ok: false, error: "unknown_funnel_key", allowed: Object.keys(FUNNELS)
        });
      }
      const partner = await db.query(
        `SELECT id FROM partners WHERE id = $1 AND org_id = $2`,
        [partnerId, staff.org_id]
      );
      if (!partner.rows[0]) return res.status(404).json({ ok: false, error: "partner_not_found" });

      const meta = FUNNELS[funnelKey];
      const title = String(body.title || meta.title).trim();
      const slug = String(body.slug || meta.slug).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
      const ins = await db.query(
        `INSERT INTO partner_pages (org_id, partner_id, funnel_key, title, slug, status, body_json)
         VALUES ($1,$2,$3,$4,$5,'draft',$6::jsonb)
         ON CONFLICT (partner_id, slug) DO UPDATE SET
           title = EXCLUDED.title,
           updated_at = now()
         RETURNING *`,
        [staff.org_id, partnerId, funnelKey, title, slug, JSON.stringify(body.body_json || defaultBody(funnelKey))]
      );
      // Also ensure selected_funnels includes this key on partner_brand.
      await db.query(
        `UPDATE partner_brand
            SET selected_funnels = (
              SELECT jsonb_agg(DISTINCT x)
                FROM jsonb_array_elements_text(
                  COALESCE(selected_funnels, '[]'::jsonb) || jsonb_build_array($2::text)
                ) AS t(x)
            ),
                updated_at = now()
          WHERE partner_id = $1`,
        [partnerId, funnelKey]
      ).catch(() => null);

      return res.status(200).json({ ok: true, page: ins.rows[0] });
    }

    if (req.method === "PATCH") {
      const body = req.body || {};
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "id_required" });
      const sets = [];
      const params = [body.id, staff.org_id];
      if (body.title != null) {
        params.push(String(body.title).trim());
        sets.push(`title = $${params.length}`);
      }
      if (body.slug != null) {
        params.push(String(body.slug).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63));
        sets.push(`slug = $${params.length}`);
      }
      if (body.status != null) {
        params.push(String(body.status));
        sets.push(`status = $${params.length}`);
      }
      if (body.body_json != null) {
        params.push(JSON.stringify(body.body_json));
        sets.push(`body_json = $${params.length}::jsonb`);
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: "nothing_to_update" });
      sets.push("updated_at = now()");
      const r = await db.query(
        `UPDATE partner_pages SET ${sets.join(", ")}
          WHERE id = $1 AND org_id = $2
          RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, page: r.rows[0] });
    }

    res.setHeader("allow", "GET, POST, PATCH");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (String(err.message || "").includes("partner_pages_partner_funnel_uq")) {
      return res.status(409).json({ ok: false, error: "funnel_page_exists" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
