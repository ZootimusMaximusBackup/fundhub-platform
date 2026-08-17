// GET/POST /api/content/tiles — Content screen (public/app/content-admin.html).
//
//   GET  → entitlement_catalog tiles, welcome videos, tier→video map, products
//   POST { action: "save", tiles?: [...], map?: { tier_code: video_id|"" } }
//
// Owner/admin only — same people the Content nav item is shown to
// (OWNER_ADMIN_ONLY in public/app/shell.js). ROLE_SETS.OPS. Nothing here
// grants a closer or advisor a write they cannot already reach on screen.
//
// Tile rows already exist on entitlement_catalog. This updates name, copy
// (description), on/off (active), and display_price_cents. It does not insert
// catalog rows. A code that is not on file is refused.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";

function publicTile(row) {
  return {
    id: row.code,
    code: row.code,
    name: row.name,
    copy: row.description || "",
    price_cents: row.display_price_cents == null ? null : Number(row.display_price_cents),
    on: row.active !== false,
    sort_order: row.sort_order
  };
}

function publicVideo(row) {
  return {
    id: row.id,
    title: row.title,
    duration_label: row.duration_label || "",
    mime_type: row.mime_type || null,
    byte_size: row.byte_size == null ? null : Number(row.byte_size),
    uploaded_by: row.uploaded_by || null,
    uploaded_at: row.created_at
  };
}

async function loadBundle(orgId) {
  /* Price and the video tables land in 171_content.sql. Until that file
     is applied, read what already exists and leave price/videos empty.
     Do not invent a price. */
  const tiles = await db.query(
    `SELECT code, name, description, active, sort_order
       FROM entitlement_catalog
      WHERE org_id = $1::uuid
      ORDER BY sort_order, code`,
    [orgId]
  );
  let priceByCode = {};
  try {
    const prices = await db.query(
      `SELECT code, display_price_cents
         FROM entitlement_catalog
        WHERE org_id = $1::uuid AND display_price_cents IS NOT NULL`,
      [orgId]
    );
    for (const row of prices.rows) priceByCode[row.code] = row.display_price_cents;
  } catch {
    priceByCode = {};
  }
  let videos = { rows: [] };
  let map = { rows: [] };
  try {
    videos = await db.query(
      `SELECT id, title, duration_label, mime_type, byte_size, uploaded_by, created_at
         FROM content_videos
        WHERE org_id = $1::uuid
        ORDER BY created_at DESC`,
      [orgId]
    );
    map = await db.query(
      `SELECT tier_code, video_id FROM content_tier_map WHERE org_id = $1::uuid`,
      [orgId]
    );
  } catch {
    videos = { rows: [] };
    map = { rows: [] };
  }
  const products = await db.query(
    `SELECT code, name, description
       FROM products
      WHERE org_id = $1::uuid AND active = true
      ORDER BY sort_order, code`,
    [orgId]
  );
  const mapping = {};
  for (const row of map.rows) mapping[row.tier_code] = row.video_id;
  return {
    tiles: tiles.rows.map((row) => publicTile({
      ...row,
      display_price_cents: priceByCode[row.code] != null ? priceByCode[row.code] : null
    })),
    videos: videos.rows.map(publicVideo),
    map: mapping,
    products: products.rows.map((p) => ({
      id: p.code,
      name: p.name,
      note: p.description || ""
    }))
  };
}

export default async function handler(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "This screen reads or saves. It does not take another kind of request."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  try {
    if (method === "GET") {
      const bundle = await loadBundle(orgId);
      return res.status(200).json({ ok: true, ...bundle });
    }

    const body = req.body || {};
    const action = String(body.action || "").trim().toLowerCase();
    if (action !== "save") {
      return res.status(400).json({
        ok: false, error: "unknown_action",
        message: "Unknown action. Use save."
      });
    }

    const tiles = Array.isArray(body.tiles) ? body.tiles : null;
    const mapping = body.map && typeof body.map === "object" && !Array.isArray(body.map)
      ? body.map
      : null;

    if (!tiles && !mapping) {
      return res.status(400).json({
        ok: false, error: "nothing_to_save",
        message: "Send the tiles, the video map, or both."
      });
    }

    if (tiles) {
      for (const t of tiles) {
        const code = String(t && t.code || t && t.id || "").trim().toLowerCase();
        if (!code) {
          return res.status(400).json({
            ok: false, error: "code_required",
            message: "Each tile needs its catalog code."
          });
        }
        const name = String(t.name || "").trim();
        if (!name) {
          return res.status(400).json({
            ok: false, error: "name_required",
            message: "A tile needs a name."
          });
        }
        let priceCents = null;
        if (t.price_cents != null && t.price_cents !== "") {
          const n = Number(t.price_cents);
          if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
            return res.status(400).json({
              ok: false, error: "invalid_price",
              message: "Price is whole cents, or leave it empty."
            });
          }
          priceCents = n;
        }
        let updated;
        try {
          updated = await db.query(
            `UPDATE entitlement_catalog
                SET name = $3,
                    description = $4,
                    active = $5,
                    display_price_cents = $6
              WHERE org_id = $1::uuid AND code = $2
              RETURNING code`,
            [
              orgId,
              code,
              name,
              String(t.copy || "").trim() || null,
              t.on !== false,
              priceCents
            ]
          );
        } catch {
          updated = await db.query(
            `UPDATE entitlement_catalog
                SET name = $3,
                    description = $4,
                    active = $5
              WHERE org_id = $1::uuid AND code = $2
              RETURNING code`,
            [
              orgId,
              code,
              name,
              String(t.copy || "").trim() || null,
              t.on !== false
            ]
          );
        }
        if (!updated.rows[0]) {
          return res.status(400).json({
            ok: false, error: "unknown_tile",
            message: "There is no locked tile on file with that code. Nothing was invented."
          });
        }
      }
    }

    if (mapping) {
      try {
        for (const tierCode of Object.keys(mapping)) {
          const code = String(tierCode || "").trim();
          if (!code) continue;
          const videoId = mapping[tierCode];
          if (videoId == null || videoId === "") {
            await db.query(
              `DELETE FROM content_tier_map WHERE org_id = $1::uuid AND tier_code = $2`,
              [orgId, code]
            );
            continue;
          }
          const found = await db.query(
            `SELECT id FROM content_videos WHERE org_id = $1::uuid AND id = $2::uuid`,
            [orgId, videoId]
          );
          if (!found.rows[0]) {
            return res.status(400).json({
              ok: false, error: "unknown_video",
              message: "That video is not in this company's library."
            });
          }
          await db.query(
            `INSERT INTO content_tier_map (org_id, tier_code, video_id, updated_at)
             VALUES ($1::uuid, $2, $3::uuid, now())
             ON CONFLICT (org_id, tier_code)
             DO UPDATE SET video_id = EXCLUDED.video_id, updated_at = now()`,
            [orgId, code, videoId]
          );
        }
      } catch {
        const wantsVideo = Object.values(mapping).some((v) => v != null && v !== "");
        if (wantsVideo) {
          return res.status(400).json({
            ok: false, error: "videos_not_stored_yet",
            message: "Tile words were saved. Welcome videos are not stored in the database yet."
          });
        }
      }
    }

    const bundle = await loadBundle(orgId);
    return res.status(200).json({ ok: true, action: "save", ...bundle });
  } catch (err) {
    if (dbDown(res, err)) return;
    return res.status(500).json({
      ok: false,
      error: "query_failed",
      message: "Something went wrong saving content.",
      detail: safeError(err)
    });
  }
}
