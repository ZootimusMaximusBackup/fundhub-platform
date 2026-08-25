import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSoftPullBusinesses,
  ensureSoftPullCheckout
} from "../../api/soft-pull-approve.mjs";
import { softPullTotalCents } from "../finance/soft-pull-pricing.mjs";
import { ConsentError } from "../consent/index.mjs";

test("parseSoftPullBusinesses: empty / missing → []", () => {
  assert.deepEqual(parseSoftPullBusinesses(null), []);
  assert.deepEqual(parseSoftPullBusinesses([]), []);
  assert.deepEqual(parseSoftPullBusinesses(""), []);
});

test("parseSoftPullBusinesses: accepts 1–5 complete rows", () => {
  const one = parseSoftPullBusinesses([{
    name: "Acme LLC",
    address_line1: "1 Main St",
    city: "Phoenix",
    state: "az",
    postal_code: "85001"
  }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].state, "AZ");
  assert.equal(softPullTotalCents(one.length), 4200);
});

test("parseSoftPullBusinesses: refuses more than 5", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    name: "Biz " + i,
    address_line1: "1 St",
    city: "X",
    state: "AZ",
    postal_code: "85001"
  }));
  assert.throws(() => parseSoftPullBusinesses(rows), ConsentError);
});

test("parseSoftPullBusinesses: incomplete row fails", () => {
  assert.throws(
    () => parseSoftPullBusinesses([{ name: "Acme", city: "Phoenix", state: "AZ" }]),
    (e) => e instanceof ConsentError && e.code === "business_address_required"
  );
});

test("ensureSoftPullCheckout reuses matching open link", async () => {
  const link = {
    id: "link-1",
    status: "sent",
    amount_cents: 4200,
    checkout_url: "https://pay.example/42",
    purpose: "diagnostic"
  };
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/amount_cents = \$4/i.test(sql) && /ORDER BY created_at/i.test(sql)) {
        return { rows: [link] };
      }
      throw new Error("unexpected: " + String(sql).slice(0, 80));
    }
  };
  const out = await ensureSoftPullCheckout(db, {
    orgId: "o",
    clientId: "c",
    amountCents: 4200,
    description: "test",
    env: {}
  });
  assert.equal(out.checkout_url, link.checkout_url);
  assert.equal(out.amount_cents, 4200);
});
