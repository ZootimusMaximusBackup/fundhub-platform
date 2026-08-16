// Unit tests for src/handlers/payment-links.mjs — the payment.received
// reaction that settles a payment_links row via link_ref or Commas session id.
import { test, describe } from "node:test";
import assert from "node:assert";
import { onPaymentReceivedForLink } from "./payment-links.mjs";

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (/link_ref = \$1/i.test(text)) {
        const [link_ref, , commas_session_id, paid_amount_cents, openStatuses] = params;
        const row = rows.find((r) => r.link_ref === link_ref && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid";
        row.commas_session_id = commas_session_id ?? row.commas_session_id;
        row.paid_amount_cents = paid_amount_cents;
        return { rows: [row] };
      }
      if (/commas_session_id = \$1/i.test(text)) {
        const [session_id, , paid_amount_cents, openStatuses] = params;
        const row = rows.find((r) => r.commas_session_id === session_id && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid";
        row.paid_amount_cents = paid_amount_cents;
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

describe("onPaymentReceivedForLink", () => {
  test("no ref and no itemId: does nothing", async () => {
    const db = fakeDb([]);
    await onPaymentReceivedForLink({ payload: { amount: 50, providerRef: "txn_1" } }, db);
    assert.equal(db.calls.length, 0);
  });

  test("a matching ref settles the link with the processor's own session id, amount converted to cents", async () => {
    const rows = [{ link_ref: "pl_1", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", amount: 32, providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].commas_session_id, "txn_abc");
    assert.equal(rows[0].paid_amount_cents, 3200);
  });

  test("itemId settles when link_ref is missing", async () => {
    const rows = [{ link_ref: "pl_wrong", commas_session_id: "8YZPo", status: "sent" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { amount: 1, itemId: "8YZPo" } }, db);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].paid_amount_cents, 100);
  });

  test("no amount on the event records an unknown paid amount, not zero", async () => {
    const rows = [{ link_ref: "pl_1", status: "sent" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].paid_amount_cents, null);
  });

  test("a ref matching nothing is a safe no-op when no itemId", async () => {
    const rows = [{ link_ref: "pl_other", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_missing", amount: 10 } }, db);
    assert.equal(rows[0].status, "created");
  });
});
