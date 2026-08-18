// The full canonical offer stack, for one closer and for the whole floor.
//
// My Numbers and Sales Floor read call_outcomes, which is the funding-call
// disposition log. That is one offer out of five. This module reads the
// canonical list from `products` and the money from `sales` / `sale_payments`,
// so every offer appears — including the ones with nothing sold this period.
// A zero row is the honest answer; a missing row is not.
//
// ATTRIBUTION. `sales` has no staff_id column. A sale ties to a closer only
// through commission_ledger.sale_id -> commission_ledger.staff_id. A sale with
// no ledger row is real revenue that belongs to nobody yet. It is reported
// separately as unattributed and is never spread across closers, because
// guessing whose it is would be inventing.
//
// PERIOD BASIS. Two different clocks, on purpose, and both are labelled in the
// response so a screen can say which is which:
//   units / sold  — sales whose sold_at falls in the period
//   collected     — payments whose paid_at falls in the period, whenever sold
// Collected matches how cash is already counted on these screens (money in the
// door this month), so the two numbers on one row do not contradict each other.

import { toCents } from "../commissions/money.mjs";
import { demoClause, orgDemoModeEnabled } from "../demo/exclude-demo.mjs";
import { formatUsdFromCents } from "./metrics.mjs";

export const OFFER_STACK_BASIS = Object.freeze({
  units: "sales sold in this period",
  sold: "agreed price on sales sold in this period",
  collected: "payments received in this period, minus refunds",
  attribution: "commission_ledger"
});

/**
 * Attribution filter as a SQL fragment. `params` is mutated to append binds.
 *
 * staffId      -> only sales with a commission row for that closer
 * unattributed -> only sales with no commission row at all
 * neither      -> every sale in the org
 */
function attributionClause(alias, params, { staffId = null, unattributed = false } = {}) {
  if (unattributed) {
    return `AND NOT EXISTS (
              SELECT 1 FROM commission_ledger cl
               WHERE cl.sale_id = ${alias}.id AND cl.org_id = ${alias}.org_id
            )`;
  }
  if (staffId) {
    params.push(staffId);
    return `AND EXISTS (
              SELECT 1 FROM commission_ledger cl
               WHERE cl.sale_id = ${alias}.id AND cl.org_id = ${alias}.org_id
                 AND cl.staff_id = $${params.length}
            )`;
  }
  return "";
}

/**
 * The canonical stack: every active product, plus any retired product that
 * still had a sale in the period. Retired products are never dropped when they
 * carry money — that would silently shrink the total.
 */
async function canonicalProducts(db, { orgId, start, end, includeDemo }) {
  const r = await db.query(
    `SELECT p.id AS product_id, p.code, p.name, p.category,
            p.sort_order, p.active
       FROM products p
      WHERE p.org_id = $1
        AND (
          p.active IS TRUE
          OR EXISTS (
               SELECT 1 FROM sales s
                WHERE s.product_id = p.id AND s.org_id = p.org_id
                  AND s.sold_at >= $2 AND s.sold_at < $3
                  ${demoClause("s", { includeDemo })}
             )
        )
      ORDER BY p.sort_order NULLS LAST, p.name`,
    [orgId, start.toISOString(), end.toISOString()]
  );
  return r.rows.map((row) => ({
    product_id: row.product_id,
    code: row.code,
    name: row.name,
    category: row.category,
    sort_order: row.sort_order == null ? null : Number(row.sort_order),
    active: row.active === true
  }));
}

/** Units and agreed price, grouped by product. Optionally by staff too. */
async function soldByProduct(db, { orgId, start, end, includeDemo, staffId, unattributed, byStaff }) {
  const params = [orgId, start.toISOString(), end.toISOString()];
  const attribution = attributionClause("s", params, { staffId, unattributed });
  const staffSelect = byStaff ? `cl.staff_id,` : "";
  const staffJoin = byStaff
    ? `JOIN LATERAL (
         SELECT DISTINCT cl2.staff_id
           FROM commission_ledger cl2
          WHERE cl2.sale_id = s.id AND cl2.org_id = s.org_id
       ) cl ON true`
    : "";
  const staffGroup = byStaff ? `cl.staff_id,` : "";

  const r = await db.query(
    `SELECT ${staffSelect} s.product_id,
            count(*) FILTER (WHERE s.status = 'active')::int    AS units,
            count(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled_units,
            count(*) FILTER (WHERE s.status = 'refunded')::int  AS refunded_units,
            COALESCE(SUM(s.agreed_price) FILTER (WHERE s.status = 'active'), 0) AS sold_dollars
       FROM sales s
       ${staffJoin}
      WHERE s.org_id = $1
        AND s.sold_at >= $2 AND s.sold_at < $3
        ${demoClause("s", { includeDemo })}
        ${attribution}
      GROUP BY ${staffGroup} s.product_id`,
    params
  );
  return r.rows;
}

/** Money actually received, grouped by product. Refunds subtract. */
async function collectedByProduct(db, { orgId, start, end, includeDemo, staffId, unattributed, byStaff }) {
  const params = [orgId, start.toISOString(), end.toISOString()];
  const attribution = attributionClause("s", params, { staffId, unattributed });
  const staffSelect = byStaff ? `cl.staff_id,` : "";
  const staffJoin = byStaff
    ? `JOIN LATERAL (
         SELECT DISTINCT cl2.staff_id
           FROM commission_ledger cl2
          WHERE cl2.sale_id = s.id AND cl2.org_id = s.org_id
       ) cl ON true`
    : "";
  const staffGroup = byStaff ? `cl.staff_id,` : "";

  const r = await db.query(
    `SELECT ${staffSelect} s.product_id,
            COALESCE(SUM(sp.amount) FILTER (WHERE sp.kind <> 'refund'), 0) AS in_dollars,
            COALESCE(SUM(sp.amount) FILTER (WHERE sp.kind =  'refund'), 0) AS refund_dollars
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id AND s.org_id = sp.org_id
       ${staffJoin}
      WHERE sp.org_id = $1
        AND sp.paid_at >= $2 AND sp.paid_at < $3
        ${demoClause("s", { includeDemo })}
        ${attribution}
      GROUP BY ${staffGroup} s.product_id`,
    params
  );
  return r.rows;
}

function keyOf(row, byStaff) {
  return byStaff ? `${row.staff_id}::${row.product_id}` : String(row.product_id);
}

/**
 * Assemble the response rows. Every canonical product gets an entry, in
 * sort_order, whether or not it sold anything.
 */
function buildStack(products, sold, collected, { staffId = null, byStaff = false } = {}) {
  const soldMap = new Map();
  for (const row of sold) soldMap.set(keyOf(row, byStaff), row);
  const paidMap = new Map();
  for (const row of collected) paidMap.set(keyOf(row, byStaff), row);

  const items = products.map((p) => {
    const k = byStaff ? `${staffId}::${p.product_id}` : String(p.product_id);
    const s = soldMap.get(k);
    const c = paidMap.get(k);

    const units = Number(s?.units || 0);
    const soldCents = s ? toCents(s.sold_dollars) : 0;
    const refundedCents = c ? toCents(c.refund_dollars) : 0;
    const collectedCents = c ? toCents(c.in_dollars) - refundedCents : 0;

    return {
      product_id: p.product_id,
      code: p.code,
      name: p.name,
      category: p.category,
      sort_order: p.sort_order,
      active: p.active,
      units,
      sold_cents: soldCents,
      sold_display: formatUsdFromCents(soldCents),
      collected_cents: collectedCents,
      collected_display: formatUsdFromCents(collectedCents),
      refunded_cents: refundedCents,
      cancelled_units: Number(s?.cancelled_units || 0),
      refunded_units: Number(s?.refunded_units || 0)
    };
  });

  const totals = items.reduce(
    (acc, it) => ({
      units: acc.units + it.units,
      sold_cents: acc.sold_cents + it.sold_cents,
      collected_cents: acc.collected_cents + it.collected_cents,
      refunded_cents: acc.refunded_cents + it.refunded_cents
    }),
    { units: 0, sold_cents: 0, collected_cents: 0, refunded_cents: 0 }
  );

  return {
    items,
    totals: {
      ...totals,
      sold_display: formatUsdFromCents(totals.sold_cents),
      collected_display: formatUsdFromCents(totals.collected_cents)
    }
  };
}

function emptyStack(reason) {
  return {
    available: false,
    reason,
    items: [],
    totals: {
      units: 0,
      sold_cents: null,
      sold_display: null,
      collected_cents: null,
      collected_display: null,
      refunded_cents: null
    }
  };
}

function noProductsReason() {
  return "No products are set up yet, so there is no offer stack to count. Add products on the Products and Commissions screen.";
}

/** One closer's offer stack, credited through the commission ledger. */
export async function closerOfferStack(db, { orgId, staffId, start, end } = {}) {
  if (!orgId || !staffId) throw new TypeError("closerOfferStack: orgId and staffId required");
  try {
    const includeDemo = await orgDemoModeEnabled(db, orgId);
    const products = await canonicalProducts(db, { orgId, start, end, includeDemo });
    if (!products.length) return emptyStack(noProductsReason());

    const [sold, collected] = await Promise.all([
      soldByProduct(db, { orgId, start, end, includeDemo, staffId }),
      collectedByProduct(db, { orgId, start, end, includeDemo, staffId })
    ]);

    return {
      available: true,
      reason: null,
      period: { start: start.toISOString(), end: end.toISOString(), label: "this month" },
      basis: OFFER_STACK_BASIS,
      ...buildStack(products, sold, collected)
    };
  } catch (e) {
    if (isMissingTable(e)) return emptyStack(missingTableReason(e));
    throw e;
  }
}

/**
 * The floor: the whole org's stack, the unattributed remainder, and one stack
 * per closer keyed by staff id — all in a fixed number of queries, never one
 * per closer.
 */
export async function floorOfferStack(db, { orgId, start, end } = {}) {
  if (!orgId) throw new TypeError("floorOfferStack: orgId required");
  try {
    const includeDemo = await orgDemoModeEnabled(db, orgId);
    const products = await canonicalProducts(db, { orgId, start, end, includeDemo });
    if (!products.length) {
      return { stack: emptyStack(noProductsReason()), unattributed: null, byCloser: new Map() };
    }

    const [sold, collected, soldNone, collectedNone, soldStaff, collectedStaff] = await Promise.all([
      soldByProduct(db, { orgId, start, end, includeDemo }),
      collectedByProduct(db, { orgId, start, end, includeDemo }),
      soldByProduct(db, { orgId, start, end, includeDemo, unattributed: true }),
      collectedByProduct(db, { orgId, start, end, includeDemo, unattributed: true }),
      soldByProduct(db, { orgId, start, end, includeDemo, byStaff: true }),
      collectedByProduct(db, { orgId, start, end, includeDemo, byStaff: true })
    ]);

    const base = {
      available: true,
      reason: null,
      period: { start: start.toISOString(), end: end.toISOString(), label: "this month" },
      basis: OFFER_STACK_BASIS
    };

    const orphan = buildStack(products, soldNone, collectedNone);
    const unattributed = orphan.totals.units > 0 || orphan.totals.collected_cents > 0
      ? {
          ...base,
          reason: "These sales have no closer on them yet. A sale only counts for a person once it has a commission row, so this money is real but is not credited to anyone.",
          ...orphan
        }
      : null;

    const staffIds = new Set([
      ...soldStaff.map((r) => r.staff_id),
      ...collectedStaff.map((r) => r.staff_id)
    ].filter(Boolean));

    const byCloser = new Map();
    for (const sid of staffIds) {
      byCloser.set(sid, {
        ...base,
        ...buildStack(products, soldStaff, collectedStaff, { staffId: sid, byStaff: true })
      });
    }

    return {
      stack: { ...base, ...buildStack(products, sold, collected) },
      unattributed,
      byCloser,
      products
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { stack: emptyStack(missingTableReason(e)), unattributed: null, byCloser: new Map() };
    }
    throw e;
  }
}

/** A closer with no sales still needs a full zero stack, not a blank. */
export function zeroStackFrom(products, { start, end } = {}) {
  if (!products || !products.length) return emptyStack(noProductsReason());
  return {
    available: true,
    reason: null,
    period: start && end ? { start: start.toISOString(), end: end.toISOString(), label: "this month" } : null,
    basis: OFFER_STACK_BASIS,
    ...buildStack(products, [], [])
  };
}

/** 42P01 = undefined_table. Anything else is a real error and must surface. */
function isMissingTable(e) {
  return e && (e.code === "42P01" || e.code === "42703");
}

function missingTableReason(e) {
  return e?.code === "42703"
    ? "The sales tables are missing a column this needs, so the offer stack cannot be counted yet."
    : "The sales tables are not set up in this database yet, so there is no offer stack to count.";
}
