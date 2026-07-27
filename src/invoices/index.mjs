// src/invoices/index.mjs — canonical invoice helpers.
//
// Invoices record money OWED. Money RECEIVED goes in sale_payments / transactions.
//
// Pattern mirrors commission_ledger: idempotent upserts via ON CONFLICT DO NOTHING,
// no deletes, status transitions validated here.
//
// FLAG for Darwin/Chris: due_at policy (net 30? on demand?) is not set here —
// callers must pass it or leave null. See 017_invoices.sql for full notes.

/** @param {object} db — pg pool/client */
export async function createInvoice(db, {
  orgId,
  clientId,
  invoiceType,      // 'deposit' | 'success_fee' | 'platform_fee'
  amount,
  currency = "USD",
  saleId = null,
  fundingRoundId = null,
  dueAt = null,
  provider = null,
  providerRef = null,
  idempotencyKey = null,
  notes = null,
}) {
  const result = await db.query(
    `INSERT INTO invoices
       (org_id, client_id, invoice_type, amount, currency,
        sale_id, funding_round_id, due_at,
        provider, provider_ref, idempotency_key, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [orgId, clientId, invoiceType, amount, currency,
     saleId, fundingRoundId, dueAt,
     provider, providerRef, idempotencyKey, notes]
  );
  // DO NOTHING means rows[] may be empty on duplicate
  return result.rows[0] ?? null;
}

/** Mark an invoice as sent (draft → sent). */
export async function markSent(db, { invoiceId, issuedAt = new Date() }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'sent', issued_at = $2
      WHERE id = $1
        AND status = 'draft'
     RETURNING *`,
    [invoiceId, issuedAt]
  );
  return result.rows[0] ?? null;
}

/** Mark an invoice as paid (draft|sent|overdue → paid). Also records paid_at. */
export async function markPaid(db, { invoiceId, paidAt = new Date() }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'paid', paid_at = $2
      WHERE id = $1
        AND status IN ('draft', 'sent', 'overdue')
     RETURNING *`,
    [invoiceId, paidAt]
  );
  return result.rows[0] ?? null;
}

/** Void an invoice. Idempotent — already-voided rows return unchanged. */
export async function voidInvoice(db, { invoiceId, notes = null }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'void', voided_at = now(),
            notes = COALESCE($2, notes)
      WHERE id = $1
        AND status != 'paid'
     RETURNING *`,
    [invoiceId, notes]
  );
  return result.rows[0] ?? null;
}

/** Fetch a single invoice by id. */
export async function getInvoice(db, { invoiceId }) {
  const result = await db.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  return result.rows[0] ?? null;
}

/** Idempotency key for a success-fee invoice on a funding round. */
export function successFeeKey(saleId, fundingRoundId) {
  return `invoice|success_fee|${saleId}|${fundingRoundId}`;
}

/** Idempotency key for a deposit invoice on a sale. */
export function depositKey(saleId) {
  return `invoice|deposit|${saleId}`;
}
