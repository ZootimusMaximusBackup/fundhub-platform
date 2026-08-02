// GET /api/public/partner-page — JSON for a published page (no auth).
// Used by previews and tools; HTML hosting is netlify/functions/partner-site.mjs.

import { db } from "../../src/db.mjs";
import { loadPublishedPage } from "../../src/brand/partner-site.mjs";
import { safeError } from "../../src/http/health.mjs";
import { isUuid } from "../../src/http/read-api.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const q = req.query || {};
  try {
    let loaded = null;
    if (q.domain) {
      loaded = await loadPublishedPage(db, {
        host: String(q.domain).toLowerCase(),
        slug: String(q.slug || "apply").toLowerCase()
      });
    } else if (isUuid(q.partner_id) && q.slug) {
      loaded = await loadPublishedPage(db, {
        partnerId: q.partner_id,
        slug: String(q.slug).toLowerCase()
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: "partner_id_and_slug_or_domain_required"
      });
    }

    if (!loaded) return res.status(404).json({ ok: false, error: "not_found" });

    return res.status(200).json({
      ok: true,
      page: {
        id: loaded.page.id,
        title: loaded.page.title,
        slug: loaded.page.slug,
        funnel_key: loaded.page.funnel_key,
        status: loaded.page.status,
        body_json: loaded.page.body_json,
        published_at: loaded.page.published_at
      },
      brand: {
        ink: loaded.brand.ink,
        paper: loaded.brand.paper,
        display_face: loaded.brand.display_face,
        mono_face: loaded.brand.mono_face,
        entity_name: loaded.brand.entity_name,
        domain: loaded.brand.domain,
        domain_verified: loaded.brand.domain_verified
      },
      live_path: `/sites/${loaded.page.partner_id}/${loaded.page.slug}`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
