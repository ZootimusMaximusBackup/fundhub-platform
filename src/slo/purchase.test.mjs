import { test } from "node:test";
import assert from "node:assert/strict";
import { _resetOrgCache } from "../events/bus.mjs";
import { extractSloPaidPurchase, handleSloPaidWebhook, recordSloPurchase } from "./purchase.mjs";

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function paidBody(over = {}) {
  return {
    event_id: "evt-slo-1",
    event_type: "order.completed",
    funnel_id: "funnel-slo-1",
    data: {
      id: 9001,
      amount_cents: 19700,
      contact: {
        email: "guess@example.com",
        custom_attributes: { fundhub_client_id: CLIENT }
      },
      line_items: [{ product_id: "cf-prod-slo-1" }]
    },
    ...over
  };
}

test("extractSloPaidPurchase reads funnel + product + named client + cents", () => {
  const got = extractSloPaidPurchase(paidBody());
  assert.equal(got.ok, true);
  assert.equal(got.clientId, CLIENT);
  assert.equal(got.funnelId, "funnel-slo-1");
  assert.equal(got.items.length, 1);
  assert.equal(got.items[0].cfProductId, "cf-prod-slo-1");
  assert.equal(got.items[0].amountDollars, 197);
});

test("extractSloPaidPurchase does not guess the client from email", () => {
  const got = extractSloPaidPurchase(paidBody({
    data: {
      id: 9001,
      amount_cents: 19700,
      contact: { email: "guess@example.com" },
      line_items: [{ product_id: "cf-prod-slo-1" }]
    }
  }));
  assert.equal(got.ok, false);
  assert.equal(got.reason, "no_client_id");
});

test("extractSloPaidPurchase does not pick an offer from price", () => {
  const got = extractSloPaidPurchase({
    event_type: "order.completed",
    funnel_id: "funnel-slo-1",
    data: {
      id: 9001,
      amount_cents: 19700,
      contact: { custom_attributes: { fundhub_client_id: CLIENT } }
    }
  });
  assert.equal(got.ok, false);
  assert.equal(got.reason, "no_cf_product_id");
});

test("extractSloPaidPurchase refuses a classic integer dollar with no cents field", () => {
  const got = extractSloPaidPurchase({
    type: "new_purchase",
    funnel_id: "funnel-slo-1",
    data: {
      id: "ord-1",
      amount: 197,
      contact: { custom_attributes: { fundhub_client_id: CLIENT } },
      product_id: "cf-prod-slo-1"
    }
  });
  assert.equal(got.ok, false);
  assert.equal(got.reason, "no_paid_amount");
});

test("handleSloPaidWebhook writes one sale from the map and named client", async () => {
  _resetOrgCache();
  const store = { sales: [], txs: [] };
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: ORG }] };
      if (/FROM slo_connections/.test(sql)) {
        return {
          rows: [{
            id: "conn-1",
            product_id: PRODUCT,
            product_name: "Funding Bundle",
            cf_funnel_id: "funnel-slo-1",
            cf_product_id: "cf-prod-slo-1",
            active: true
          }]
        };
      }
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/FROM sales WHERE org_id/.test(sql) && /external_ref/.test(sql) && /SELECT \*/.test(sql)) {
        return { rows: store.sales.filter((s) => s.external_ref === params[1]) };
      }
      if (/INSERT INTO transactions/.test(sql)) {
        const row = { id: "tx-1", org_id: params[0], client_id: params[1], amount_paid: params[3], provider_ref: params[4] };
        store.txs.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO sales/.test(sql)) {
        const row = {
          id: "sale-1",
          org_id: params[0],
          client_id: params[1],
          product_id: params[2],
          agreed_price: params[3],
          external_ref: params[4]
        };
        store.sales.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO sale_payments/.test(sql)) return { rows: [{ id: "pay-1" }] };
      return { rows: [] };
    }
  };
  const res = await handleSloPaidWebhook(db, paidBody());
  assert.equal(res.reason, "recorded");
  assert.equal(res.written.length, 1);
  assert.equal(store.sales.length, 1);
  assert.equal(store.sales[0].client_id, CLIENT);
  assert.equal(store.sales[0].product_id, PRODUCT);
  assert.equal(Number(store.sales[0].agreed_price), 197);
});

test("handleSloPaidWebhook does not write when the map is off or missing", async () => {
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: ORG }] };
      if (/FROM slo_connections/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const res = await handleSloPaidWebhook(db, paidBody());
  assert.equal(res.reason, "unmapped");
  assert.equal(res.written.length, 0);
});

test("recordSloPurchase replay of the same order is one sale", async () => {
  const existing = {
    id: "sale-1",
    client_id: CLIENT,
    product_id: PRODUCT,
    external_ref: "clickfunnels:order:9001:cf-prod-slo-1"
  };
  const db = {
    query(sql) {
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/FROM sales/.test(sql)) return { rows: [existing] };
      throw new Error("unexpected write on replay: " + sql);
    }
  };
  const rec = await recordSloPurchase(db, {
    orgId: ORG,
    clientId: CLIENT,
    productId: PRODUCT,
    productName: "Funding Bundle",
    amountDollars: 197,
    providerRef: existing.external_ref
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.created, false);
  assert.equal(rec.sale.id, "sale-1");
});
