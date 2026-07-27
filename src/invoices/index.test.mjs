import { test } from "node:test";
import assert from "node:assert";
import {
  createInvoice, markSent, markPaid, voidInvoice, getInvoice,
  successFeeKey, depositKey
} from "./index.mjs";

// ---------------------------------------------------------------------------
// Minimal in-memory db stub — mirrors the pg pool.query interface.
// ---------------------------------------------------------------------------
function makeDb(rows = []) {
  const store = [...rows];
  return {
    _store: store,
    async query(sql, params = []) {
      const s = sql.trim().toUpperCase();

      if (s.startsWith("INSERT INTO INVOICES")) {
        // Simulate ON CONFLICT DO NOTHING on idempotency_key
        const idempotencyKey = params[10] ?? null;
        if (idempotencyKey) {
          const dup = store.find(r => r.org_id === params[0] && r.idempotency_key === idempotencyKey);
          if (dup) return { rows: [] };
        }
        const row = {
          id: `inv-${store.length + 1}`,
          org_id: params[0],
          client_id: params[1],
          invoice_type: params[2],
          amount: params[3],
          currency: params[4],
          sale_id: params[5],
          funding_round_id: params[6],
          due_at: params[7],
          provider: params[8],
          provider_ref: params[9],
          idempotency_key: params[10],
          notes: params[11],
          status: "draft",
          issued_at: null, paid_at: null, voided_at: null,
        };
        store.push(row);
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'SENT'")) {
        const id = params[0];
        const row = store.find(r => r.id === id && r.status === "draft");
        if (!row) return { rows: [] };
        row.status = "sent"; row.issued_at = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'PAID'")) {
        const id = params[0];
        const row = store.find(r => r.id === id && ["draft","sent","overdue"].includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid"; row.paid_at = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'VOID'")) {
        const id = params[0];
        const row = store.find(r => r.id === id && r.status !== "paid");
        if (!row) return { rows: [] };
        row.status = "void"; row.voided_at = new Date().toISOString();
        if (params[1]) row.notes = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("SELECT * FROM INVOICES WHERE ID")) {
        const row = store.find(r => r.id === params[0]);
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    }
  };
}

const ORG = "org-fundhub";
const CLIENT = "client-001";
const SALE = "sale-001";
const ROUND = "round-001";

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------
test("createInvoice returns the new row", async () => {
  const db = makeDb();
  const row = await createInvoice(db, {
    orgId: ORG, clientId: CLIENT,
    invoiceType: "success_fee", amount: 5000,
    saleId: SALE, fundingRoundId: ROUND,
  });
  assert.strictEqual(row.invoice_type, "success_fee");
  assert.strictEqual(row.amount, 5000);
  assert.strictEqual(row.status, "draft");
});

test("createInvoice is idempotent on idempotencyKey — second call returns null", async () => {
  const db = makeDb();
  const key = successFeeKey(SALE, ROUND);
  const first = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, idempotencyKey: key });
  assert.ok(first, "first insert should succeed");

  const second = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, idempotencyKey: key });
  assert.strictEqual(second, null, "duplicate key should return null (DO NOTHING)");
  assert.strictEqual(db._store.length, 1, "only one row in store");
});

test("createInvoice without idempotencyKey allows duplicate inserts", async () => {
  const db = makeDb();
  await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  assert.strictEqual(db._store.length, 2);
});

// ---------------------------------------------------------------------------
// markSent
// ---------------------------------------------------------------------------
test("markSent transitions draft → sent", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  const sent = await markSent(db, { invoiceId: row.id });
  assert.strictEqual(sent.status, "sent");
});

test("markSent on already-sent row returns null", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  await markSent(db, { invoiceId: row.id });
  const again = await markSent(db, { invoiceId: row.id });
  assert.strictEqual(again, null);
});

// ---------------------------------------------------------------------------
// markPaid
// ---------------------------------------------------------------------------
test("markPaid transitions sent → paid", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000 });
  await markSent(db, { invoiceId: row.id });
  const paid = await markPaid(db, { invoiceId: row.id });
  assert.strictEqual(paid.status, "paid");
  assert.ok(paid.paid_at);
});

test("markPaid on already-paid row returns null (idempotent guard)", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000 });
  await markPaid(db, { invoiceId: row.id });
  const again = await markPaid(db, { invoiceId: row.id });
  assert.strictEqual(again, null);
});

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------
test("voidInvoice transitions draft → void", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999 });
  const voided = await voidInvoice(db, { invoiceId: row.id, notes: "duplicate" });
  assert.strictEqual(voided.status, "void");
});

test("voidInvoice on paid row returns null", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999 });
  await markPaid(db, { invoiceId: row.id });
  const voided = await voidInvoice(db, { invoiceId: row.id });
  assert.strictEqual(voided, null);
});

// ---------------------------------------------------------------------------
// getInvoice
// ---------------------------------------------------------------------------
test("getInvoice returns the row by id", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "platform_fee", amount: 49 });
  const fetched = await getInvoice(db, { invoiceId: row.id });
  assert.strictEqual(fetched.id, row.id);
});

test("getInvoice returns null for unknown id", async () => {
  const db = makeDb();
  const fetched = await getInvoice(db, { invoiceId: "nope" });
  assert.strictEqual(fetched, null);
});

// ---------------------------------------------------------------------------
// idempotency key helpers
// ---------------------------------------------------------------------------
test("successFeeKey is deterministic", () => {
  assert.strictEqual(successFeeKey("s1", "r1"), "invoice|success_fee|s1|r1");
  assert.strictEqual(successFeeKey("s1", "r1"), successFeeKey("s1", "r1"));
});

test("depositKey is deterministic", () => {
  assert.strictEqual(depositKey("s1"), "invoice|deposit|s1");
});

// ---------------------------------------------------------------------------
// round.funded → invoice integration (f-07 wiring)
// ---------------------------------------------------------------------------
test("round.funded scenario: success_fee invoice created with correct amount", async () => {
  const db = makeDb();
  const approvedAmount = 50000;
  const feePercent = 10;
  const expectedFee = Math.round(approvedAmount * feePercent) / 100; // 5000

  const invoice = await createInvoice(db, {
    orgId: ORG,
    clientId: CLIENT,
    invoiceType: "success_fee",
    amount: expectedFee,
    saleId: SALE,
    fundingRoundId: ROUND,
    idempotencyKey: successFeeKey(SALE, ROUND),
    notes: `round.funded — approved ${approvedAmount} @ ${feePercent}%`,
  });

  assert.strictEqual(invoice.amount, 5000);
  assert.strictEqual(invoice.invoice_type, "success_fee");
  assert.strictEqual(invoice.idempotency_key, `invoice|success_fee|${SALE}|${ROUND}`);
});

test("round.funded fired twice: idempotency prevents double invoice", async () => {
  const db = makeDb();
  const key = successFeeKey(SALE, ROUND);
  const opts = { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, saleId: SALE, fundingRoundId: ROUND, idempotencyKey: key };

  await createInvoice(db, opts);
  await createInvoice(db, opts);

  assert.strictEqual(db._store.length, 1, "exactly one invoice despite two calls");
});
