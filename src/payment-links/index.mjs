// src/payment-links/index.mjs — staff-initiated Commas checkout links.
//
// A payment_links row (119_payment_links.sql) is the ASK: a member of staff
// requested money from a named client for a named reason. It is distinct from
// `invoices` (money owed on the AR ladder) and from `transactions` (money
// actually received, written by src/handlers/client-lifecycle.mjs off
// payment.received). This module only ever moves a link through
// created -> sent -> paid, or -> expired / void. It never writes a
// transaction and never charges anyone — the link is a URL a client visits to
// pay Commas directly.
import crypto from "node:crypto";
import { buildCommasCheckoutUrl } from "../adapters/commas.mjs";
import { createCheckoutSession, checkoutConfig } from "../payments/commas-api.mjs";

const PURPOSES = new Set(["deposit", "diagnostic", "repair", "custom"]);
const SALE_MOTIONS = new Set(["downsell", "upsell"]);
const OPEN_STATUSES = ["created", "sent"];

export function generateLinkRef() {
  return `pl_${crypto.randomBytes(12).toString("hex")}`;
}

async function resolveLinkContext(db, {
  orgId,
  clientId,
  productId = null,
  productCode = null,
  saleId = null,
  saleMotion = null,
  createdByStaffId = null,
  createdByRole = null
}) {
  let product = null;
  if (productId || productCode) {
    const result = await db.query(
      `SELECT id, code
         FROM products
        WHERE org_id = $1
          AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text IS NOT NULL AND lower(code) = lower($3)))
        ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [orgId, productId, productCode]
    );
    product = result.rows[0] || null;
    if (!product) throw new TypeError("createPaymentLink: product identity is not in this org");
    if (productId && productCode && String(product.code).toLowerCase() !== String(productCode).toLowerCase()) {
      throw new TypeError("createPaymentLink: product id and code do not match");
    }
  }
  let sale = null;
  if (saleId) {
    const result = await db.query(
      `SELECT s.id, s.product_id, s.sale_motion, p.code AS product_code
         FROM sales s
         JOIN products p ON p.id = s.product_id
        WHERE s.id = $1 AND s.org_id = $2 AND s.client_id = $3
        LIMIT 1`,
      [saleId, orgId, clientId]
    );
    sale = result.rows[0] || null;
    if (!sale) throw new TypeError("createPaymentLink: sale is not for this client and org");
    if (product && String(sale.product_id) !== String(product.id)) {
      throw new TypeError("createPaymentLink: sale and product identity do not match");
    }
    if (saleMotion != null && sale.sale_motion !== saleMotion) {
      throw new TypeError("createPaymentLink: sale and sale motion do not match");
    }
  } else if (product) {
    sale = (await db.query(
      `SELECT id, product_id
         FROM sales
        WHERE org_id = $1 AND client_id = $2 AND product_id = $3
          AND status = 'active'
          AND sale_motion IS NOT DISTINCT FROM $4::text
        ORDER BY sold_at DESC
        LIMIT 1`,
      [orgId, clientId, product.id, saleMotion]
    )).rows[0] || null;
  }
  if (saleMotion && !product && !sale) {
    throw new TypeError("createPaymentLink: downsell/upsell links require product identity");
  }

  let closerStaffId = createdByRole === "closer" ? createdByStaffId : null;
  let salesManagerStaffId = createdByRole === "sales_manager" ? createdByStaffId : null;

  if (sale) {
    const attrs = (await db.query(
      `SELECT staff_id, role
         FROM sale_attributions
        WHERE sale_id = $1 AND role IN ('closer', 'sales_manager')
        ORDER BY attributed_at DESC`,
      [sale.id]
    )).rows;
    closerStaffId ||= attrs.find((row) => row.role === "closer")?.staff_id || null;
    salesManagerStaffId ||= attrs.find((row) => row.role === "sales_manager")?.staff_id || null;
  }

  if ((product || sale) && (!closerStaffId || !salesManagerStaffId)) {
    const recentActors = (await db.query(
      `SELECT DISTINCT ON (s.role) s.id AS staff_id, s.role
         FROM call_outcomes co
         JOIN staff s ON s.id = co.staff_id AND s.org_id = co.org_id
        WHERE co.org_id = $1
          AND co.client_id = $2
          AND co.logged_at >= now() - interval '24 hours'
          AND s.role IN ('closer', 'sales_manager')
          AND s.status = 'active'
        ORDER BY s.role, co.logged_at DESC`,
      [orgId, clientId]
    )).rows;
    closerStaffId ||= recentActors.find((row) => row.role === "closer")?.staff_id || null;
    salesManagerStaffId ||= recentActors.find((row) => row.role === "sales_manager")?.staff_id || null;
  }

  return {
    productId: product?.id || sale?.product_id || null,
    productCode: product?.code || sale?.product_code || null,
    saleId: sale?.id || null,
    closerStaffId,
    salesManagerStaffId
  };
}

/** createPaymentLink — mints a checkout URL and records the ask.
 *  Prefer FANBASIS_CHECKOUT_API_KEY → live checkout-session API.
 *  Fall back to COMMAS_CHECKOUT_BASE_URL query links only for tests / legacy. */
export async function createPaymentLink(db, {
  orgId, clientId, purpose, description = null, amountCents,
  currency = "USD", createdByStaffId = null, createdByRole = null,
  productId = null, productCode = null, saleId = null, saleMotion = null,
  checkoutBaseUrl,
  env = process.env, fetchImpl = fetch
}) {
  if (!orgId) throw new TypeError("createPaymentLink: orgId is required");
  if (!clientId) throw new TypeError("createPaymentLink: clientId is required");
  if (!PURPOSES.has(purpose)) {
    throw new TypeError(`createPaymentLink: purpose must be one of ${[...PURPOSES].join(", ")}`);
  }
  if (purpose === "custom" && !String(description || "").trim()) {
    throw new TypeError("createPaymentLink: a custom link needs a description");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`createPaymentLink: amountCents must be a positive integer, got ${amountCents}`);
  }
  if (saleMotion != null && !SALE_MOTIONS.has(saleMotion)) {
    throw new TypeError("createPaymentLink: saleMotion must be downsell or upsell");
  }

  const context = await resolveLinkContext(db, {
    orgId,
    clientId,
    productId,
    productCode,
    saleId,
    saleMotion,
    createdByStaffId,
    createdByRole
  });

  const linkRef = generateLinkRef();
  const title = String(description || purpose).trim();
  let checkoutUrl;
  let commasSessionId = null;

  const cfg = checkoutConfig(env);
  if (cfg.ok) {
    const minted = await createCheckoutSession({
      amountCents,
      productTitle: title,
      productDescription: purpose === "diagnostic" ? "UnderwriteIQ soft-pull assessment" : null,
      metadata: {
        link_ref: linkRef,
        client_id: clientId,
        org_id: orgId,
        product_id: context.productId,
        sale_id: context.saleId,
        sale_motion: saleMotion
      },
      env,
      fetchImpl
    });
    if (!minted.ok) {
      const err = new Error(minted.reason || "Commas checkout session failed");
      err.code = "commas_checkout_failed";
      err.status = minted.status || 502;
      throw err;
    }
    checkoutUrl = minted.paymentLink;
    commasSessionId = minted.productId != null ? String(minted.productId) : null;
  } else if (checkoutBaseUrl) {
    checkoutUrl = buildCommasCheckoutUrl({
      baseUrl: checkoutBaseUrl,
      linkRef,
      amountCents,
      description: title
    });
  } else {
    const err = new Error(cfg.reason || "No Commas checkout configured");
    err.code = "commas_not_configured";
    err.status = 503;
    throw err;
  }

  const result = await db.query(
    `INSERT INTO payment_links
       (org_id, client_id, purpose, description, amount_cents, currency,
        link_ref, checkout_url, created_by_staff_id, commas_session_id,
        product_id, sale_id, sale_motion, closer_staff_id, sales_manager_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      orgId, clientId, purpose, description, amountCents, currency,
      linkRef, checkoutUrl, createdByStaffId, commasSessionId,
      context.productId, context.saleId, saleMotion,
      context.closerStaffId, context.salesManagerStaffId
    ]
  );
  return result.rows[0];
}

/** markSent — created -> sent. Idempotent: a link already sent (or paid) is
 *  untouched and the call returns null rather than clobbering a later state. */
export async function markSent(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'sent', sent_at = $3
      WHERE id = $1 AND org_id = $2 AND status = 'created'
     RETURNING *`,
    [id, orgId, at]
  );
  return result.rows[0] ?? null;
}

/** markExpired — created/sent -> expired. A staff action, not automatic: this
 *  repo has no scheduler that walks stale links, so a link only expires when
 *  someone says it has. */
export async function markExpired(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'expired', expired_at = $3
      WHERE id = $1 AND org_id = $2 AND status = ANY($4)
     RETURNING *`,
    [id, orgId, at, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

/** markPaid — created/sent -> paid, keyed by the link's OWN reference. */
export async function markPaid(db, { linkRef, commasSessionId = null, paidAmountCents = null, paidAt = new Date() }) {
  if (!linkRef) throw new TypeError("markPaid: linkRef is required");
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = $2, commas_session_id = COALESCE($3, commas_session_id), paid_amount_cents = $4
      WHERE link_ref = $1 AND status = ANY($5)
     RETURNING *`,
    [linkRef, paidAt, commasSessionId, paidAmountCents, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

/** markPaidBySession — fallback when webhook metadata lost link_ref but still
 *  carries the Commas product / session id we stored at mint time. */
export async function markPaidBySession(db, {
  commasSessionId, paidAmountCents = null, paidAt = new Date()
}) {
  if (!commasSessionId) throw new TypeError("markPaidBySession: commasSessionId is required");
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = $2, paid_amount_cents = $3
      WHERE commas_session_id = $1 AND status = ANY($4)
     RETURNING *`,
    [String(commasSessionId), paidAt, paidAmountCents, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

export async function getPaymentLink(db, { id, orgId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return result.rows[0] ?? null;
}

export async function getByLinkRef(db, { linkRef }) {
  const result = await db.query(`SELECT * FROM payment_links WHERE link_ref = $1`, [linkRef]);
  return result.rows[0] ?? null;
}

export async function listPaymentLinksForClient(db, { orgId, clientId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC`,
    [orgId, clientId]
  );
  return result.rows;
}
