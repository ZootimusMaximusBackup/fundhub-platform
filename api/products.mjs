// POST /api/products — write half of Products & Commissions
// (public/app/products-commissions.html).
//
//   { action: "save",   code, name, category, default_price,
//                       min_price, max_price, price_is_variable,
//                       default_success_fee_percent? }
//   { action: "create", name, category?, default_price?, ... }
//
// Save used to mutate an in-memory PRODUCTS array and paint the table — a
// reload threw every edit away. Prices here are DEFAULTS only (010_products.sql);
// sales carry the agreed terms. Nothing here invents a "rails" column — that
// has no source in the products table.
//
// requireAuth then requireRole. Org from the session. Nothing transmits.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const ACTIONS = new Set(["save", "create"]);

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function codeFromName(name) {
  const base = String(name || "product")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "product";
  return base;
}

function publicProduct(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    default_price: row.default_price == null ? null : Number(row.default_price),
    min_price: row.min_price == null ? null : Number(row.min_price),
    max_price: row.max_price == null ? null : Number(row.max_price),
    price_is_variable: !!row.price_is_variable,
    default_success_fee_percent: row.default_success_fee_percent == null
      ? null : Number(row.default_success_fee_percent),
    active: row.active !== false,
    sort_order: row.sort_order
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "This screen only accepts a save request, not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false, error: "unknown_action",
      message: "Unknown action. Use save or create."
    });
  }

  try {
    if (action === "create") {
      const name = String(body.name || "").trim();
      if (!name) {
        return res.status(400).json({
          ok: false, error: "name_required",
          message: "A product needs a name."
        });
      }
      let code = String(body.code || "").trim().toLowerCase() || codeFromName(name);
      // Ensure unique code in this org.
      for (let i = 0; i < 20; i++) {
        const clash = await db.query(
          `SELECT 1 FROM products WHERE org_id = $1::uuid AND lower(code) = lower($2) LIMIT 1`,
          [orgId, code]
        );
        if (!clash.rows[0]) break;
        code = codeFromName(name) + "_" + (i + 2);
      }

      const variable = body.price_is_variable !== false;
      const defaultPrice = numOrNull(body.default_price);
      const minPrice = numOrNull(body.min_price);
      const maxPrice = numOrNull(body.max_price);
      if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
        return res.status(400).json({
          ok: false, error: "invalid_price_band",
          message: "Minimum cannot exceed maximum."
        });
      }

      const maxSort = await db.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE org_id = $1::uuid`,
        [orgId]
      );

      const inserted = await db.query(
        `INSERT INTO products
           (org_id, code, name, category, default_price, min_price, max_price,
            price_is_variable, default_success_fee_percent, sort_order)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          orgId, code, name,
          String(body.category || "").trim() || null,
          defaultPrice, minPrice, maxPrice, variable,
          numOrNull(body.default_success_fee_percent),
          Number(maxSort.rows[0].m) + 10
        ]
      );
      return res.status(201).json({
        ok: true, action: "create", product: publicProduct(inserted.rows[0])
      });
    }

    /* save */
    const code = String(body.code || "").trim();
    if (!code) {
      return res.status(400).json({
        ok: false, error: "code_required",
        message: "Which product? Send its code."
      });
    }
    const current = await db.query(
      `SELECT * FROM products WHERE org_id = $1::uuid AND lower(code) = lower($2) LIMIT 1`,
      [orgId, code]
    );
    if (!current.rows[0]) {
      return res.status(404).json({
        ok: false, error: "not_found",
        message: "No product with that code in your company."
      });
    }

    const name = String(body.name != null ? body.name : current.rows[0].name).trim();
    if (!name) {
      return res.status(400).json({
        ok: false, error: "name_required",
        message: "A product needs a name."
      });
    }
    const variable = body.price_is_variable != null
      ? !!body.price_is_variable
      : !!current.rows[0].price_is_variable;
    const defaultPrice = body.default_price !== undefined
      ? numOrNull(body.default_price)
      : (current.rows[0].default_price == null ? null : Number(current.rows[0].default_price));
    const minPrice = body.min_price !== undefined
      ? numOrNull(body.min_price)
      : (current.rows[0].min_price == null ? null : Number(current.rows[0].min_price));
    const maxPrice = body.max_price !== undefined
      ? numOrNull(body.max_price)
      : (current.rows[0].max_price == null ? null : Number(current.rows[0].max_price));
    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      return res.status(400).json({
        ok: false, error: "invalid_price_band",
        message: "Minimum cannot exceed maximum."
      });
    }

    const updated = await db.query(
      `UPDATE products SET
          name = $3,
          category = $4,
          default_price = $5,
          min_price = $6,
          max_price = $7,
          price_is_variable = $8,
          default_success_fee_percent = COALESCE($9, default_success_fee_percent),
          updated_at = now()
        WHERE org_id = $1::uuid AND id = $2::uuid
        RETURNING *`,
      [
        orgId,
        current.rows[0].id,
        name,
        body.category !== undefined
          ? (String(body.category || "").trim() || null)
          : current.rows[0].category,
        defaultPrice,
        minPrice,
        maxPrice,
        variable,
        body.default_success_fee_percent !== undefined
          ? numOrNull(body.default_success_fee_percent)
          : null
      ]
    );
    return res.status(200).json({
      ok: true, action: "save", product: publicProduct(updated.rows[0])
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({
        ok: false, error: "duplicate_name",
        message: "Another product already uses that name."
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
