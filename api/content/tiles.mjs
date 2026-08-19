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

/**
 * partialSaveMessage — say what landed, and only what landed.
 *
 * This handler runs no transaction, so a save that fails halfway leaves the
 * first half on file. Both the map-failure answer and the failed-refresh answer
 * describe that state, and neither may name work the caller never sent: the
 * Content screen posts tiles only, map only, or both.
 *
 * `failed` is true for the map-failure answer, which still has bad news to
 * deliver; the refresh answer passes false because everything asked for is
 * already on file by then.
 */
function partialSaveMessage({ tilesSaved, tiersMapped, failed = true }) {
  const parts = [];
  if (tilesSaved) parts.push("Tile words were saved.");
  if (tiersMapped === 1) parts.push("One video choice was saved.");
  else if (tiersMapped > 1) parts.push(`${tiersMapped} video choices were saved.`);

  if (failed) {
    parts.push(tiersMapped > 0
      ? "The rest of the video choices could not be saved."
      : "The welcome video could not be mapped.");
  } else if (parts.length === 0) {
    // Nothing to report and nothing failed — only reachable if a save somehow
    // wrote nothing at all. Do not claim a save that did not happen.
    parts.push("Nothing was changed.");
  }
  return parts.join(" ");
}

async function loadBundle(orgId) {
  /* 171_content.sql has shipped (db/migrations runs to 225), so
     display_price_cents and both video tables are on file. The two catches
     below stay only for a database that is one migration behind — a deploy
     preview runs against the old shape until the branch merges, CLAUDE.md §11
     — and each of them forgives exactly ONE SQLSTATE. Anything else is a real
     fault and must reach the caller. A bare catch here turned a missing grant,
     a row-level-security refusal and a typo into the same picture as a working
     empty library: "0 videos". Do not invent a price, and do not invent an
     empty library either. */
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
  } catch (err) {
    /* 42703 = undefined_column, NOT 42P01. entitlement_catalog itself has
       existed since 032_entitlements.sql; 171 only added the COLUMN. So the
       one forgivable failure here is "this database has no
       display_price_cents", and the honest answer to that is an unknown price.
       NULL means "nobody has saved a price", never 0. */
    if (!(err && err.code === "42703")) throw err;
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
  } catch (err) {
    /* 42P01 = undefined_table: 171_content.sql has not been applied to this
       database, so an empty library really is the truth. A grant refusal, a
       row-level-security deny or a typo is NOT that, and every one of them used
       to arrive on screen as "0 videos" — the same picture a working empty
       library paints. Surface those instead of painting over them. */
    if (!(err && err.code === "42P01")) throw err;
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

    /* WHAT ACTUALLY LANDED, tracked as it happens. Every failure message below
       is built from these two, because the screen posts three different shapes
       — tiles only, map only, or both (public/app/content-admin.html) — and a
       message that names work the caller never sent is simply false. */
    let tilesSaved = false;
    let tiersMapped = 0;

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
      /* Only once the WHOLE loop is through. Every exit above is a `return`, so
         this line is unreachable on a partial run. An EMPTY tiles array is not a
         save either — `[]` is truthy, and "tile words were saved" would be a
         claim about nothing. */
      tilesSaved = tiles.length > 0;
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
            tiersMapped += 1;
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
          tiersMapped += 1;
        }
      } catch (err) {
        /* content_tier_map has existed since 171_content.sql, so a failure here
           is a real one — a missing grant, a row-level-security refusal, a bad
           id. Two things were wrong with the old answer:

             1. It said welcome videos "are not stored in the database yet",
                which stopped being true the day 171 landed.
             2. On an UNMAP (every value blank) wantsVideo was false, nothing
                was returned, and execution fell through to the 200 {ok:true}
                below — a DELETE that failed reported as a save that worked.

           The tile UPDATEs above have already committed (this handler opens no
           transaction; every db.query autocommits), so say that much and hand
           back the real cause in the shape this file already uses.

           WHAT IT MAY AND MAY NOT CLAIM. "Tile words were saved" was printed
           unconditionally, and the screen posts { action:'save', map: MAP } with
           NO tiles at all when only the video dropdown moved — so that sentence
           was false on the commonest path to this catch. Same for the other
           half: with two of three tiers already written, "the welcome video
           could not be mapped" is false about the two that landed. Both halves
           are now built from what actually happened. */
        if (dbDown(res, err)) return;
        return res.status(500).json({
          ok: false, error: "map_save_failed",
          message: partialSaveMessage({ tilesSaved, tiersMapped }),
          detail: safeError(err)
        });
      }
    }

    /* THE SAVE IS OVER BY THIS LINE. Every statement above autocommitted, so
       whatever the owner typed is on file. This re-read exists only so the
       screen redraws from the database instead of from its own form, and a
       failure in it is NOT a failed save. It used to fall to the outer catch and
       answer "Something went wrong saving content.", which sent the owner back
       to retry a save that had already worked. dbDown() is deliberately NOT
       consulted here: its 503 says "the database is not answering" and nothing
       about the save, and the save is the half that matters. */
    let bundle;
    try {
      bundle = await loadBundle(orgId);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "saved_but_reread_failed",
        saved: tilesSaved || tiersMapped > 0,
        message: `${partialSaveMessage({ tilesSaved, tiersMapped, failed: false })} `
          + "The screen could not be refreshed, so reload the page to see what is on file.",
        detail: safeError(err)
      });
    }
    return res.status(200).json({ ok: true, action: "save", ...bundle });
  } catch (err) {
    if (dbDown(res, err)) return;
    return res.status(500).json({
      ok: false,
      error: "query_failed",
      /* This catch is reachable on BOTH verbs. On a GET nobody was saving, and
         "Something went wrong saving content." told a reader their page load
         had lost their work. */
      message: method === "GET"
        ? "Content could not be read right now."
        : "Content could not be saved right now.",
      detail: safeError(err)
    });
  }
}
