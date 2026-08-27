import { test } from "node:test";
import assert from "node:assert/strict";
import { asUuid, normCfId, saveConnection } from "./connections.mjs";

test("asUuid accepts only a real uuid", () => {
  assert.equal(asUuid("2f1c8b4a-3d5e-4a11-9c22-7b8d9e0f1a2b"), "2f1c8b4a-3d5e-4a11-9c22-7b8d9e0f1a2b");
  assert.equal(asUuid(" 2f1c8b4a-3d5e-4a11-9c22-7b8d9e0f1a2b "), "2f1c8b4a-3d5e-4a11-9c22-7b8d9e0f1a2b");
  assert.equal(asUuid("not-a-uuid"), null);
  assert.equal(asUuid(42), null);
});

test("normCfId trims and drops blanks", () => {
  assert.equal(normCfId("  funnel-1  "), "funnel-1");
  assert.equal(normCfId(""), null);
  assert.equal(normCfId(null), null);
});

test("saveConnection refuses a blank funnel or product id", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const noFunnel = await saveConnection(db, "11111111-1111-4111-8111-111111111111", {
    name: "SLO", cf_product_id: "p1", product_code: "funding"
  });
  assert.equal(noFunnel.ok, false);
  assert.equal(noFunnel.error, "funnel_required");

  const noProduct = await saveConnection(db, "11111111-1111-4111-8111-111111111111", {
    name: "SLO", cf_funnel_id: "f1", product_code: "funding"
  });
  assert.equal(noProduct.ok, false);
  assert.equal(noProduct.error, "cf_product_required");
});
