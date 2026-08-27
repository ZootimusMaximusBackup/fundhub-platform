// Owner SLO Connections — ClickFunnels funnel + product ID → Fundhub product.
// COMPLIANCE REVIEW REQUIRED — payment rails. This file stores the map only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asUuid(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return UUID_RE.test(s) ? s : null;
}

export function normCfId(v) {
  const s = String(v == null ? "" : v).trim();
  return s || null;
}

function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    cf_funnel_id: row.cf_funnel_id,
    cf_product_id: row.cf_product_id,
    product_id: row.product_id,
    product_code: row.product_code || null,
    product_name: row.product_name || null,
    active: row.active !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

export async function listConnections(db, orgId) {
  if (!orgId) return [];
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cf_funnel_id, c.cf_product_id, c.product_id,
            c.active, c.created_at, c.updated_at,
            p.code AS product_code, p.name AS product_name
       FROM slo_connections c
       JOIN products p ON p.id = c.product_id AND p.org_id = c.org_id
      WHERE c.org_id = $1::uuid
      ORDER BY c.active DESC, c.name ASC`,
    [orgId]
  );
  return rows.map(publicRow);
}

export async function resolveProductInOrg(db, orgId, { productId, productCode } = {}) {
  if (!orgId) return null;
  const id = asUuid(productId);
  if (id) {
    const exact = await db.query(
      `SELECT id, code, name FROM products
        WHERE org_id = $1::uuid AND id = $2::uuid LIMIT 1`,
      [orgId, id]
    );
    return exact.rows[0] || null;
  }
  const code = String(productCode || "").trim();
  if (!code) return null;
  const byCode = await db.query(
    `SELECT id, code, name FROM products
      WHERE org_id = $1::uuid AND lower(code) = lower($2) LIMIT 1`,
    [orgId, code]
  );
  return byCode.rows[0] || null;
}

export async function findActiveConnection(db, orgId, cfFunnelId, cfProductId) {
  const funnel = normCfId(cfFunnelId);
  const product = normCfId(cfProductId);
  if (!orgId || !funnel || !product) return null;
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cf_funnel_id, c.cf_product_id, c.product_id,
            c.active, p.code AS product_code, p.name AS product_name
       FROM slo_connections c
       JOIN products p ON p.id = c.product_id AND p.org_id = c.org_id
      WHERE c.org_id = $1::uuid
        AND c.active = true
        AND lower(btrim(c.cf_funnel_id)) = lower(btrim($2))
        AND lower(btrim(c.cf_product_id)) = lower(btrim($3))
      LIMIT 1`,
    [orgId, funnel, product]
  );
  return rows[0] || null;
}

export async function saveConnection(db, orgId, input = {}) {
  if (!orgId) return { ok: false, error: "org_required", message: "Your sign-in is not attached to a company." };
  const name = String(input.name || "").trim();
  const cfFunnelId = normCfId(input.cf_funnel_id ?? input.cfFunnelId);
  const cfProductId = normCfId(input.cf_product_id ?? input.cfProductId);
  if (!name) return { ok: false, error: "name_required", message: "This connection needs a name." };
  if (!cfFunnelId) {
    return { ok: false, error: "funnel_required", message: "Paste the ClickFunnels funnel ID." };
  }
  if (!cfProductId) {
    return { ok: false, error: "cf_product_required", message: "Paste the ClickFunnels product ID." };
  }
  const product = await resolveProductInOrg(db, orgId, {
    productId: input.product_id ?? input.productId,
    productCode: input.product_code ?? input.productCode
  });
  if (!product) {
    return { ok: false, error: "product_required", message: "Pick a Fundhub product." };
  }
  const active = input.active !== false && input.active !== "false";
  const existingId = asUuid(input.id);

  if (existingId) {
    const owned = await db.query(
      `SELECT id FROM slo_connections WHERE org_id = $1::uuid AND id = $2::uuid LIMIT 1`,
      [orgId, existingId]
    );
    if (!owned.rows[0]) {
      return { ok: false, error: "not_found", message: "No SLO connection with that id." };
    }
    const updated = await db.query(
      `UPDATE slo_connections SET
          name = $3,
          cf_funnel_id = $4,
          cf_product_id = $5,
          product_id = $6::uuid,
          active = $7
        WHERE org_id = $1::uuid AND id = $2::uuid
        RETURNING id, name, cf_funnel_id, cf_product_id, product_id, active, created_at, updated_at`,
      [orgId, existingId, name, cfFunnelId, cfProductId, product.id, active]
    );
    return { ok: true, connection: publicRow({ ...updated.rows[0], product_code: product.code, product_name: product.name }) };
  }

  const inserted = await db.query(
    `INSERT INTO slo_connections
       (org_id, name, cf_funnel_id, cf_product_id, product_id, active)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6)
     RETURNING id, name, cf_funnel_id, cf_product_id, product_id, active, created_at, updated_at`,
    [orgId, name, cfFunnelId, cfProductId, product.id, active]
  );
  return { ok: true, created: true, connection: publicRow({ ...inserted.rows[0], product_code: product.code, product_name: product.name }) };
}
