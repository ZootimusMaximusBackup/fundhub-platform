// Money-chain writers — sale / payment / funding-round / commission / entitlement.
//
// The calculators (src/commissions/) and grant() (src/entitlements/) already
// exist. Nothing called them. This module is the missing wire: live canonical
// events → durable Postgres rows the read APIs and payout screens trust.
//
// Pattern matches src/handlers/client-lifecycle.mjs and payment-links.mjs:
// register() → on(event, handler). Every write is idempotent (Rule 9).
//
// Owner calls made in this session (also in docs/workflows/money-chain-writers.md):
//   1. sale.closed writes the sales row — no separate sale.recorded event.
//   2. Product resolve: name/alias first, then semantic-bucket → product code.
//   3. Attribution only from the event payload (attributions[] / staffId /
//      closerId / advisorId). No invented owner.
//   4. product_entitlements stays empty in migrations; grantFromTransaction
//      no-ops when unmapped. Tests seed the mapping.
//   5. commission.earned is NOT emitted — not in CANONICAL_EVENTS yet.
//
// COMPLIANCE REVIEW REQUIRED: payment rails + fee/commission timing.

import { on } from "../events/registry.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import {
  computeFrontEnd,
  computeBackEnd,
  SQL_RULES_IN_FORCE,
  SQL_ATTRIBUTIONS_FOR_SALE,
  SQL_SALE_CONTEXT,
  SQL_PAYMENTS_FOR_SALE,
  SQL_SALE_FOR_ROUND,
  SQL_RESOLVE_PRODUCT,
  SQL_LINK_ROUND_TO_SALE,
  SQL_INSERT_LEDGER,
  ledgerInsertParams
} from "../commissions/index.mjs";
import { grantFromTransaction } from "../entitlements/entitlements.mjs";
import { createFundingCloseoutSafe } from "../funding/closeout.mjs";

/** Semantic product bucket → products.code when name/alias resolve fails. */
export const BUCKET_TO_CODE = Object.freeze({
  crs: "diagnostic",
  diagnostic: "diagnostic",
  deposit: "card-stacking-dfy",
  success_fee: "card-stacking-dfy",
  diy: "consulting-package",
  unmatched: null
});

/** payment.received product bucket → sale_payments.kind */
export function paymentKindFor(productBucket, sourceEvent) {
  if (sourceEvent === "deposit.paid" || productBucket === "deposit") return "deposit";
  if (productBucket === "success_fee") return "success_fee";
  if (sourceEvent === "diagnostic.paid" || productBucket === "crs") return "deposit";
  if (sourceEvent === "sale.closed" || productBucket === "diy") return "deposit";
  return "installment";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function asUuid(v) {
  if (v == null) return null;
  const s = String(v);
  return UUID_RE.test(s) ? s : null;
}

function saleExternalRef(event) {
  const p = event.payload || {};
  if (p.providerRef) return String(p.providerRef);
  if (p.externalRef) return String(p.externalRef);
  if (event.id) return `event:${event.id}`;
  return null;
}

export async function resolveProductId(db, orgId, { productName, productBucket } = {}) {
  if (!orgId) return null;
  if (productName) {
    const r = await db.query(SQL_RESOLVE_PRODUCT, [orgId, String(productName)]);
    if (r.rows[0]?.product_id) return r.rows[0].product_id;
  }
  const code = BUCKET_TO_CODE[productBucket] || null;
  if (!code) return null;
  const byCode = await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND lower(code) = lower($2) LIMIT 1`,
    [orgId, code]
  );
  return byCode.rows[0]?.id || null;
}

async function loadProduct(db, productId) {
  if (!productId) return null;
  const { rows } = await db.query(
    `SELECT id, org_id, code, name, category, default_price, default_success_fee_percent
       FROM products WHERE id = $1`,
    [productId]
  );
  return rows[0] || null;
}

/** Find or create a sales row. Returns { sale, created, product, clientId }. */
export async function ensureSale(db, event, { productBucket = null } = {}) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) return { sale: null, created: false, product: null, clientId };

  const p = event.payload || {};
  const productId = await resolveProductId(db, orgId, {
    productName: p.productName || p.product || null,
    productBucket: productBucket || p.product || null
  });
  const product = await loadProduct(db, productId);
  if (!product) return { sale: null, created: false, product: null, clientId };

  const ext = saleExternalRef(event);

  if (ext) {
    const existing = await db.query(
      `SELECT * FROM sales WHERE org_id = $1 AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    if (existing.rows[0]) {
      // Same external_ref belonging to a different client is a conflict — never
      // silently attach money to the wrong person. Refuse without throwing so a
      // bus replay of historical stamp collisions can continue.
      if (String(existing.rows[0].client_id) !== String(clientId)) {
        console.warn(
          `[money-chain] sale external_ref ${ext} already belongs to another client — refusing attach`
        );
        return { sale: null, created: false, product, clientId, conflict: true };
      }
      return { sale: existing.rows[0], created: false, product, clientId };
    }
  }

  const prior = await db.query(
    `SELECT * FROM sales
      WHERE org_id = $1 AND client_id = $2 AND product_id = $3 AND status = 'active'
      ORDER BY sold_at DESC LIMIT 1`,
    [orgId, clientId, product.id]
  );
  if (prior.rows[0]) {
    return { sale: prior.rows[0], created: false, product, clientId };
  }

  const amount = p.amount != null && p.amount !== "" ? Number(p.amount) : null;
  // Zero / negative / absurd amounts must not invent a sale.
  // Align with src/commissions/money.mjs MAX_CENTS ($1bn).
  const MAX_SALE = 1_000_000_000;
  if (amount != null && !Number.isNaN(amount) && (amount <= 0 || Math.abs(amount) >= MAX_SALE)) {
    return { sale: null, created: false, product, clientId };
  }
  const agreed = (amount != null && !Number.isNaN(amount) && amount > 0)
    ? amount
    : (product.default_price != null ? Number(product.default_price) : 0);
  if (!(agreed > 0) || Math.abs(agreed) >= MAX_SALE) {
    return { sale: null, created: false, product, clientId };
  }
  const feePct = p.agreedSuccessFeePercent != null
    ? Number(p.agreedSuccessFeePercent)
    : (product.default_success_fee_percent != null
      ? Number(product.default_success_fee_percent)
      : null);
  const soldAt = p.soldAt || p.paidAt || event.occurredAt || new Date().toISOString();

  const ins = await db.query(
    `INSERT INTO sales (
       org_id, client_id, product_id, agreed_price, agreed_success_fee_percent,
       currency, sold_at, status, external_ref, notes
     ) VALUES ($1,$2,$3,$4,$5,'USD',$6,'active',$7,$8)
     ON CONFLICT (org_id, external_ref) WHERE external_ref IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      orgId, clientId, product.id, agreed, feePct, soldAt, ext,
      p.notes || `source:${event.name}`
    ]
  );
  if (ins.rows[0]) {
    return { sale: ins.rows[0], created: true, product, clientId };
  }

  if (ext) {
    const again = await db.query(
      `SELECT * FROM sales WHERE org_id = $1 AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    if (again.rows[0]) {
      return { sale: again.rows[0], created: false, product, clientId };
    }
  }
  return { sale: null, created: false, product, clientId };
}

/** Attribution from the event payload only. Never invents a staff member. */
export async function ensureAttributions(db, { orgId, saleId, event, basisHint = null } = {}) {
  if (!orgId || !saleId) return { written: 0 };
  const p = event.payload || {};
  const list = [];

  if (Array.isArray(p.attributions)) {
    for (const a of p.attributions) {
      if (!a?.staffId) continue;
      list.push({
        staffId: a.staffId,
        role: a.role || (a.basis === "back_end" ? "funding_advisor" : "closer"),
        basis: a.basis || basisHint || "front_end",
        split: a.splitPercent != null ? Number(a.splitPercent) : 100
      });
    }
  }

  if (p.closerId) {
    list.push({
      staffId: p.closerId,
      role: "closer",
      basis: "front_end",
      split: p.closerSplit != null ? Number(p.closerSplit) : 100
    });
  }
  if (p.advisorId) {
    list.push({
      staffId: p.advisorId,
      role: "funding_advisor",
      basis: "back_end",
      split: p.advisorSplit != null ? Number(p.advisorSplit) : 100
    });
  }
  if (p.staffId && list.length === 0) {
    const basis = basisHint || (event.name === "round.funded" ? "back_end" : "front_end");
    list.push({
      staffId: p.staffId,
      role: basis === "back_end" ? "funding_advisor" : "closer",
      basis,
      split: 100
    });
  }

  let written = 0;
  for (const a of list) {
    // The split-check trigger runs BEFORE INSERT and rejects a duplicate 100%
    // row as "200%" before ON CONFLICT can absorb it. Probe first.
    const exists = await db.query(
      `SELECT 1 FROM sale_attributions
        WHERE sale_id = $1 AND staff_id = $2 AND role = $3 AND basis = $4
        LIMIT 1`,
      [saleId, a.staffId, a.role, a.basis]
    );
    if (exists.rows[0]) continue;

    // Replay / second staff at 100%: if this basis already sums to ~100%, skip
    // rather than throwing and killing a morning replay job.
    const basisSum = await db.query(
      `SELECT COALESCE(SUM(split_percent), 0)::float AS s
         FROM sale_attributions
        WHERE sale_id = $1 AND basis = $2`,
      [saleId, a.basis]
    );
    const already = Number(basisSum.rows[0]?.s) || 0;
    if (already + Number(a.split) > 100.0001) continue;

    const r = await db.query(
      `INSERT INTO sale_attributions (org_id, sale_id, staff_id, role, basis, split_percent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (sale_id, staff_id, role, basis) DO NOTHING
       RETURNING id`,
      [orgId, saleId, a.staffId, a.role, a.basis, a.split]
    );
    if (r.rows[0]) written += 1;
  }
  return { written };
}

async function findTransactionId(db, orgId, providerRef) {
  if (!providerRef) return null;
  const { rows } = await db.query(
    `SELECT id FROM transactions
      WHERE org_id = $1 AND provider_ref = $2
      LIMIT 1`,
    [orgId, String(providerRef)]
  );
  return rows[0]?.id || null;
}

export async function ensureSalePayment(db, event, {
  saleId, kind, amount = null
} = {}) {
  const orgId = event.orgId;
  if (!orgId || !saleId) return { payment: null, created: false };

  const p = event.payload || {};
  const paid = amount != null ? Number(amount)
    : (p.amount != null ? Number(p.amount) : null);
  if (paid == null || Number.isNaN(paid) || paid < 0) {
    return { payment: null, created: false };
  }

  const transactionId = await findTransactionId(db, orgId, p.providerRef);
  const sourceEventId = asUuid(event.id);
  if (!transactionId && !sourceEventId) {
    return { payment: null, created: false };
  }
  const paidAt = p.paidAt || new Date().toISOString();

  const ins = await db.query(
    `INSERT INTO sale_payments (
       org_id, sale_id, transaction_id, kind, amount, paid_at, notes, source_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      orgId, saleId, transactionId, kind, paid, paidAt,
      p.notes || `source:${event.name}`, sourceEventId
    ]
  );
  if (ins.rows[0]) return { payment: ins.rows[0], created: true };

  if (transactionId) {
    const ex = await db.query(
      `SELECT * FROM sale_payments WHERE org_id = $1 AND transaction_id = $2 LIMIT 1`,
      [orgId, transactionId]
    );
    if (ex.rows[0]) return { payment: ex.rows[0], created: false };
  }
  if (sourceEventId) {
    const ex = await db.query(
      `SELECT * FROM sale_payments WHERE org_id = $1 AND source_event_id = $2 LIMIT 1`,
      [orgId, sourceEventId]
    );
    if (ex.rows[0]) return { payment: ex.rows[0], created: false };
  }
  return { payment: null, created: false };
}

async function loadRules(db, orgId, basis, asOf) {
  const { rows } = await db.query(SQL_RULES_IN_FORCE, [orgId, basis, asOf]);
  return rows.map((r) => ({
    ...r,
    tiers: typeof r.tiers === "string" ? JSON.parse(r.tiers) : (r.tiers || [])
  }));
}

async function insertDrafts(db, drafts) {
  let inserted = 0;
  for (const draft of drafts) {
    const r = await db.query(SQL_INSERT_LEDGER, ledgerInsertParams(draft));
    if (r.rows[0]) inserted += 1;
  }
  return inserted;
}

export async function writeFrontEndCommissions(db, { saleId, event } = {}) {
  if (!saleId) return { inserted: 0, warnings: [], drafts: [] };

  const ctx = await db.query(SQL_SALE_CONTEXT, [saleId]);
  const saleRow = ctx.rows[0];
  if (!saleRow) return { inserted: 0, warnings: [{ code: "no_sale" }], drafts: [] };

  const attributions = (await db.query(SQL_ATTRIBUTIONS_FOR_SALE, [saleId])).rows;
  const payments = (await db.query(SQL_PAYMENTS_FOR_SALE, [saleId])).rows;
  const asOf = saleRow.sold_at || new Date().toISOString();
  const rules = await loadRules(db, saleRow.org_id, "front_end", asOf);
  const product = {
    id: saleRow.product_id,
    name: saleRow.product_name,
    category: saleRow.product_category
  };
  const client = { id: saleRow.client_id, client_code: saleRow.client_code };
  const occurredAt = event.payload?.paidAt || event.payload?.soldAt || asOf;

  const { drafts, warnings } = computeFrontEnd({
    org_id: saleRow.org_id,
    sale: saleRow,
    product,
    client,
    payments,
    attributions,
    rules,
    occurredAt,
    sourceEvent: event.name
  });

  const inserted = await insertDrafts(db, drafts);
  return { inserted, warnings, drafts };
}

export async function writeBackEndCommissions(db, { roundId, event } = {}) {
  if (!roundId) return { inserted: 0, warnings: [], drafts: [] };

  const link = await db.query(SQL_SALE_FOR_ROUND, [roundId]);
  const saleId = link.rows[0]?.sale_id;
  if (!saleId) {
    return { inserted: 0, warnings: [{ code: "no_sale_link", funding_round_id: roundId }], drafts: [] };
  }

  const ctx = await db.query(SQL_SALE_CONTEXT, [saleId]);
  const saleRow = ctx.rows[0];
  if (!saleRow) return { inserted: 0, warnings: [{ code: "no_sale" }], drafts: [] };

  const round = (await db.query(
    `SELECT id, org_id, client_id, round_number, status,
            submitted_amount, approved_amount, funded_amount, created_at
       FROM funding_rounds WHERE id = $1`,
    [roundId]
  )).rows[0];
  if (!round) return { inserted: 0, warnings: [{ code: "no_round" }], drafts: [] };

  const attributions = (await db.query(SQL_ATTRIBUTIONS_FOR_SALE, [saleId])).rows;
  const asOf = saleRow.sold_at || new Date().toISOString();
  const rules = await loadRules(db, saleRow.org_id, "back_end", asOf);
  const product = {
    id: saleRow.product_id,
    name: saleRow.product_name,
    category: saleRow.product_category
  };
  const client = { id: saleRow.client_id, client_code: saleRow.client_code };
  const occurredAt = event.payload?.fundedAt || event.payload?.paidAt || new Date().toISOString();

  const { drafts, warnings } = computeBackEnd({
    org_id: saleRow.org_id,
    sale: saleRow,
    product,
    client,
    round,
    attributions,
    rules,
    occurredAt,
    sourceEvent: event.name || "round.funded"
  });

  const inserted = await insertDrafts(db, drafts);
  return { inserted, warnings, drafts };
}

async function grantForPurchase(db, event, { clientId, product } = {}) {
  if (!clientId || !product?.code) return { unmapped: true, granted: [], skipped: [] };
  const p = event.payload || {};
  const transactionId = await findTransactionId(db, event.orgId, p.providerRef);
  return grantFromTransaction(db, {
    orgId: event.orgId,
    clientId,
    transactionId,
    productCode: product.code,
    sourceEventId: asUuid(event.id)
  });
}

async function recordPurchase(event, db, { productBucket, paymentKind }) {
  const { sale, product, clientId } = await ensureSale(db, event, { productBucket });
  if (!sale) return { done: false, reason: "no_sale" };

  await ensureAttributions(db, {
    orgId: event.orgId,
    saleId: sale.id,
    event,
    basisHint: "front_end"
  });

  const pay = await ensureSalePayment(db, event, {
    saleId: sale.id,
    kind: paymentKind
  });

  let commission = { inserted: 0, warnings: [] };
  try {
    commission = await writeFrontEndCommissions(db, { saleId: sale.id, event });
  } catch (err) {
    // Replay of adversarial / typo'd huge amounts must not kill the bus.
    if (err && (err.name === "RangeError" || /out of range/i.test(String(err.message || "")))) {
      console.warn(
        `[money-chain] commission refused for sale ${sale.id}: ${err.message}`
      );
      return { done: false, reason: "amount_out_of_range", saleId: sale.id };
    }
    throw err;
  }
  const entitlements = await grantForPurchase(db, event, { clientId, product });

  return {
    done: true,
    saleId: sale.id,
    paymentId: pay.payment?.id || null,
    commissionInserted: commission.inserted,
    entitlements
  };
}

export async function onDiagnosticPaidMoney(event, db) {
  return recordPurchase(event, db, {
    productBucket: "crs",
    paymentKind: paymentKindFor("crs", "diagnostic.paid")
  });
}

export async function onDepositPaidMoney(event, db) {
  return recordPurchase(event, db, {
    productBucket: "deposit",
    paymentKind: paymentKindFor("deposit", "deposit.paid")
  });
}

export async function onSaleClosedMoney(event, db) {
  const bucket = event.payload?.product || "diy";
  return recordPurchase(event, db, {
    productBucket: bucket,
    paymentKind: paymentKindFor(bucket, "sale.closed")
  });
}

/**
 * payment.received — attach money to an existing sale when one is findable,
 * re-fire front-end commission, grant entitlements. Does not invent a sale
 * for unmatched products; deposit.paid / sale.closed / diagnostic.paid own that.
 */
export async function onPaymentReceivedMoney(event, db) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) return { done: false, reason: "no_client" };

  const p = event.payload || {};
  const bucket = p.product || null;
  const ext = saleExternalRef(event);

  let sale = null;
  if (ext) {
    sale = (await db.query(
      `SELECT * FROM sales WHERE org_id = $1 AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    )).rows[0] || null;
  }
  if (!sale) {
    const productId = await resolveProductId(db, orgId, {
      productName: p.productName || p.product || null,
      productBucket: bucket
    });
    if (productId) {
      sale = (await db.query(
        `SELECT * FROM sales
          WHERE org_id = $1 AND client_id = $2 AND product_id = $3 AND status = 'active'
          ORDER BY sold_at DESC LIMIT 1`,
        [orgId, clientId, productId]
      )).rows[0] || null;
    }
  }

  if (!sale && (bucket === "success_fee" || bucket === "unmatched" || !bucket)) {
    sale = (await db.query(
      `SELECT s.* FROM sales s
         JOIN products pr ON pr.id = s.product_id
        WHERE s.org_id = $1 AND s.client_id = $2 AND s.status = 'active'
          AND pr.category = 'funding'
        ORDER BY s.sold_at DESC LIMIT 1`,
      [orgId, clientId]
    )).rows[0] || null;
  }

  if (!sale) {
    const productId = await resolveProductId(db, orgId, {
      productName: p.productName || null,
      productBucket: bucket
    });
    const product = await loadProduct(db, productId);
    const entitlements = await grantForPurchase(db, event, { clientId, product });
    return { done: true, saleId: null, entitlements, reason: "no_sale_yet" };
  }

  const kind = paymentKindFor(bucket, "payment.received");
  const pay = await ensureSalePayment(db, event, { saleId: sale.id, kind });
  const commission = await writeFrontEndCommissions(db, { saleId: sale.id, event });
  const product = await loadProduct(db, sale.product_id);
  const entitlements = await grantForPurchase(db, event, { clientId, product });

  return {
    done: true,
    saleId: sale.id,
    paymentId: pay.payment?.id || null,
    paymentCreated: pay.created,
    commissionInserted: commission.inserted,
    entitlements
  };
}

export async function ensureFundingRound(db, event, { status = "started" } = {}) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) return { round: null, created: false, clientId };

  const p = event.payload || {};
  const roundNumber = Number(p.roundNumber ?? p.round_number ?? 1);
  const sourceEventId = asUuid(event.id);

  if (p.fundingRoundId) {
    const existing = await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1 LIMIT 1`,
      [p.fundingRoundId]
    );
    if (existing.rows[0]) {
      return { round: existing.rows[0], created: false, clientId };
    }
  }

  if (sourceEventId) {
    const byEvent = await db.query(
      `SELECT * FROM funding_rounds WHERE org_id = $1 AND source_event_id = $2 LIMIT 1`,
      [orgId, sourceEventId]
    );
    if (byEvent.rows[0]) {
      return { round: byEvent.rows[0], created: false, clientId };
    }
  }

  const byNum = await db.query(
    `SELECT * FROM funding_rounds WHERE client_id = $1 AND round_number = $2 LIMIT 1`,
    [clientId, roundNumber]
  );
  if (byNum.rows[0]) {
    return { round: byNum.rows[0], created: false, clientId };
  }

  const ins = await db.query(
    `INSERT INTO funding_rounds (
       org_id, client_id, round_number, status, product,
       submitted_amount, approved_amount, funded_amount, source_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (client_id, round_number) DO NOTHING
     RETURNING *`,
    [
      orgId,
      clientId,
      roundNumber,
      status,
      p.product || p.productName || null,
      p.submittedAmount ?? null,
      p.approvedAmount ?? null,
      p.fundedAmount ?? null,
      sourceEventId
    ]
  );
  if (ins.rows[0]) return { round: ins.rows[0], created: true, clientId };

  const again = await db.query(
    `SELECT * FROM funding_rounds WHERE client_id = $1 AND round_number = $2 LIMIT 1`,
    [clientId, roundNumber]
  );
  return { round: again.rows[0] || null, created: false, clientId };
}

export async function onRoundStartedMoney(event, db) {
  const { round, clientId } = await ensureFundingRound(db, event, { status: "started" });
  if (!round) return { done: false, reason: "no_round" };

  const link = await db.query(SQL_LINK_ROUND_TO_SALE, [event.orgId, round.id]);

  let saleId = link.rows[0]?.sale_id || null;
  if (!saleId && event.payload?.saleId) {
    const explicit = await db.query(
      `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
       VALUES ($1,$2,$3,'explicit')
       ON CONFLICT (funding_round_id) DO NOTHING
       RETURNING sale_id`,
      [event.orgId, round.id, event.payload.saleId]
    );
    saleId = explicit.rows[0]?.sale_id || event.payload.saleId;
  }

  if (saleId) {
    await ensureAttributions(db, {
      orgId: event.orgId,
      saleId,
      event,
      basisHint: "back_end"
    });
  }

  return { done: true, fundingRoundId: round.id, saleId, clientId };
}

export async function onRoundFundedMoney(event, db) {
  const p = event.payload || {};
  let round = null;

  // round.funded UPDATES an existing round. It must never INSERT a funded row
  // from nothing — that invented phantom rounds when events arrived out of
  // order (verified 2026-08-04). Fail loudly; require round.started first.
  if (p.fundingRoundId) {
    round = (await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1 LIMIT 1`,
      [p.fundingRoundId]
    )).rows[0] || null;
  }
  if (!round) {
    const clientId = await resolveClient(db, event);
    const roundNumber = Number(p.roundNumber ?? p.round_number ?? 1);
    if (clientId) {
      round = (await db.query(
        `SELECT * FROM funding_rounds
          WHERE client_id = $1 AND round_number = $2
          LIMIT 1`,
        [clientId, roundNumber]
      )).rows[0] || null;
    }
  }
  if (!round) {
    console.error(
      `[money-chain] round.funded refused: no prior funding_rounds row ` +
      `(org=${event.orgId} client=${event.clientId || "?"} ` +
      `fundingRoundId=${p.fundingRoundId || "none"}). Emit round.started first.`
    );
    return {
      done: false,
      reason: "no_prior_round",
      detail: "round.funded requires an existing round from round.started"
    };
  }

  const fundedAmount = p.fundedAmount != null ? Number(p.fundedAmount)
    : (p.approvedAmount != null ? Number(p.approvedAmount) : null);
  const approvedAmount = p.approvedAmount != null ? Number(p.approvedAmount) : null;

  const updated = await db.query(
    `UPDATE funding_rounds
        SET status = 'funded',
            funded_amount = COALESCE($2, funded_amount),
            approved_amount = COALESCE($3, approved_amount),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [round.id, fundedAmount, approvedAmount]
  );
  round = updated.rows[0] || round;

  let link = await db.query(SQL_SALE_FOR_ROUND, [round.id]);
  if (!link.rows[0]) {
    await db.query(SQL_LINK_ROUND_TO_SALE, [event.orgId, round.id]);
    if (p.saleId) {
      await db.query(
        `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
         VALUES ($1,$2,$3,'explicit')
         ON CONFLICT (funding_round_id) DO NOTHING`,
        [event.orgId, round.id, p.saleId]
      );
    }
    link = await db.query(SQL_SALE_FOR_ROUND, [round.id]);
  }

  const saleId = link.rows[0]?.sale_id || null;
  if (saleId) {
    await ensureAttributions(db, {
      orgId: event.orgId,
      saleId,
      event,
      basisHint: "back_end"
    });
  }

  const commission = await writeBackEndCommissions(db, { roundId: round.id, event });

  // Success-fee closeout from Approved applications (10%). Idempotent per round.
  const closeout = await createFundingCloseoutSafe(db, {
    orgId: event.orgId,
    fundingRoundId: round.id,
    feePercent: p.feePercent != null ? Number(p.feePercent) : undefined
  });

  return {
    done: true,
    fundingRoundId: round.id,
    saleId,
    commissionInserted: commission.inserted,
    warnings: commission.warnings,
    closeoutId: closeout.closeout?.id || null,
    closeoutError: closeout.error || null
  };
}

export function register() {
  on("diagnostic.paid", onDiagnosticPaidMoney);
  on("deposit.paid", onDepositPaidMoney);
  on("sale.closed", onSaleClosedMoney);
  on("payment.received", onPaymentReceivedMoney);
  on("round.started", onRoundStartedMoney);
  on("round.funded", onRoundFundedMoney);
}
