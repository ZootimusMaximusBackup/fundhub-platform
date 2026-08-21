// Unit tests for money-chain helpers — no Postgres.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  BUCKET_TO_CODE, paymentKindFor, nothingUnlockedReason, NOTHING_UNLOCKED,
  ensureAttributions, ensureSalePayment
} from "./money-chain.mjs";

describe("money-chain helpers", () => {
  test("BUCKET_TO_CODE maps Commas semantic buckets to product codes", () => {
    assert.equal(BUCKET_TO_CODE.crs, "diagnostic");
    assert.equal(BUCKET_TO_CODE.deposit, "card-stacking-dfy");
    assert.equal(BUCKET_TO_CODE.diy, "consulting-package");
    assert.equal(BUCKET_TO_CODE.success_fee, "card-stacking-dfy");
    assert.equal(BUCKET_TO_CODE.unmatched, null);
  });

  test("a repair payment resolves to the repair product, not the DIY package", () => {
    // offers.mjs gives REPAIR_DFY and REPAIR_TRIAL paymentPurpose 'repair', and
    // 015_seed_products.sql has exactly one category='repair' product. Before
    // this entry existed the bucket resolved to nothing and the sale landed on
    // consulting-package.
    assert.equal(BUCKET_TO_CODE.repair, "repair-bundle");
  });

  test("paymentKindFor picks sale_payments.kind from event + bucket", () => {
    assert.equal(paymentKindFor("deposit", "deposit.paid"), "deposit");
    assert.equal(paymentKindFor("crs", "diagnostic.paid"), "deposit");
    assert.equal(paymentKindFor("diy", "sale.closed"), "deposit");
    assert.equal(paymentKindFor("success_fee", "payment.received"), "success_fee");
    assert.equal(paymentKindFor("unmatched", "payment.received"), "installment");
  });
});

describe("money-chain says why nothing unlocked", () => {
  // The rule stays: never grant an entitlement nobody mapped. What changed is
  // that the refusal now names itself, so "he paid and his portal is still
  // locked" has a readable answer instead of a silent return.

  test("no client on the payment is the first reason, before any product lookup", () => {
    assert.equal(nothingUnlockedReason({ clientId: null, product: { code: "diagnostic" } }), "no_client");
    assert.equal(nothingUnlockedReason({}), "no_client");
  });

  test("a payment we cannot pin to a product is its own distinct reason", () => {
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: null }), "no_product");
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: {} }), "no_product");
  });

  test("client plus product means go and read the mapping", () => {
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: { code: "diagnostic" } }), null);
  });

  test("the log line is one greppable prefix", () => {
    // Anyone chasing a locked portal greps for this exact string.
    assert.equal(NOTHING_UNLOCKED, "[money-chain] nothing unlocked");
  });
});

describe("money-chain attribution", () => {
  function attributionDb() {
    const staff = new Map([
      ["closer-1", { id: "closer-1", role: "closer" }],
      ["manager-1", { id: "manager-1", role: "sales_manager" }]
    ]);
    const rows = [];
    return {
      rows,
      query: async (sql, params) => {
        const text = String(sql);
        if (/FROM staff/i.test(text)) {
          const row = staff.get(params[0]);
          return { rows: row ? [row] : [] };
        }
        if (/SELECT 1 FROM sale_attributions/i.test(text)) {
          const [saleId, staffId, role, basis] = params;
          return {
            rows: rows.some((r) =>
              r.sale_id === saleId && r.staff_id === staffId &&
              r.role === role && r.basis === basis
            ) ? [{ "?column?": 1 }] : []
          };
        }
        if (/SUM\(split_percent\)/i.test(text)) {
          const [saleId, basis, role] = params;
          const total = rows
            .filter((r) => r.sale_id === saleId && r.basis === basis && r.role === role)
            .reduce((sum, r) => sum + r.split_percent, 0);
          return { rows: [{ s: total }] };
        }
        if (/INSERT INTO sale_attributions/i.test(text)) {
          const [org_id, sale_id, staff_id, role, basis, split_percent] = params;
          const row = { id: `attr-${rows.length + 1}`, org_id, sale_id, staff_id, role, basis, split_percent };
          rows.push(row);
          return { rows: [{ id: row.id }] };
        }
        throw new Error(`unhandled SQL: ${text.slice(0, 100)}`);
      }
    };
  }

  test("a real closer and manager each receive their own front- and back-end credit", async () => {
    const db = attributionDb();
    const result = await ensureAttributions(db, {
      orgId: "org-1",
      saleId: "sale-1",
      event: {
        payload: { closerId: "closer-1", salesManagerId: "manager-1" }
      }
    });

    assert.equal(result.written, 4);
    assert.deepEqual(
      db.rows.map((r) => `${r.role}:${r.basis}`).sort(),
      [
        "closer:back_end",
        "closer:front_end",
        "sales_manager:back_end",
        "sales_manager:front_end"
      ]
    );
  });

  test("missing actors remain unattributed", async () => {
    const db = attributionDb();
    const result = await ensureAttributions(db, {
      orgId: "org-1",
      saleId: "sale-1",
      event: { payload: {} }
    });
    assert.equal(result.written, 0);
    assert.deepEqual(db.rows, []);
  });
});

describe("ensureSalePayment", () => {
  test("INSERT copies product_id from the sale so deposit.paid can write sale_payments", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        const text = String(sql);
        calls.push({ sql: text, params });
        if (/FROM transactions/i.test(text)) return { rows: [] };
        if (/INSERT INTO sale_payments/i.test(text)) {
          return { rows: [{ id: "pay-1", product_id: params[3] }] };
        }
        throw new Error(`unhandled SQL: ${text.slice(0, 100)}`);
      }
    };

    const result = await ensureSalePayment(db, {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      orgId: "org-1",
      name: "deposit.paid",
      payload: { amount: 3000 }
    }, {
      saleId: "sale-1",
      productId: "prod-from-sale",
      kind: "deposit"
    });

    assert.equal(result.created, true);
    assert.equal(result.payment?.id, "pay-1");
    const ins = calls.find((c) => /INSERT INTO sale_payments/i.test(c.sql));
    assert.ok(ins, "deposit.paid must INSERT sale_payments when a sale exists");
    assert.match(ins.sql, /product_id/, "INSERT must include product_id (live NOT NULL)");
    assert.equal(ins.params[3], "prod-from-sale");
  });
});
