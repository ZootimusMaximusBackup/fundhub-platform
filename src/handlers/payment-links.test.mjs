// Unit tests for src/handlers/payment-links.mjs — the payment.received
// reaction that settles a payment_links row, if the event carries our own
// `ref`. No bus, no Postgres: the handler function is called directly with a
// fake db that models exactly the one UPDATE statement it can issue
// (src/payment-links/index.mjs markPaid).
import { test, describe } from "node:test";
import assert from "node:assert";
import { onPaymentReceivedForLink } from "./payment-links.mjs";

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const [link_ref, , commas_session_id, paid_amount_cents, openStatuses] = params;
      const row = rows.find((r) => r.link_ref === link_ref && openStatuses.includes(r.status));
      if (!row) return { rows: [] };
      row.status = "paid"; row.commas_session_id = commas_session_id; row.paid_amount_cents = paid_amount_cents;
      return { rows: [row] };
    }
  };
}

describe("onPaymentReceivedForLink", () => {
  test("no ref on the event: does nothing, no query at all", async () => {
    const db = fakeDb([]);
    await onPaymentReceivedForLink({ payload: { amount: 50, providerRef: "txn_1" } }, db);
    assert.equal(db.calls.length, 0, "a payment.received with no ref must not touch payment_links at all");
  });

  test("a matching ref settles the link with the processor's own session id, amount converted to cents", async () => {
    const rows = [{ link_ref: "pl_1", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", amount: 32, providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].commas_session_id, "txn_abc");
    assert.equal(rows[0].paid_amount_cents, 3200, "evt.amount arrives in dollars and must cross into cents");
  });

  test("no amount on the event records an unknown paid amount, not zero", async () => {
    const rows = [{ link_ref: "pl_1", status: "sent" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].paid_amount_cents, null);
  });

  test("a ref matching nothing is a safe no-op", async () => {
    const rows = [{ link_ref: "pl_other", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_missing", amount: 10 } }, db);
    assert.equal(rows[0].status, "created");
  });
});
