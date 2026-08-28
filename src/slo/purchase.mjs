// SLO paid-webhook → one sales row on the named client.
// COMPLIANCE REVIEW REQUIRED — payment rails.
//
// The offer comes from an owner SLO connection (funnel ID + ClickFunnels
// product ID). The client comes from fundhub_client_id on the signed payload.
// Email, phone, product name, and price never choose the offer or the person.

import { defaultOrgId } from "../events/bus.mjs";
import { asUuid, findActiveConnection, normCfId } from "./connections.mjs";

const PAID_TYPES = new Set([
  "order.completed",
  "one-time-order.completed",
  "one_time_order.completed",
  "new_purchase"
]);

const MAX_SALE = 1_000_000_000;

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function eventTypeOf(body) {
  const b = body || {};
  const d = asObject(b.data) || b;
  return String(
    b.event_type || b.event || b.type || b.hook || d.event_type || d.type || ""
  ).toLowerCase();
}

export function isPaidClickFunnelsEvent(type) {
  return PAID_TYPES.has(String(type || "").toLowerCase());
}

function pickClientId(...bags) {
  for (const bag of bags) {
    const o = asObject(bag);
    if (!o) continue;
    const raw = o.fundhub_client_id ?? o.fundhubClientId;
    const id = asUuid(raw);
    if (id) return id;
  }
  return null;
}

function collectProductIds(body) {
  const b = body || {};
  const d = asObject(b.data) || {};
  const out = [];
  const push = (v) => {
    const id = normCfId(v);
    if (id && !out.includes(id)) out.push(id);
  };
  const lists = [d.line_items, d.order_items, d.products, b.line_items, b.order_items, b.products];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asObject(item) || {};
      push(row.product_id ?? row.productId ?? row.id);
    }
  }
  push(d.product_id ?? d.productId ?? b.product_id ?? b.productId);
  const product = asObject(d.product) || asObject(b.product);
  if (product) push(product.id ?? product.product_id ?? product.public_id);
  return out;
}

function collectLineAmounts(body) {
  const b = body || {};
  const d = asObject(b.data) || {};
  const lines = [];
  const lists = [d.line_items, d.order_items, b.line_items, b.order_items];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asObject(item) || {};
      const cfProductId = normCfId(row.product_id ?? row.productId ?? row.id);
      if (!cfProductId) continue;
      const amount = amountFromFields(row, eventTypeOf(body));
      lines.push({ cfProductId, amountDollars: amount });
    }
    if (lines.length) return lines;
  }
  return lines;
}

function funnelIdOf(body) {
  const b = body || {};
  const d = asObject(b.data) || {};
  const funnel = asObject(b.funnel) || asObject(d.funnel);
  return normCfId(
    b.funnel_id ??
    d.funnel_id ??
    (funnel && (funnel.id ?? funnel.public_id ?? funnel.uuid)) ??
    null
  );
}

function orderIdOf(body) {
  const b = body || {};
  const d = asObject(b.data) || {};
  return normCfId(
    b.event_id ??
    d.id ??
    b.id ??
    d.public_id ??
    b.order_id ??
    d.order_id ??
    null
  );
}

function dollarsFromCents(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 100;
}

function amountFromFields(obj, type) {
  const o = asObject(obj) || {};
  const centsRaw = o.amount_cents ?? o.total_amount_cents ?? o.invoiced_amount_cents;
  if (centsRaw != null && centsRaw !== "") {
    const n = Number(centsRaw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return dollarsFromCents(n);
  }
  const raw = o.total_amount ?? o.invoiced_amount ?? o.amount ?? o.total ?? o.paid_amount;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" && raw.includes(".")) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isInteger(n)) return n;
  // ClickFunnels 2.0 order totals are integer cents. Classic new_purchase
  // integers are ambiguous dollars-vs-cents — refuse rather than guess.
  if (isPaidClickFunnelsEvent(type) && type !== "new_purchase") {
    return dollarsFromCents(n);
  }
  return null;
}

export function extractSloPaidPurchase(body) {
  const type = eventTypeOf(body);
  if (!isPaidClickFunnelsEvent(type)) {
    return { ok: false, reason: "not_paid_event" };
  }
  const b = body || {};
  const d = asObject(b.data) || {};
  const contact = asObject(d.contact) || asObject(b.contact) || asObject(d.primary_contact);
  const clientId = pickClientId(
    contact && contact.custom_attributes,
    contact && contact.custom_fields,
    d.custom_attributes,
    d.custom_fields,
    b.custom_attributes,
    b.custom_fields,
    contact,
    d,
    b
  );
  if (!clientId) {
    return { ok: false, reason: "no_client_id" };
  }
  const funnelId = funnelIdOf(body);
  if (!funnelId) {
    return { ok: false, reason: "no_funnel_id" };
  }
  const productIds = collectProductIds(body);
  if (!productIds.length) {
    return { ok: false, reason: "no_cf_product_id" };
  }
  const orderAmount = amountFromFields({ ...b, ...d }, type);
  const lines = collectLineAmounts(body);
  const items = productIds.map((cfProductId) => {
    const line = lines.find((l) => l.cfProductId === cfProductId);
    const amountDollars = line && line.amountDollars != null ? line.amountDollars : orderAmount;
    return { cfProductId, amountDollars };
  });
  if (items.some((item) => !(item.amountDollars > 0) || item.amountDollars >= MAX_SALE)) {
    return { ok: false, reason: "no_paid_amount" };
  }
  return {
    ok: true,
    type,
    clientId,
    funnelId,
    orderId: orderIdOf(body),
    items
  };
}

export async function recordSloPurchase(db, {
  orgId,
  clientId,
  productId,
  productName,
  amountDollars,
  providerRef
}) {
  if (!orgId || !clientId || !productId) {
    return { ok: false, reason: "incomplete" };
  }
  const amount = Number(amountDollars);
  if (!(amount > 0) || amount >= MAX_SALE) {
    return { ok: false, reason: "no_paid_amount" };
  }
  const ext = String(providerRef || "").trim() || null;
  if (!ext) return { ok: false, reason: "no_order_id" };

  const client = await db.query(
    `SELECT id FROM clients WHERE org_id = $1::uuid AND id = $2::uuid LIMIT 1`,
    [orgId, clientId]
  );
  if (!client.rows[0]) {
    return { ok: false, reason: "client_not_found" };
  }

  if (ext) {
    const existing = await db.query(
      `SELECT * FROM sales WHERE org_id = $1::uuid AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    if (existing.rows[0]) {
      if (String(existing.rows[0].client_id) !== String(clientId)
        || String(existing.rows[0].product_id) !== String(productId)) {
        return { ok: false, reason: "replay_conflict", sale: existing.rows[0] };
      }
      return { ok: true, created: false, sale: existing.rows[0] };
    }
  }

  const tx = await db.query(
    `INSERT INTO transactions
       (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'succeeded', 'clickfunnels', $5, $6::jsonb)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      orgId, clientId, productName || "slo", amount, ext,
      JSON.stringify({
        source: "slo",
        provider_ref: ext,
        product_id: productId,
        amount_dollars: amount
      })
    ]
  );
  let transaction = tx.rows[0] || null;
  if (!transaction) {
    const again = await db.query(
      `SELECT * FROM transactions WHERE org_id = $1::uuid AND provider_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    transaction = again.rows[0] || null;
  }

  const saleIns = await db.query(
    `INSERT INTO sales
       (org_id, client_id, product_id, agreed_price, currency, sold_at, status, external_ref, notes)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'USD', now(), 'active', $5, $6)
     ON CONFLICT (org_id, external_ref) WHERE external_ref IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [orgId, clientId, productId, amount, ext, "source:slo.clickfunnels"]
  );
  let sale = saleIns.rows[0] || null;
  if (!sale) {
    const again = await db.query(
      `SELECT * FROM sales WHERE org_id = $1::uuid AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    sale = again.rows[0] || null;
  }
  if (!sale) return { ok: false, reason: "sale_not_written" };

  if (transaction?.id) {
    await db.query(
      `INSERT INTO sale_payments
         (org_id, sale_id, transaction_id, product_id, kind, amount, paid_at, notes)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'deposit', $5, now(), $6)
       ON CONFLICT (org_id, transaction_id) WHERE transaction_id IS NOT NULL
       DO NOTHING`,
      [orgId, sale.id, transaction.id, productId, amount, "source:slo.clickfunnels"]
    );
  }

  return { ok: true, created: !!saleIns.rows[0], sale, transaction };
}

export async function handleSloPaidWebhook(db, body) {
  const extracted = extractSloPaidPurchase(body);
  if (!extracted.ok) {
    return { written: [], reason: extracted.reason };
  }
  const orgId = await defaultOrgId(db);
  if (!orgId) {
    return { written: [], reason: "no_org" };
  }
  const written = [];
  for (const item of extracted.items) {
    const connection = await findActiveConnection(db, orgId, extracted.funnelId, item.cfProductId);
    if (!connection) {
      return { written, reason: "unmapped" };
    }
    const providerRef = `clickfunnels:order:${extracted.orderId || "missing"}:${item.cfProductId}`;
    const rec = await recordSloPurchase(db, {
      orgId,
      clientId: extracted.clientId,
      productId: connection.product_id,
      productName: connection.product_name,
      amountDollars: item.amountDollars,
      providerRef
    });
    if (!rec.ok) {
      return { written, reason: rec.reason };
    }
    written.push({
      sale_id: rec.sale?.id || null,
      product_id: connection.product_id,
      cf_product_id: item.cfProductId,
      created: !!rec.created
    });
  }
  return { written, reason: written.length ? "recorded" : "unmapped" };
}
