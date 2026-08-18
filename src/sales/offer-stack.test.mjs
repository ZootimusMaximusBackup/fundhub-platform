import { test } from "node:test";
import assert from "node:assert/strict";
import { closerOfferStack, floorOfferStack, zeroStackFrom, OFFER_STACK_BASIS } from "./offer-stack.mjs";

const START = new Date("2026-08-01T00:00:00Z");
const END = new Date("2026-09-01T00:00:00Z");

/** The five seeded products, as canonicalProducts returns them. */
const PRODUCTS = [
  { product_id: "p-diag", code: "diagnostic", name: "$32 Diagnostic", category: "diagnostic", sort_order: 10, active: true },
  { product_id: "p-css", code: "card-stacking-dfy", name: "Card Stacking DFY", category: "funding", sort_order: 20, active: true },
  { product_id: "p-con", code: "consulting-package", name: "Consulting Services Package", category: "consulting", sort_order: 30, active: true },
  { product_id: "p-rep", code: "repair-bundle", name: "Credit Repair Bundle", category: "repair", sort_order: 40, active: true },
  { product_id: "p-inq", code: "inquiry-removal", name: "Inquiry Removal", category: "inquiry_removal", sort_order: 50, active: true }
];

/**
 * Fake db. Routes on the SQL text the module actually sends.
 * `sold` / `collected` are the aggregate rows to hand back.
 */
function fakeDb({ products = PRODUCTS, sold = [], collected = [], demoMode = false, seen = [] } = {}) {
  return {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM orgs WHERE id/.test(sql)) return { rows: [{ demo_mode_enabled: demoMode }] };
      if (/FROM products p/.test(sql)) return { rows: products };
      if (/FROM sale_payments sp/.test(sql)) {
        return { rows: pick(collected, sql) };
      }
      if (/FROM sales s/.test(sql)) {
        return { rows: pick(sold, sql) };
      }
      return { rows: [] };
    }
  };
}

/** Split the fixture by which scope the query is asking for. */
function pick(rows, sql) {
  const wantsUnattributed = /NOT EXISTS/.test(sql);
  const wantsStaff = /cl\.staff_id,/.test(sql);
  const wantsOneCloser = /cl\.staff_id = \$/.test(sql);
  return rows.filter((r) => {
    if (wantsUnattributed) return r.scope === "unattributed";
    if (wantsStaff) return r.scope === "by_staff";
    if (wantsOneCloser) return r.scope === "one_closer";
    return r.scope === "all";
  });
}

/** The sales aggregate query — not the products query, which mentions
 *  `FROM sales s` inside an EXISTS subquery. */
function isSalesAggregate(q) {
  return /count\(\*\) FILTER \(WHERE s\.status = 'active'\)/.test(q.sql);
}

test("every canonical product appears, even the ones that sold nothing", async () => {
  const db = fakeDb({
    sold: [{ scope: "one_closer", product_id: "p-css", units: 2, cancelled_units: 0, refunded_units: 0, sold_dollars: "6000.00" }],
    collected: [{ scope: "one_closer", product_id: "p-css", in_dollars: "3000.00", refund_dollars: "0.00" }]
  });

  const stack = await closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END });

  assert.equal(stack.available, true);
  assert.equal(stack.items.length, 5, "all five offers, not just the one with sales");
  assert.deepEqual(
    stack.items.map((i) => i.code),
    ["diagnostic", "card-stacking-dfy", "consulting-package", "repair-bundle", "inquiry-removal"]
  );

  const funding = stack.items.find((i) => i.code === "card-stacking-dfy");
  assert.equal(funding.units, 2);
  assert.equal(funding.sold_cents, 600000);
  assert.equal(funding.sold_display, "$6,000");
  assert.equal(funding.collected_cents, 300000);

  // The four that sold nothing are real zero rows, not missing rows.
  for (const code of ["diagnostic", "consulting-package", "repair-bundle", "inquiry-removal"]) {
    const row = stack.items.find((i) => i.code === code);
    assert.equal(row.units, 0, code);
    assert.equal(row.sold_cents, 0, code);
  }

  assert.equal(stack.totals.units, 2);
  assert.equal(stack.totals.sold_cents, 600000);
});

test("refunds subtract from collected and are reported on their own", async () => {
  const db = fakeDb({
    sold: [{ scope: "one_closer", product_id: "p-rep", units: 3, cancelled_units: 1, refunded_units: 1, sold_dollars: "6000.00" }],
    collected: [{ scope: "one_closer", product_id: "p-rep", in_dollars: "5000.00", refund_dollars: "2000.00" }]
  });

  const stack = await closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END });
  const repair = stack.items.find((i) => i.code === "repair-bundle");

  assert.equal(repair.collected_cents, 300000, "5000 in minus 2000 refunded");
  assert.equal(repair.refunded_cents, 200000);
  assert.equal(repair.cancelled_units, 1);
  assert.equal(repair.refunded_units, 1);
  assert.equal(stack.totals.collected_cents, 300000);
});

test("a closer's stack is credited through the commission ledger, never a guess", async () => {
  const seen = [];
  const db = fakeDb({ seen });
  await closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END });

  const salesQ = seen.find(isSalesAggregate);
  assert.match(salesQ.sql, /commission_ledger/);
  assert.match(salesQ.sql, /cl\.staff_id = \$/);
  assert.ok(salesQ.params.includes("s-1"));
  assert.doesNotMatch(salesQ.sql, /\bDELETE\b/i);
  assert.equal(OFFER_STACK_BASIS.attribution, "commission_ledger");
});

test("floor separates sales that belong to nobody instead of spreading them", async () => {
  const db = fakeDb({
    sold: [
      { scope: "all", product_id: "p-css", units: 5, cancelled_units: 0, refunded_units: 0, sold_dollars: "15000.00" },
      { scope: "unattributed", product_id: "p-css", units: 2, cancelled_units: 0, refunded_units: 0, sold_dollars: "6000.00" },
      { scope: "by_staff", staff_id: "s-1", product_id: "p-css", units: 3, cancelled_units: 0, refunded_units: 0, sold_dollars: "9000.00" }
    ],
    collected: [
      { scope: "all", product_id: "p-css", in_dollars: "7000.00", refund_dollars: "0.00" },
      { scope: "unattributed", product_id: "p-css", in_dollars: "2000.00", refund_dollars: "0.00" },
      { scope: "by_staff", staff_id: "s-1", product_id: "p-css", in_dollars: "5000.00", refund_dollars: "0.00" }
    ]
  });

  const { stack, unattributed, byCloser } = await floorOfferStack(db, { orgId: "org-1", start: START, end: END });

  assert.equal(stack.totals.units, 5, "floor total is every sale");
  assert.equal(unattributed.totals.units, 2, "the orphans are held apart");
  assert.match(unattributed.reason, /no closer/i);
  assert.equal(byCloser.get("s-1").totals.units, 3, "the closer keeps only their own");
  assert.equal(byCloser.get("s-1").items.length, 5, "a closer still sees the whole stack");
  // 3 credited + 2 orphaned = the 5 on the floor. The gap is explained, not hidden.
  assert.equal(byCloser.get("s-1").totals.units + unattributed.totals.units, stack.totals.units);
});

test("no orphan sales means no unattributed block at all", async () => {
  const db = fakeDb({
    sold: [{ scope: "all", product_id: "p-css", units: 4, cancelled_units: 0, refunded_units: 0, sold_dollars: "12000.00" }],
    collected: []
  });
  const { unattributed } = await floorOfferStack(db, { orgId: "org-1", start: START, end: END });
  assert.equal(unattributed, null);
});

test("a closer with no sales gets a full zero stack, not a blank", () => {
  const stack = zeroStackFrom(PRODUCTS, { start: START, end: END });
  assert.equal(stack.available, true);
  assert.equal(stack.items.length, 5);
  assert.equal(stack.totals.units, 0);
  assert.equal(stack.totals.sold_cents, 0);
});

test("no products set up says so in plain English instead of showing zero", async () => {
  const db = fakeDb({ products: [] });
  const stack = await closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END });
  assert.equal(stack.available, false);
  assert.match(stack.reason, /No products are set up yet/);
  assert.equal(stack.totals.sold_cents, null, "unknown stays null, never 0");
  assert.equal(stack.totals.sold_display, null);
});

test("missing sales tables report the gap instead of throwing or faking a zero", async () => {
  const db = {
    async query(sql) {
      if (/FROM orgs WHERE id/.test(sql)) return { rows: [{ demo_mode_enabled: false }] };
      const e = new Error('relation "sales" does not exist');
      e.code = "42P01";
      throw e;
    }
  };
  const stack = await closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END });
  assert.equal(stack.available, false);
  assert.match(stack.reason, /not set up in this database yet/);
  assert.equal(stack.totals.collected_cents, null);
});

test("a real database error still surfaces — it is not swallowed as an empty stack", async () => {
  const db = {
    async query(sql) {
      if (/FROM orgs WHERE id/.test(sql)) return { rows: [{ demo_mode_enabled: false }] };
      const e = new Error("connection terminated");
      e.code = "57P01";
      throw e;
    }
  };
  await assert.rejects(
    () => closerOfferStack(db, { orgId: "org-1", staffId: "s-1", start: START, end: END }),
    /connection terminated/
  );
});

test("demo rows are excluded unless the org has demo mode on", async () => {
  const offSeen = [];
  await closerOfferStack(fakeDb({ seen: offSeen, demoMode: false }), {
    orgId: "org-1", staffId: "s-1", start: START, end: END
  });
  const offQ = offSeen.find(isSalesAggregate);
  assert.match(offQ.sql, /is_demo/, "demo rows filtered out when demo mode is off");

  const onSeen = [];
  await closerOfferStack(fakeDb({ seen: onSeen, demoMode: true }), {
    orgId: "org-1", staffId: "s-1", start: START, end: END
  });
  const onQ = onSeen.find(isSalesAggregate);
  assert.doesNotMatch(onQ.sql, /is_demo/, "demo rows included when demo mode is on");
});

test("every query is scoped to one org", async () => {
  const seen = [];
  await floorOfferStack(fakeDb({ seen }), { orgId: "org-1", start: START, end: END });
  for (const q of seen) {
    if (/FROM orgs WHERE id/.test(q.sql)) continue;
    assert.match(q.sql, /org_id = \$1/, `not org-scoped: ${q.sql.slice(0, 60)}`);
    assert.equal(q.params[0], "org-1");
  }
});

test("orgId and staffId are required", async () => {
  await assert.rejects(() => closerOfferStack(fakeDb(), { orgId: "org-1" }), TypeError);
  await assert.rejects(() => floorOfferStack(fakeDb(), {}), TypeError);
});
