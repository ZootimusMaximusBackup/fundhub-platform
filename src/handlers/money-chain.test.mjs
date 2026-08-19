// Unit tests for money-chain helpers — no Postgres.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  BUCKET_TO_CODE, paymentKindFor, nothingUnlockedReason, NOTHING_UNLOCKED
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
